require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Database = require('better-sqlite3');
const path = require('path');

async function getToken() {
  const loginUrl = process.env.SF_LOGIN_URL || 'https://test.salesforce.com';
  console.log(`Using Salesforce login URL: ${loginUrl}`);
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET
    })
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to get Salesforce token: ${JSON.stringify(data)}`);
  }
  return { token: data.access_token, instanceUrl: data.instance_url };
}

async function getCSMAssignments(token, instanceUrl) {
  const query = encodeURIComponent(`
    SELECT Id, Name, Customer_Success_Manager_csm__c,
      Customer_Success_Manager_csm__r.Id, Customer_Success_Manager_csm__r.Name, Customer_Success_Manager_csm__r.Email
    FROM Account
    WHERE Customer_Success_Manager_csm__c != null
  `);
  const res = await fetch(`${instanceUrl}/services/data/v59.0/query?q=${query}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.records) {
    throw new Error(`Failed to get CSM assignments: ${JSON.stringify(data)}`);
  }
  return data.records.map(r => ({
    accountId: r.Id,
    accountName: r.Name,
    csmId: r.Customer_Success_Manager_csm__r?.Id || r.Customer_Success_Manager_csm__c,
    csmName: r.Customer_Success_Manager_csm__r?.Name,
    csmEmail: r.Customer_Success_Manager_csm__r?.Email
  })).filter(a => a.csmEmail);
}

async function main() {
  const { token, instanceUrl } = await getToken();
  console.log('Got Salesforce token');

  const assignments = await getCSMAssignments(token, instanceUrl);
  console.log(`Got ${assignments.length} CSM assignments from Salesforce`);

  const db = new Database(path.join(__dirname, '../data/zendesk-cache.db'));

  const orgs = db.prepare('SELECT * FROM organizations').all();
  console.log(`Got ${orgs.length} organizations from cache`);

  const sfIdToOrg = new Map();
  const orgNameMap = new Map();

  for (const org of orgs) {
    // Build SF ID map
    if (org.salesforce_id) {
      sfIdToOrg.set(org.salesforce_id, org);
    }
    // Build name map for ALL orgs (fallback when SF ID doesn't match)
    const orgNameLower = org.name.toLowerCase().trim();
    if (orgNameLower.length >= 3) {
      orgNameMap.set(orgNameLower, org);
    }
    const normalized = orgNameLower
      .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, '')
      .trim();
    if (normalized.length >= 3 && normalized !== orgNameLower) {
      orgNameMap.set(normalized, org);
    }
  }

  console.log(`SF ID map: ${sfIdToOrg.size}, Name map: ${orgNameMap.size}`);

  db.prepare('DELETE FROM csm_assignments').run();

  const stmt = db.prepare(`
    INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let matchedBySfId = 0;
  let matchedByName = 0;
  let unmatched = 0;

  for (const a of assignments) {
    let zendeskOrg = sfIdToOrg.get(a.accountId);

    if (zendeskOrg) {
      matchedBySfId++;
    } else {
      const accountNameLower = a.accountName.toLowerCase().trim();
      const accountNameNormalized = accountNameLower
        .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, '')
        .trim();

      zendeskOrg = orgNameMap.get(accountNameLower) || orgNameMap.get(accountNameNormalized);

      if (!zendeskOrg && accountNameNormalized.length >= 5) {
        for (const [orgName, org] of orgNameMap) {
          if (orgName.length >= 5 && (
            orgName.includes(accountNameNormalized) || accountNameNormalized.includes(orgName)
          )) {
            zendeskOrg = org;
            break;
          }
        }
      }

      if (zendeskOrg) {
        matchedByName++;
      } else {
        unmatched++;
      }
    }

    stmt.run(a.accountId, a.accountName, a.csmId, a.csmName, a.csmEmail, zendeskOrg?.id || null);
  }

  console.log(`\nResults:`);
  console.log(`  Matched by SF ID: ${matchedBySfId}`);
  console.log(`  Matched by name: ${matchedByName}`);
  console.log(`  Unmatched: ${unmatched}`);

  const dupes = db.prepare(`
    SELECT zendesk_org_id, COUNT(*) as cnt, GROUP_CONCAT(account_name, ', ') as accounts
    FROM csm_assignments
    WHERE zendesk_org_id IS NOT NULL
    GROUP BY zendesk_org_id
    HAVING cnt > 1
  `).all();

  if (dupes.length > 0) {
    console.log(`\nWARNING: ${dupes.length} orgs are mapped to multiple accounts:`);
    for (const d of dupes.slice(0, 5)) {
      console.log(`  Org ${d.zendesk_org_id}: ${d.accounts}`);
    }
  } else {
    console.log(`\nNo duplicate mappings found!`);
  }

  db.close();
}

main().catch(console.error);
