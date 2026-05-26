#!/usr/bin/env node
// Probe whether the API user can now read OpportunityLineItem (we filed
// an SF Admin request earlier; the user says it's been granted).
//
// What we want to learn:
//   - Can we query OpportunityLineItem at all?
//   - For a sample of closed-won renewal opps, what ProductCode values
//     come back? (We need this list to choose deployment SKUs.)
//
// Usage: node backend/scripts/spike-opportunity-line-items.mjs

import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clientId = process.env.SF_CLIENT_ID;
const username = process.env.SF_USERNAME;
const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;
const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

const keyPath = path.resolve(path.join(__dirname, '..', privateKeyPath));
const privateKey = fs.readFileSync(keyPath, 'utf8');

const claims = {
  iss: clientId,
  sub: username,
  aud: loginUrl,
  exp: Math.floor(Date.now() / 1000) + 300,
};
const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });

const params = new URLSearchParams();
params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
params.append('assertion', assertion);

const tokenRes = await fetch(`${loginUrl}/services/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params,
});
const auth = await tokenRes.json();
if (!tokenRes.ok) { console.error('Auth failed:', auth); process.exit(1); }

async function soql(q) {
  const r = await fetch(
    `${auth.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d, null, 2));
  return d;
}

// 1) Can we query OpportunityLineItem at all? Smallest possible query.
console.log('=== Test 1: minimum OpportunityLineItem query ===');
try {
  const res = await soql(`SELECT Id FROM OpportunityLineItem LIMIT 1`);
  console.log(`OK: returned ${res.records.length} record(s)`);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}

// 2) Can we read ProductCode + ProductName + OpportunityId fields?
console.log('\n=== Test 2: OpportunityLineItem with ProductCode + OpportunityId ===');
try {
  const res = await soql(`
    SELECT Id, OpportunityId, Product2Id, ProductCode, Quantity, UnitPrice
    FROM OpportunityLineItem
    LIMIT 5
  `);
  console.log(`OK: ${res.records.length} records`);
  for (const r of res.records) {
    console.log(`  ${r.Id} | opp=${r.OpportunityId} | code=${r.ProductCode} | qty=${r.Quantity}`);
  }
} catch (e) {
  console.error('FAILED:', e.message);
}

// 3) Pull a sample of recent closed-won renewal opps and their line items.
console.log('\n=== Test 3: closed-won renewal opp line items (last 90 days) ===');
const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString().split('T')[0];
try {
  const opps = await soql(`
    SELECT Id, Name, AccountId, CloseDate
    FROM Opportunity
    WHERE StageName = '8 - Closed Won'
      AND Type = 'Renewal'
      AND CloseDate >= ${ninetyDaysAgo}
    LIMIT 10
  `);
  console.log(`Found ${opps.records.length} closed-won renewal opps`);
  if (opps.records.length > 0) {
    const oppIds = opps.records.map(o => `'${o.Id}'`).join(',');
    const lines = await soql(`
      SELECT Id, OpportunityId, ProductCode, Product2.Name, Product2.Family, Quantity, UnitPrice, TotalPrice
      FROM OpportunityLineItem
      WHERE OpportunityId IN (${oppIds})
    `);
    console.log(`Returned ${lines.records.length} line items`);
    for (const l of lines.records) {
      const opp = opps.records.find(o => o.Id === l.OpportunityId);
      console.log(`  opp=${opp?.Name?.substring(0, 40)} | code=${l.ProductCode} | name=${l.Product2?.Name} | family=${l.Product2?.Family} | qty=${l.Quantity}`);
    }
  }
} catch (e) {
  console.error('FAILED:', e.message);
}

// 4) Distinct ProductCode values across line items (limited to a slice for cost).
console.log('\n=== Test 4: distinct ProductCode values (broad sample) ===');
try {
  const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().split('T')[0];
  const opps = await soql(`
    SELECT Id FROM Opportunity
    WHERE StageName = '8 - Closed Won'
      AND CloseDate >= ${oneYearAgo}
  `);
  console.log(`Sampling from ${opps.records.length} closed-won opps in last year`);

  // Chunk into 200s to stay under SOQL limits
  const codes = new Map();
  for (let i = 0; i < opps.records.length; i += 200) {
    const chunk = opps.records.slice(i, i + 200);
    const inList = chunk.map(o => `'${o.Id}'`).join(',');
    const lines = await soql(`
      SELECT ProductCode, Product2.Name, Product2.Family
      FROM OpportunityLineItem
      WHERE OpportunityId IN (${inList})
    `);
    for (const l of lines.records) {
      const key = l.ProductCode || '(none)';
      if (!codes.has(key)) {
        codes.set(key, { count: 0, productName: l.Product2?.Name, family: l.Product2?.Family });
      }
      codes.get(key).count++;
    }
  }

  console.log(`\nDistinct ProductCode values (${codes.size}):`);
  const sorted = [...codes.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [code, info] of sorted) {
    console.log(`  ${code.padEnd(30)} count=${String(info.count).padStart(5)} | ${info.productName} (${info.family})`);
  }
} catch (e) {
  console.error('FAILED:', e.message);
}
