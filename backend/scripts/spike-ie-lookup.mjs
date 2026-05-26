#!/usr/bin/env node
// Probe SF directly for the IE assignment fields to figure out why
// portfolio-resolver's IE lookup returns 0 accounts for users who should have them.
//
// Usage: node backend/scripts/spike-ie-lookup.mjs

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
if (!tokenRes.ok) {
  console.error('Auth failed:', auth);
  process.exit(1);
}

async function soql(q) {
  const r = await fetch(
    `${auth.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.records;
}

// 1) How many accounts have ANY of CSE1/2/3 populated?
console.log('--- counts ---');
const c1 = await soql(`SELECT COUNT(Id) ct FROM Account WHERE Customer_Success_Engineer_CSE1__c != null`);
const c2 = await soql(`SELECT COUNT(Id) ct FROM Account WHERE Customer_Success_Engineer_CSE2__c != null`);
const c3 = await soql(`SELECT COUNT(Id) ct FROM Account WHERE Customer_Success_Engineer_CSE3__c != null`);
console.log('CSE1 populated:', c1[0].ct);
console.log('CSE2 populated:', c2[0].ct);
console.log('CSE3 populated:', c3[0].ct);

// 2) Unique IE emails across the three slots
console.log('\n--- unique IE emails (CSE1) ---');
const rows1 = await soql(`
  SELECT Customer_Success_Engineer_CSE1__r.Email
  FROM Account
  WHERE Customer_Success_Engineer_CSE1__c != null
`);
const emails1 = new Set(rows1.map(r => r.Customer_Success_Engineer_CSE1__r?.Email).filter(Boolean));
console.log([...emails1].sort());

console.log('\n--- unique IE emails (CSE2) ---');
const rows2 = await soql(`
  SELECT Customer_Success_Engineer_CSE2__r.Email
  FROM Account
  WHERE Customer_Success_Engineer_CSE2__c != null
`);
const emails2 = new Set(rows2.map(r => r.Customer_Success_Engineer_CSE2__r?.Email).filter(Boolean));
console.log([...emails2].sort());

console.log('\n--- unique IE emails (CSE3) ---');
const rows3 = await soql(`
  SELECT Customer_Success_Engineer_CSE3__r.Email
  FROM Account
  WHERE Customer_Success_Engineer_CSE3__c != null
`);
const emails3 = new Set(rows3.map(r => r.Customer_Success_Engineer_CSE3__r?.Email).filter(Boolean));
console.log([...emails3].sort());

// 3) Look up Ankit / Brandon / Wes specifically — try a few likely email patterns
const candidates = [
  'ankit.shrivastava@deque.com',
  'ankit.srivastava@deque.com',
  'brandon.murray@deque.com',
  'brandon@deque.com',
  'wes.cagle@deque.com',
  'wesley.cagle@deque.com',
  'wes@deque.com',
];

console.log('\n--- specific email probes ---');
for (const e of candidates) {
  const rows = await soql(`
    SELECT Id, Name
    FROM Account
    WHERE Customer_Success_Engineer_CSE1__r.Email = '${e}'
       OR Customer_Success_Engineer_CSE2__r.Email = '${e}'
       OR Customer_Success_Engineer_CSE3__r.Email = '${e}'
  `);
  console.log(`${e}: ${rows.length} accounts`);
}

// 4) Find Ankit / Brandon / Wes in User by name (in case email is different)
console.log('\n--- User lookup by name ---');
const users = await soql(`
  SELECT Id, Name, Email, IsActive
  FROM User
  WHERE Name LIKE '%Ankit%' OR Name LIKE '%Brandon%' OR Name LIKE '%Cagle%'
`);
for (const u of users) console.log(`${u.Name} | ${u.Email} | active=${u.IsActive}`);

// 5) Sample 5 rows with CSE1 populated to see real shape
console.log('\n--- sample 5 accounts with CSE1 set ---');
const sample = await soql(`
  SELECT Id, Name,
         Customer_Success_Engineer_CSE1__r.Name, Customer_Success_Engineer_CSE1__r.Email,
         Customer_Success_Engineer_CSE2__r.Name, Customer_Success_Engineer_CSE2__r.Email,
         Customer_Success_Engineer_CSE3__r.Name, Customer_Success_Engineer_CSE3__r.Email
  FROM Account
  WHERE Customer_Success_Engineer_CSE1__c != null
  LIMIT 5
`);
for (const a of sample) {
  console.log(`${a.Name}`);
  console.log(`  CSE1: ${a.Customer_Success_Engineer_CSE1__r?.Name} <${a.Customer_Success_Engineer_CSE1__r?.Email}>`);
  if (a.Customer_Success_Engineer_CSE2__r) console.log(`  CSE2: ${a.Customer_Success_Engineer_CSE2__r?.Name} <${a.Customer_Success_Engineer_CSE2__r?.Email}>`);
  if (a.Customer_Success_Engineer_CSE3__r) console.log(`  CSE3: ${a.Customer_Success_Engineer_CSE3__r?.Name} <${a.Customer_Success_Engineer_CSE3__r?.Email}>`);
}
