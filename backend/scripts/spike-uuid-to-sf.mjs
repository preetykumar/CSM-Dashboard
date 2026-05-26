#!/usr/bin/env node
// Verify that the gp:enterpriseId UUIDs we found in Amplitude actually map
// to SF Enterprise_Subscription__c.Enterprise_UUID__c records.
//
// Sample UUIDs from the cross-product probe:
//   ed2cf5b0-f0fa-49ee-a9b1-fa237064ce31  (DevTools, Dev Hub, DQU, MCP)
//   e65c6ea9-692a-4249-a1c3-cd36c0ce3c74  (DevTools, DQU)
//   48102fdd-4abe-4cf7-a897-ef4a07115a31  (DevTools)
//   4eba0ac5-d76a-4148-9d35-a2aebd2674ec  (DQU top)
//   551cdaa2-383b-4a41-86cc-9ca9fc5adb05  (Axe Reports)

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
const claims = { iss: clientId, sub: username, aud: loginUrl, exp: Math.floor(Date.now() / 1000) + 300 };
const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });

const params = new URLSearchParams();
params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
params.append('assertion', assertion);
const tokenRes = await fetch(`${loginUrl}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
const auth = await tokenRes.json();
if (!tokenRes.ok) { console.error('Auth failed:', auth); process.exit(1); }

async function soql(q) {
  const r = await fetch(`${auth.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.records;
}

const probeUUIDs = [
  "ed2cf5b0-f0fa-49ee-a9b1-fa237064ce31",
  "e65c6ea9-692a-4249-a1c3-cd36c0ce3c74",
  "48102fdd-4abe-4cf7-a897-ef4a07115a31",
  "4eba0ac5-d76a-4148-9d35-a2aebd2674ec",
  "551cdaa2-383b-4a41-86cc-9ca9fc5adb05",
];

console.log("=== Look up each Amplitude gp:enterpriseId in SF Enterprise_Subscription__c.Enterprise_UUID__c ===\n");
for (const uuid of probeUUIDs) {
  const rows = await soql(`
    SELECT Id, Name, Enterprise_UUID__c, Account__c, Account__r.Name
    FROM Enterprise_Subscription__c
    WHERE Enterprise_UUID__c = '${uuid}'
  `);
  console.log(`  ${uuid}`);
  if (rows.length === 0) {
    console.log(`    ❌ NOT FOUND in Enterprise_Subscription__c.Enterprise_UUID__c`);
  } else {
    for (const r of rows) {
      console.log(`    ✅ ${r.Account__r?.Name || r.Account__c} | sub=${r.Name}`);
    }
  }
}

// Also check what fraction of Enterprise_Subscription__c records have a UUID
console.log("\n=== Enterprise_UUID__c coverage on Enterprise_Subscription__c ===");
const total = await soql(`SELECT COUNT(Id) ct FROM Enterprise_Subscription__c`);
const withUUID = await soql(`SELECT COUNT(Id) ct FROM Enterprise_Subscription__c WHERE Enterprise_UUID__c != null`);
console.log(`  total subs: ${total[0].ct}`);
console.log(`  with UUID:  ${withUUID[0].ct}`);

// Sample some UUIDs from SF side to compare shape
console.log("\n=== Sample 10 SF Enterprise_UUID__c values (to confirm shape matches Amplitude) ===");
const sample = await soql(`
  SELECT Enterprise_UUID__c, Account__r.Name
  FROM Enterprise_Subscription__c
  WHERE Enterprise_UUID__c != null
  LIMIT 10
`);
for (const r of sample) {
  console.log(`  ${r.Enterprise_UUID__c}  ←  ${r.Account__r?.Name}`);
}
