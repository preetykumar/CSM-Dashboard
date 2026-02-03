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

// Get all organizations for matching (including salesforce_id)
const orgs = db.prepare('SELECT id, name, salesforce_id, salesforce_account_name FROM organizations').all();
console.log(`Found ${orgs.length} organizations in cache`);

// Primary: Build Salesforce ID lookup map (most accurate matching)
const orgBySalesforceId = new Map();
orgs.forEach(org => {
  if (org.salesforce_id) {
    // Store both the full ID and the 15-char prefix (SF uses 18-char IDs, but some systems use 15-char)
    orgBySalesforceId.set(org.salesforce_id, org);
    if (org.salesforce_id.length >= 15) {
      orgBySalesforceId.set(org.salesforce_id.substring(0, 15), org);
    }
  }
});
console.log(`${orgBySalesforceId.size / 2} organizations have Salesforce IDs for direct matching`);

// Normalize company names for better matching
function normalize(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents (é → e, ü → u)
    .replace(/[.,'"]/g, '') // Remove punctuation
    .replace(/\s+(inc|llc|corp|corporation|company|co|ltd|limited|group|holdings|platforms)\.?$/i, '') // Remove suffixes
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Known name mappings for difficult matches
const nameAliases = {
  'the new york times': 'nytimes',
  'new york times': 'nytimes',
  'iron mountain': 'ironmountain',
  'meta platforms': 'meta',
  'williams-sonoma': 'williams sonoma',
  'fis': 'fisglobal',
  'cox': 'cox communications',
  'bristol-myers squibb': 'bms',
  'ion': 'iongroup',
  'on location experiences': 'onlocationexp',
};

// Extract company name from domain (e.g., "accenture.com" -> "accenture")
function extractFromDomain(name) {
  const domainMatch = name.match(/^([a-z0-9-]+)\.(com|org|net|io|co|edu|gov)$/i);
  return domainMatch ? domainMatch[1].toLowerCase() : null;
}

// Known acronym expansions
const acronymMap = {
  'fbi': 'federal bureau of investigation',
  'cia': 'central intelligence agency',
  'sba': 'small business administration',
  'idc': 'international data corporation',
  'olg': 'ontario lottery and gaming',
  'fis': 'fidelity national information services',
};

// Create multiple lookup maps for different matching strategies
const orgByExactName = new Map();      // Exact lowercase match
const orgByNormalized = new Map();      // Normalized name match
const orgByDomain = new Map();          // Domain-extracted name
const orgByFirstWord = new Map();       // First significant word
const orgByKeyword = new Map();         // Significant keywords (4+ chars)

orgs.forEach(org => {
  const nameLower = org.name.toLowerCase();
  const normalized = normalize(org.name);

  // Exact match
  orgByExactName.set(nameLower, org);
  if (org.salesforce_account_name) {
    orgByExactName.set(org.salesforce_account_name.toLowerCase(), org);
  }

  // Normalized match
  if (!orgByNormalized.has(normalized)) {
    orgByNormalized.set(normalized, org);
  }

  // Domain-based match
  const domainName = extractFromDomain(org.name);
  if (domainName && !orgByDomain.has(domainName)) {
    orgByDomain.set(domainName, org);
  }

  // First word match (for cases like "Accenture Federal" matching "Accenture")
  const firstWord = normalized.split(' ')[0];
  if (firstWord.length >= 4 && !orgByFirstWord.has(firstWord)) {
    orgByFirstWord.set(firstWord, org);
  }

  // Keyword match - extract significant words (5+ chars) for fuzzy matching
  const words = normalized.split(' ').filter(w => w.length >= 5);
  for (const word of words) {
    if (!orgByKeyword.has(word)) {
      orgByKeyword.set(word, org);
    }
  }
});

// Find best matching Zendesk org for a Salesforce account
function findMatchingOrg(accountId, accountName) {
  // 0. Salesforce ID match (highest priority - most accurate)
  // Try both the full 18-char ID and the 15-char prefix
  if (orgBySalesforceId.has(accountId)) {
    return { org: orgBySalesforceId.get(accountId), matchType: 'sf-id' };
  }
  if (accountId.length >= 15 && orgBySalesforceId.has(accountId.substring(0, 15))) {
    return { org: orgBySalesforceId.get(accountId.substring(0, 15)), matchType: 'sf-id' };
  }

  const nameLower = accountName.toLowerCase();
  const normalized = normalize(accountName);
  const firstWord = normalized.split(' ')[0];

  // 1. Exact name match
  if (orgByExactName.has(nameLower)) {
    return { org: orgByExactName.get(nameLower), matchType: 'exact' };
  }

  // 1.5. Acronym expansion (FBI -> federal bureau of investigation)
  if (acronymMap[normalized]) {
    if (orgByNormalized.has(acronymMap[normalized])) {
      return { org: orgByNormalized.get(acronymMap[normalized]), matchType: 'acronym' };
    }
  }

  // 1.6. Name alias lookup (The New York Times -> nytimes)
  if (nameAliases[normalized]) {
    const alias = nameAliases[normalized];
    if (orgByDomain.has(alias)) {
      return { org: orgByDomain.get(alias), matchType: 'alias' };
    }
    if (orgByNormalized.has(alias)) {
      return { org: orgByNormalized.get(alias), matchType: 'alias' };
    }
  }

  // 2. Normalized match
  if (orgByNormalized.has(normalized)) {
    return { org: orgByNormalized.get(normalized), matchType: 'normalized' };
  }

  // 3. Domain-based match (Salesforce name matches domain prefix)
  if (orgByDomain.has(normalized)) {
    return { org: orgByDomain.get(normalized), matchType: 'domain' };
  }

  // 3.5. Domain normalization (e.g., "T. Rowe Price" -> "troweprice")
  const domainNormalized = normalized.replace(/[.\s-]/g, '');
  if (domainNormalized.length >= 5 && orgByDomain.has(domainNormalized)) {
    return { org: orgByDomain.get(domainNormalized), matchType: 'domain' };
  }

  // 4. First word match (for subsidiary/division matching)
  if (firstWord.length >= 4 && orgByFirstWord.has(firstWord)) {
    return { org: orgByFirstWord.get(firstWord), matchType: 'first-word' };
  }

  // 4.5. Keyword match (e.g., "disney" appears in both "Disney Technology Services" and "The Walt Disney Company")
  const words = normalized.split(' ').filter(w => w.length >= 5);
  for (const word of words) {
    if (orgByKeyword.has(word)) {
      return { org: orgByKeyword.get(word), matchType: 'keyword' };
    }
  }

  // 5. Partial contains match (check if SF name contains or is contained by ZD org name)
  for (const [zdName, org] of orgByExactName) {
    const zdNormalized = normalize(zdName);
    if (zdNormalized.length >= 4 && normalized.length >= 4) {
      if (normalized.includes(zdNormalized) || zdNormalized.includes(normalized)) {
        return { org, matchType: 'partial' };
      }
    }
  }

  return { org: null, matchType: 'none' };
}

// Clear existing CSM assignments
db.prepare('DELETE FROM csm_assignments').run();

// Insert new assignments
const insertStmt = db.prepare(`
  INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

let matched = 0;
let unmatched = 0;
const matchTypes = { 'sf-id': 0, exact: 0, acronym: 0, alias: 0, normalized: 0, domain: 0, 'first-word': 0, keyword: 0, partial: 0, none: 0 };

for (const account of queryData.records) {
  const csmId = account.Customer_Success_Manager_csm__r?.Id || account.Customer_Success_Manager_csm__c || '';
  const csmName = account.Customer_Success_Manager_csm__r?.Name || '';
  const csmEmail = account.Customer_Success_Manager_csm__r?.Email || '';

  // Try to find matching Zendesk org using improved matching (SF ID first, then name)
  const { org: matchedOrg, matchType } = findMatchingOrg(account.Id, account.Name);
  const zendeskOrgId = matchedOrg?.id || null;

  matchTypes[matchType]++;

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
console.log(`\n   Match breakdown:`);
console.log(`     - Salesforce ID: ${matchTypes['sf-id']}`);
console.log(`     - Exact name: ${matchTypes.exact}`);
console.log(`     - Acronym: ${matchTypes.acronym}`);
console.log(`     - Alias: ${matchTypes.alias}`);
console.log(`     - Normalized: ${matchTypes.normalized}`);
console.log(`     - Domain: ${matchTypes.domain}`);
console.log(`     - First-word: ${matchTypes['first-word']}`);
console.log(`     - Keyword: ${matchTypes.keyword}`);
console.log(`     - Partial: ${matchTypes.partial}`);

// Show sample CSM data
console.log('\nSample CSM assignments:');
const samples = db.prepare('SELECT csm_name, csm_email, account_name, zendesk_org_id FROM csm_assignments LIMIT 5').all();
samples.forEach(s => {
  console.log(`  - ${s.csm_name} (${s.csm_email}): ${s.account_name} → org:${s.zendesk_org_id || 'NOT MATCHED'}`);
});

db.close();
