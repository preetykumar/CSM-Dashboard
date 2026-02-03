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

// Custom field IDs (from the Zendesk instance)
const FIELD_IDS = {
  product: 360006927731,
  module: 360007005812,
  ticketType: 360006927751,
  workflowStatus: 6529498988564,
  issueSubtype: 24686422,
  isEscalated: 360025846651,
};

function extractCustomFields(ticket) {
  const fields = ticket.custom_fields || [];
  const fieldMap = new Map(fields.map(f => [f.id, f.value]));

  return {
    product: fieldMap.get(FIELD_IDS.product) || null,
    module: fieldMap.get(FIELD_IDS.module) || null,
    ticketType: fieldMap.get(FIELD_IDS.ticketType) || null,
    workflowStatus: fieldMap.get(FIELD_IDS.workflowStatus) || null,
    issueSubtype: fieldMap.get(FIELD_IDS.issueSubtype) || null,
    isEscalated: fieldMap.get(FIELD_IDS.isEscalated) === 'true' ||
                 fieldMap.get(FIELD_IDS.isEscalated) === true ||
                 fieldMap.get(FIELD_IDS.isEscalated) === 'escalated',
  };
}

async function fetchTicketsForOrg(orgId) {
  const allTickets = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://${subdomain}.zendesk.com/api/v2/organizations/${orgId}/tickets.json?page=${page}&per_page=100`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Failed to fetch tickets: ${response.status}`);
    }

    const data = await response.json();
    allTickets.push(...data.tickets);

    if (!data.next_page) break;
    page++;

    // Rate limiting protection
    if (page > 10) break; // Max 1000 tickets per org
  }

  return allTickets;
}

async function main() {
  console.log('Ticket Sync from Zendesk');
  console.log('========================');

  // Open database
  const dbPath = path.join(__dirname, '..', 'data', 'zendesk-cache.db');
  const db = new Database(dbPath);

  // Get all organizations
  const orgs = db.prepare('SELECT id, name FROM organizations').all();
  console.log(`Found ${orgs.length} organizations to sync tickets for`);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, product, module, ticket_type, workflow_status, issue_subtype, is_escalated, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  let totalTickets = 0;
  let orgsProcessed = 0;
  const startTime = Date.now();

  for (const org of orgs) {
    try {
      const tickets = await fetchTicketsForOrg(org.id);

      for (const ticket of tickets) {
        const customFields = extractCustomFields(ticket);

        insertStmt.run(
          ticket.id,
          ticket.organization_id || 0,
          ticket.subject || '',
          ticket.status,
          ticket.priority || 'normal',
          ticket.requester_id,
          ticket.assignee_id || null,
          JSON.stringify(ticket.tags || []),
          ticket.created_at,
          ticket.updated_at,
          customFields.product,
          customFields.module,
          customFields.ticketType,
          customFields.workflowStatus,
          customFields.issueSubtype,
          customFields.isEscalated ? 1 : 0
        );
      }

      totalTickets += tickets.length;
      orgsProcessed++;

      if (orgsProcessed % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`  Progress: ${orgsProcessed}/${orgs.length} orgs, ${totalTickets} tickets (${elapsed.toFixed(0)}s)`);
      }

      // Small delay to avoid rate limiting
      if (tickets.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`  Error syncing tickets for ${org.name}:`, error.message);
    }
  }

  // Update sync status
  db.prepare(`
    INSERT OR REPLACE INTO sync_status (type, last_sync, status, record_count, error_message)
    VALUES ('tickets', CURRENT_TIMESTAMP, 'success', ?, NULL)
  `).run(totalTickets);

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n✅ Sync complete!`);
  console.log(`   Total tickets: ${totalTickets}`);
  console.log(`   Organizations processed: ${orgsProcessed}`);
  console.log(`   Time elapsed: ${elapsed.toFixed(0)}s`);

  // Show Nestle specifically since that was the concern
  const nestleTickets = db.prepare(`
    SELECT COUNT(*) as count FROM tickets t
    JOIN organizations o ON t.organization_id = o.id
    WHERE o.name LIKE '%Nestle%' OR o.name LIKE '%nestle%'
  `).get();
  console.log(`\n   Nestle tickets: ${nestleTickets.count}`);

  db.close();
}

main().catch(console.error);
