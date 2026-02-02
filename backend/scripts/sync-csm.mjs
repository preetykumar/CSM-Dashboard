#!/usr/bin/env node

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load config
const clientId = process.env.SF_CLIENT_ID;
const username = process.env.SF_USERNAME;
const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;
const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

console.log('CSM Sync from Production Salesforce');
console.log('====================================');

// Get SF access token
const keyPath = path.resolve(path.join(__dirname, '..', privateKeyPath));
const privateKey = fs.readFileSync(keyPath, 'utf8');

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: clientId,
  sub: username,
  aud: loginUrl,
  exp: now + 300,
};

const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });

const params = new URLSearchParams();
params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
params.append('assertion', assertion);

const tokenResponse = await fetch(`${loginUrl}/services/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params,
});

const tokenData = await tokenResponse.json();
if (!tokenResponse.ok) {
  console.error('Auth failed:', tokenData);
  process.exit(1);
}

console.log('✅ Authenticated with Salesforce');
console.log('Instance:', tokenData.instance_url);

// Query CSM assignments
const soql = `
  SELECT Id, Name, Customer_Success_Manager_csm__c, Customer_Success_Manager_csm__r.Id,
         Customer_Success_Manager_csm__r.Name, Customer_Success_Manager_csm__r.Email
  FROM Account
  WHERE Customer_Success_Manager_csm__c != null
`;

console.log('\nFetching CSM assignments...');
const queryResponse = await fetch(
  `${tokenData.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
  {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
  }
);

const queryData = await queryResponse.json();
if (!queryResponse.ok) {
  console.error('Query failed:', queryData);
  process.exit(1);
}

console.log(`✅ Found ${queryData.records.length} accounts with CSM assignments`);

// Open database
const dbPath = path.join(__dirname, '..', 'data', 'zendesk-cache.db');
const db = new Database(dbPath);

// Get all organizations for matching
const orgs = db.prepare('SELECT id, name, salesforce_account_name FROM organizations').all();
console.log(`Found ${orgs.length} organizations in cache`);

// Create name lookup map (lowercase for fuzzy matching)
const orgByName = new Map();
orgs.forEach(org => {
  orgByName.set(org.name.toLowerCase(), org);
  if (org.salesforce_account_name) {
    orgByName.set(org.salesforce_account_name.toLowerCase(), org);
  }
});

// Clear existing CSM assignments
db.prepare('DELETE FROM csm_assignments').run();

// Insert new assignments
const insertStmt = db.prepare(`
  INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

let matched = 0;
let unmatched = 0;

for (const account of queryData.records) {
  const csmId = account.Customer_Success_Manager_csm__r?.Id || account.Customer_Success_Manager_csm__c || '';
  const csmName = account.Customer_Success_Manager_csm__r?.Name || '';
  const csmEmail = account.Customer_Success_Manager_csm__r?.Email || '';

  // Try to find matching Zendesk org
  const accountNameLower = account.Name.toLowerCase();
  const matchedOrg = orgByName.get(accountNameLower);

  const zendeskOrgId = matchedOrg?.id || null;

  if (zendeskOrgId) {
    matched++;
  } else {
    unmatched++;
  }

  insertStmt.run(account.Id, account.Name, csmId, csmName, csmEmail, zendeskOrgId);
}

// Update sync status
db.prepare(`
  INSERT OR REPLACE INTO sync_status (type, last_sync, status, record_count, error_message)
  VALUES ('csm_assignments', CURRENT_TIMESTAMP, 'success', ?, NULL)
`).run(queryData.records.length);

console.log(`\n✅ Sync complete!`);
console.log(`   Total accounts: ${queryData.records.length}`);
console.log(`   Matched to Zendesk orgs: ${matched}`);
console.log(`   Unmatched: ${unmatched}`);

// Show sample CSM data
console.log('\nSample CSM assignments:');
const samples = db.prepare('SELECT csm_name, csm_email, account_name, zendesk_org_id FROM csm_assignments LIMIT 5').all();
samples.forEach(s => {
  console.log(`  - ${s.csm_name} (${s.csm_email}): ${s.account_name} → org:${s.zendesk_org_id || 'NOT MATCHED'}`);
});

db.close();
