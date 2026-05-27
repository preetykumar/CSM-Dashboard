#!/usr/bin/env node
// Phase 1a spike: for multi-product closed-won deployment opps, how many
// Kantata workspaces map to them? Is it 1 workspace per opp (covering all
// products), or 1 workspace per (opp, product), or something else?
//
// Answer drives the Deployments-view data model:
//   - 1 per opp  → can't show per-product budget from Kantata directly
//   - 1 per product → clean per-product hierarchy
//
// Output classifies each multi-product deploy opp by Kantata coverage.
//
// Usage: node backend/scripts/spike-deploy-kantata-mapping.mjs

import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── SF auth ────────────────────────────────────────────────────────────
const clientId = process.env.SF_CLIENT_ID;
const username = process.env.SF_USERNAME;
const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;
const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';
const keyPath = path.resolve(path.join(__dirname, '..', privateKeyPath));
const privateKey = fs.readFileSync(keyPath, 'utf8');
const claims = { iss: clientId, sub: username, aud: loginUrl, exp: Math.floor(Date.now() / 1000) + 300 };
const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });
const params = new URLSearchParams();
params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
params.append('assertion', assertion);
const sfRes = await fetch(`${loginUrl}/services/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params,
});
const sfAuth = await sfRes.json();
if (!sfRes.ok) { console.error('SF auth failed:', sfAuth); process.exit(1); }

async function soql(q) {
  const r = await fetch(`${sfAuth.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${sfAuth.access_token}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.records;
}

// ── Kantata auth ───────────────────────────────────────────────────────
const kantataToken = process.env.KANTATA_API_TOKEN;
async function kantata(pathStr) {
  const r = await fetch(`https://api.mavenlink.com/api/v1${pathStr}`, {
    headers: { Authorization: `Bearer ${kantataToken}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Kantata ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Step 1: pull recent closed-won deploy opps (those with DEP-* line items) ──
console.log('=== Step 1: recent closed-won deployment opps (last 180d) ===');
const sixMonthsAgo = new Date(Date.now() - 180 * 86400 * 1000).toISOString().split('T')[0];

const oppsWithDep = await soql(`
  SELECT Id, Name, AccountId, Account.Name, CloseDate
  FROM Opportunity
  WHERE StageName = '8 - Closed Won'
    AND CloseDate >= ${sixMonthsAgo}
    AND Id IN (SELECT OpportunityId FROM OpportunityLineItem WHERE ProductCode LIKE 'DEP-%')
`);
console.log(`  found ${oppsWithDep.length} closed-won opps with DEP-* line items in last 180d`);

// ── Step 2: pull ALL line items for these opps ──
console.log('\n=== Step 2: full line-item breakdown per opp ===');
const lineItemsByOpp = new Map(); // oppId → [{ProductCode, ...}]
const CHUNK = 100;
for (let i = 0; i < oppsWithDep.length; i += CHUNK) {
  const chunk = oppsWithDep.slice(i, i + CHUNK);
  const inList = chunk.map((o) => `'${o.Id}'`).join(',');
  const items = await soql(`
    SELECT Id, OpportunityId, ProductCode, Product2.Name, Product2.Family, Quantity, TotalPrice
    FROM OpportunityLineItem
    WHERE OpportunityId IN (${inList})
  `);
  for (const li of items) {
    const arr = lineItemsByOpp.get(li.OpportunityId) || [];
    arr.push(li);
    lineItemsByOpp.set(li.OpportunityId, arr);
  }
}

// Classify each opp by product mix
//   product code prefix (before first "-"):
//     AXEDTPRO, AXEDTHTML, AXEDTNATMOB → DevTools
//     AXEMON → Monitor
//     AXEAUD → Auditor
//     AXELINT → Linter
//     AXEASSIST* → Assistant
//     DQU* → Deque University
//     DEP* → deployment package (skip)
//     HOSTING*, MAINTENANCE*, INVTRACK* → fees (skip)
//     others → services (skip for v1)
function productFamily(code) {
  if (!code) return null;
  if (code.startsWith('DEP-')) return null;
  if (code.startsWith('HOSTING') || code.startsWith('MAINTENANCE') || code.startsWith('INVTRACK')) return null;
  if (code.startsWith('AXEDTPRO') || code.startsWith('AXEDTHTML') || code.startsWith('axe DevTools')) return 'DevTools';
  if (code.startsWith('AXEDTNATMOB')) return 'DevTools Mobile';
  if (code.startsWith('AXEMON')) return 'Monitor';
  if (code.startsWith('AXEAUD')) return 'Auditor';
  if (code.startsWith('AXELINT')) return 'Linter';
  if (code.startsWith('AXEASSIST')) return 'Assistant';
  if (code.startsWith('AXEMCPSERVER') || code.startsWith('AXEMCP')) return 'MCP Server';
  if (code.startsWith('DQU')) return 'Deque University';
  return null; // services / training etc.
}

function deploymentType(code) {
  if (/-?(ONPREM|PRIVCLOUD|OFFLINE)\b/i.test(code)) return 'on_prem';
  return 'cloud';
}

const oppSummary = new Map(); // oppId → { name, account, products: Set, depCount, depTotal }
for (const [oppId, items] of lineItemsByOpp.entries()) {
  const opp = oppsWithDep.find((o) => o.Id === oppId);
  const products = new Set();
  let depCount = 0;
  let depTotal = 0;
  for (const li of items) {
    const fam = productFamily(li.ProductCode);
    if (fam) products.add(`${fam}/${deploymentType(li.ProductCode)}`);
    if (li.ProductCode?.startsWith('DEP-')) {
      depCount++;
      depTotal += li.TotalPrice || 0;
    }
  }
  oppSummary.set(oppId, {
    name: opp.Name,
    account: opp.Account?.Name,
    products: [...products],
    productCount: products.size,
    depCount,
    depTotal,
  });
}

// Bucket opps by product-count
const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };
for (const s of oppSummary.values()) {
  const key = s.productCount >= 4 ? '4+' : String(s.productCount);
  buckets[key]++;
}
console.log('  opp distribution by # of distinct (product, deploy-type):');
for (const [k, v] of Object.entries(buckets)) {
  console.log(`    ${k} product(s): ${v} opps`);
}

// Sample a few multi-product opps to inspect
const multiProductOpps = [...oppSummary.entries()].filter(([_, s]) => s.productCount >= 2);
console.log(`\n  total multi-product (2+) opps: ${multiProductOpps.length}`);
console.log('  sample 5 multi-product opps:');
for (const [oppId, s] of multiProductOpps.slice(0, 5)) {
  console.log(`    ${s.account} | ${s.name.substring(0, 50)}`);
  console.log(`      products: ${s.products.join(', ')}  |  DEP lines: ${s.depCount} ($${s.depTotal})`);
}

// ── Step 3: pull active Kantata workspaces, find sfRef matches ──
console.log('\n=== Step 3: pulling active Kantata workspaces ===');
const allWs = [];
let page = 1;
while (page <= 10) {
  const data = await kantata(`/workspaces.json?per_page=200&page=${page}&archived=false&include=custom_field_values`);
  const wsArr = data.workspaces ? Object.values(data.workspaces) : [];
  if (wsArr.length === 0) break;
  // Resolve SF custom field
  const cfvMap = data.custom_field_values || {};
  for (const ws of wsArr) {
    let sfRaw = null;
    for (const cfvId of ws.custom_field_value_ids || []) {
      const cfv = cfvMap[cfvId];
      if (cfv && String(cfv.custom_field_id) === '386615') {
        sfRaw = Array.isArray(cfv.value) ? cfv.value[0] : cfv.value;
        break;
      }
    }
    let sfId = null;
    let objectType = null;
    if (sfRaw) {
      const value = String(sfRaw).trim();
      const urlMatch = value.match(/lightning\/r\/([A-Za-z_]+)\/([A-Za-z0-9]{15,18})/);
      if (urlMatch) {
        objectType = urlMatch[1] === 'Account' ? 'Account' : urlMatch[1] === 'Opportunity' ? 'Opportunity' : 'Other';
        sfId = urlMatch[2];
      } else {
        const idMatch = value.match(/\b([A-Za-z0-9]{15}|[A-Za-z0-9]{18})\b/);
        if (idMatch) {
          sfId = idMatch[1];
          if (sfId.startsWith('001')) objectType = 'Account';
          else if (sfId.startsWith('006')) objectType = 'Opportunity';
          else objectType = 'Other';
        }
      }
    }
    allWs.push({
      id: ws.id,
      title: ws.title,
      sfId,
      objectType,
      budget: ws.price_in_cents ? (ws.price_in_cents / 100) : null,
      budgetUsed: ws.budget_used_in_cents / 100,
    });
  }
  if (wsArr.length < 200) break;
  page++;
}
console.log(`  ${allWs.length} active workspaces total`);
const wsByOppId = new Map(); // oppId → [workspaces]
const wsByAccountId = new Map();
for (const ws of allWs) {
  if (!ws.sfId) continue;
  if (ws.objectType === 'Opportunity') {
    const arr = wsByOppId.get(ws.sfId) || [];
    arr.push(ws);
    wsByOppId.set(ws.sfId, arr);
  } else if (ws.objectType === 'Account') {
    const arr = wsByAccountId.get(ws.sfId) || [];
    arr.push(ws);
    wsByAccountId.set(ws.sfId, arr);
  }
}
console.log(`  workspaces with Opportunity sfRef: ${wsByOppId.size} distinct opps`);
console.log(`  workspaces with Account sfRef:     ${wsByAccountId.size} distinct accounts`);

// ── Step 4: cross-reference multi-product opps to Kantata workspaces ──
console.log('\n=== Step 4: multi-product opp → Kantata workspace mapping ===');
const matchDistribution = { 0: 0, 1: 0, 2: 0, '3+': 0 };
const matchedExamples = [];
for (const [oppId, s] of multiProductOpps) {
  // Direct match: workspaces referencing this opp
  const directWs = wsByOppId.get(oppId) || [];
  // Indirect match: workspaces referencing the account (multiple opps could share)
  const account = oppsWithDep.find((o) => o.Id === oppId)?.AccountId;
  const accountWs = account ? wsByAccountId.get(account) || [] : [];
  const total = directWs.length; // we count direct opp matches; account-level is ambiguous
  const key = total >= 3 ? '3+' : String(total);
  matchDistribution[key]++;
  if (total >= 1 && matchedExamples.length < 8) {
    matchedExamples.push({
      account: s.account,
      oppName: s.name,
      productCount: s.productCount,
      products: s.products,
      directWsCount: directWs.length,
      accountWsCount: accountWs.length,
      ws: directWs.map((w) => ({ title: w.title.substring(0, 40), budget: w.budget })),
    });
  }
}
console.log('  multi-product opp → opp-ref Kantata workspace count:');
for (const [k, v] of Object.entries(matchDistribution)) {
  console.log(`    ${k} workspace(s): ${v} opps`);
}

console.log('\n  examples (multi-product opps with at least 1 matching Kantata workspace):');
for (const ex of matchedExamples) {
  console.log(`\n  ${ex.account} — ${ex.oppName.substring(0, 50)}`);
  console.log(`    products (${ex.productCount}): ${ex.products.join(', ')}`);
  console.log(`    direct opp-ref Kantata workspaces: ${ex.directWsCount}`);
  for (const w of ex.ws) {
    console.log(`      - "${w.title}" ($${w.budget})`);
  }
  console.log(`    account-ref Kantata workspaces also linked to this account: ${ex.accountWsCount}`);
}

// Also: are there multi-product opps with ZERO direct opp-ref workspaces but account-ref ones exist?
const zeroDirectButAccount = multiProductOpps.filter(([oppId, s]) => {
  const direct = wsByOppId.get(oppId) || [];
  if (direct.length > 0) return false;
  const account = oppsWithDep.find((o) => o.Id === oppId)?.AccountId;
  const acc = account ? wsByAccountId.get(account) || [] : [];
  return acc.length > 0;
});
console.log(`\n  multi-product opps with 0 direct opp-ref but ≥1 account-ref workspace: ${zeroDirectButAccount.length}`);
