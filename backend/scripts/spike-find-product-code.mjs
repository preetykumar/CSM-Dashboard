#!/usr/bin/env node
// Re-examine where ProductCode actually lives in Deque's SF org. The standard
// `OpportunityLineItem` object returned an error that hinted at a custom-
// object alternative ("be sure to append '__c'"). Two possibilities:
//   1. The standard OpportunityLineItem object isn't readable by this API
//      user — permissions need to be granted.
//   2. Deque has a custom object that holds the line-item data instead.
//
// This script: (a) lists all sObjects accessible to this user that match
// /opp|line|product/i and (b) for each, dumps a field summary so we can see
// where ProductCode lives.
//
// Usage: node backend/scripts/spike-find-product-code.mjs

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
  iss: clientId, sub: username, aud: loginUrl,
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

async function get(p) {
  const r = await fetch(`${auth.instance_url}${p}`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d, null, 2));
  return d;
}

// 1) List ALL sObjects, filter by interesting names
console.log('=== sObjects matching /opp|line|product|sku/i (queryable) ===');
const all = await get('/services/data/v59.0/sobjects/');
const interesting = all.sobjects
  .filter((s) => /opp|line|product|sku/i.test(s.name))
  .filter((s) => s.queryable);
for (const s of interesting) {
  console.log(`  ${s.name.padEnd(40)} label="${s.label}" custom=${s.custom}`);
}

// 2) For each, describe and look for a "ProductCode"-ish field
console.log('\n=== Fields containing "ProductCode" or "SKU" in any matching sObject ===');
for (const s of interesting) {
  try {
    const desc = await get(`/services/data/v59.0/sobjects/${s.name}/describe/`);
    const codeFields = desc.fields.filter((f) =>
      /productcode|product_code|sku|product__c/i.test(f.name) ||
      /productcode|product code|sku/i.test(f.label || '')
    );
    if (codeFields.length > 0) {
      console.log(`\n  ${s.name}:`);
      for (const f of codeFields) {
        console.log(`    ${f.name.padEnd(40)} type=${f.type} label="${f.label}"`);
      }
    }
  } catch (e) {
    console.log(`  ${s.name}: describe failed (${e.message.split('\n')[0]})`);
  }
}

// 3) For Opportunity specifically — list ALL fields to be sure no built-in
//    field carries the product code list
console.log('\n=== ALL fields on Opportunity that mention product/sku/code ===');
try {
  const desc = await get('/services/data/v59.0/sobjects/Opportunity/describe/');
  const matches = desc.fields.filter((f) =>
    /product|sku|code/i.test(f.name) || /product|sku|code/i.test(f.label || '')
  );
  for (const f of matches) {
    console.log(`  ${f.name.padEnd(45)} type=${f.type.padEnd(12)} label="${f.label}"`);
  }
} catch (e) {
  console.log('  failed:', e.message);
}

// 4) Try OpportunityLineItem describe specifically to see the exact error / access state
console.log('\n=== Direct describe of OpportunityLineItem (does the user have access?) ===');
try {
  const desc = await get('/services/data/v59.0/sobjects/OpportunityLineItem/describe/');
  console.log(`  ACCESSIBLE. ${desc.fields.length} fields total.`);
  const codeFields = desc.fields.filter((f) => /productcode|product_code|sku/i.test(f.name));
  for (const f of codeFields) {
    console.log(`    ${f.name.padEnd(40)} type=${f.type} label="${f.label}"`);
  }
} catch (e) {
  console.log('  NOT ACCESSIBLE.');
  console.log('  Error:', e.message.split('\n').slice(0, 3).join('\n  '));
}

// 5) Check Product2 — even if line item is locked, product master data
//    might be readable
console.log('\n=== Direct describe of Product2 ===');
try {
  const desc = await get('/services/data/v59.0/sobjects/Product2/describe/');
  console.log(`  ACCESSIBLE. ${desc.fields.length} fields total.`);
  const codeFields = desc.fields.filter((f) => /productcode|sku|family/i.test(f.name));
  for (const f of codeFields) {
    console.log(`    ${f.name.padEnd(40)} type=${f.type} label="${f.label}"`);
  }

  // Sample some products with codes
  console.log('\n  Sample Product2 records (with ProductCode):');
  const sample = await get(`/services/data/v59.0/query?q=${encodeURIComponent(
    `SELECT Id, Name, ProductCode, Family FROM Product2 WHERE ProductCode != null LIMIT 20`
  )}`);
  for (const r of sample.records) {
    console.log(`    ${(r.ProductCode || '').padEnd(20)} ${(r.Family || '').padEnd(20)} ${r.Name}`);
  }
} catch (e) {
  console.log('  NOT ACCESSIBLE.');
  console.log('  Error:', e.message.split('\n').slice(0, 3).join('\n  '));
}
