#!/usr/bin/env node

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const subdomain = process.env.ZENDESK_SUBDOMAIN;
const email = process.env.ZENDESK_EMAIL;
const token = process.env.ZENDESK_API_TOKEN;

const auth = Buffer.from(`${email}/token:${token}`).toString('base64');

async function fetchAllOrgs() {
  const allOrgs = [];
  let page = 1;

  console.log('Fetching all Zendesk organizations...');

  while (true) {
    const response = await fetch(
      `https://${subdomain}.zendesk.com/api/v2/organizations.json?page=${page}&per_page=100`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    const data = await response.json();
    allOrgs.push(...data.organizations);

    if (page % 5 === 0) {
      console.log(`  Fetched ${allOrgs.length} organizations (page ${page})...`);
    }

    if (!data.next_page) break;
    page++;
  }

  console.log(`Total: ${allOrgs.length} organizations`);

  // Now insert into database
  const dbPath = path.join(__dirname, '..', 'data', 'zendesk-cache.db');
  const db = new Database(dbPath);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  let withSfId = 0;
  for (const org of allOrgs) {
    const sfId = org.organization_fields?.salesforce_id || null;
    if (sfId) withSfId++;

    insertStmt.run(
      org.id,
      org.name,
      JSON.stringify(org.domain_names || []),
      sfId,
      null,
      org.created_at,
      org.updated_at
    );
  }

  db.prepare(`
    INSERT OR REPLACE INTO sync_status (type, last_sync, status, record_count, error_message)
    VALUES ('organizations', CURRENT_TIMESTAMP, 'success', ?, NULL)
  `).run(allOrgs.length);

  db.close();

  console.log(`\n✅ Synced ${allOrgs.length} organizations (${withSfId} with Salesforce ID)`);
}

fetchAllOrgs().catch(console.error);
