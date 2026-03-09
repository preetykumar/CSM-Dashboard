import type { IDatabaseService, CachedOrganization, CachedTicket, CachedCSMAssignment, CachedPMAssignment, CachedGitHubLink, CachedAccountHierarchy } from "./database-interface.js";
import { ZendeskService } from "./zendesk.js";
import { SalesforceService, CSMAssignment, PMAssignment, AccountHierarchyEntry } from "./salesforce.js";
import { GitHubService } from "./github.js";
import type { Organization, Ticket } from "../types/index.js";
import { renewalsCache, salesforceCache } from "./cache.js";

// Helper function to normalize text by removing diacritical marks (accents)
// e.g., "Nestlé" -> "nestle", "Café" -> "cafe"
function normalizeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Helper: Check if parenthesized acronyms in one name match the initials of another.
// e.g., "British American Shared Services (GSD) Limited (BAT)" contains "(BAT)"
// and "British American Tobacco" has initials B-A-T → match.
function matchesParenthesizedAcronym(nameWithAcronyms: string, candidateName: string): boolean {
  const acronyms = [...nameWithAcronyms.matchAll(/\(([a-zA-Z]{3,})\)/g)].map(m => m[1].toLowerCase());
  if (acronyms.length === 0) return false;
  const words = candidateName.split(/[\s-]+/).filter(w => w.length > 0);
  if (words.length < 2) return false;
  const initials = words.map(w => w[0].toLowerCase()).join('');
  return acronyms.some(acr => initials === acr);
}

// Helper: Strip domain suffixes from org names (e.g., "BMS.com" → "BMS")
function stripDomainSuffix(name: string): string {
  return name.replace(/\.(com|org|net|io|co|edu|gov|us|uk|de|fr|ca|au|jp|in)$/i, '').trim();
}

// Helper: Get initials from a company name, splitting on spaces and hyphens.
// e.g., "Bristol-Myers Squibb" → "bms", "General Electric" → "ge"
function getCompanyInitials(name: string): string {
  const words = name.split(/[\s-]+/).filter(w => w.length > 0 && /^[a-zA-Z]/.test(w));
  if (words.length < 2) return '';
  return words.map(w => w[0].toLowerCase()).join('');
}

// Helper: Check if a short name is an acronym/initials of a longer company name.
// e.g., "BMS" matches "Bristol-Myers Squibb", "GE" matches "General Electric"
function matchesAcronymToInitials(shortName: string, fullName: string): boolean {
  const short = shortName.toLowerCase();
  if (short.length < 2 || short.length > 6) return false;
  if (!/^[a-z]+$/.test(short)) return false;
  const initials = getCompanyInitials(fullName);
  return initials.length >= 2 && initials === short;
}

export class SyncService {
  private db: IDatabaseService;
  private zendesk: ZendeskService;
  private salesforce: SalesforceService | null;
  private github: GitHubService | null;
  private isSyncing = false;

  constructor(
    db: IDatabaseService,
    zendesk: ZendeskService,
    salesforce: SalesforceService | null,
    github: GitHubService | null = null
  ) {
    this.db = db;
    this.zendesk = zendesk;
    this.salesforce = salesforce;
    this.github = github;
  }

  async syncAll(): Promise<{ organizations: number; tickets: number; csmAssignments: number; pmAssignments: number; githubLinks: number }> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    console.log("Starting full data sync...");

    try {
      const orgCount = await this.syncOrganizations();
      const ticketCount = await this.syncTickets();

      // Sync account hierarchy before CSM/PM assignments so parent names are available
      if (this.salesforce) {
        await this.syncAccountHierarchy();
      }

      const csmCount = this.salesforce ? await this.syncCSMAssignments() : 0;
      const pmCount = this.salesforce ? await this.syncPMAssignments() : 0;
      const githubCount = this.github ? await this.syncGitHubLinks() : 0;

      console.log(`Sync complete: ${orgCount} orgs, ${ticketCount} tickets, ${csmCount} CSM assignments, ${pmCount} PM assignments, ${githubCount} GitHub links`);

      // Pre-warm caches: invalidate stale data, then pre-fetch renewals
      renewalsCache.clear();
      salesforceCache.clear();
      if (this.salesforce) {
        try {
          console.log("Pre-warming renewals cache...");
          const renewalData = await this.salesforce.getRenewalOpportunities(365);
          renewalsCache.set("renewals:365", { opportunities: renewalData, count: renewalData.length });
          console.log(`Renewals cache pre-warmed with ${renewalData.length} opportunities`);
        } catch (err) {
          console.error("Failed to pre-warm renewals cache:", err);
        }
        try {
          console.log("Pre-warming subscriptions cache...");
          const accountNames = await this.salesforce.getAccountsWithActiveSubscriptions();
          salesforceCache.set("accounts-with-subs", { accountNames, count: accountNames.length });
          console.log(`Subscriptions cache pre-warmed with ${accountNames.length} accounts`);
        } catch (err) {
          console.error("Failed to pre-warm subscriptions cache:", err);
        }
      }

      return { organizations: orgCount, tickets: ticketCount, csmAssignments: csmCount, pmAssignments: pmCount, githubLinks: githubCount };
    } finally {
      this.isSyncing = false;
    }
  }

  async syncOrganizations(): Promise<number> {
    console.log("Syncing organizations...");
    await this.db.updateSyncStatus("organizations", "in_progress", 0);

    try {
      const orgs = await this.zendesk.getOrganizations();

      const cachedOrgs: CachedOrganization[] = orgs.map((org) => {
        // Extract Salesforce ID from organization custom fields
        // The field key is typically "salesforce_id" (snake_case version of the field name)
        let salesforceId: string | null = null;
        if (org.organization_fields) {
          // Try common field key variations
          salesforceId =
            org.organization_fields.salesforce_id ||
            org.organization_fields.salesforce_account_id ||
            org.organization_fields.sf_id ||
            org.organization_fields.sfid ||
            null;
        }

        if (salesforceId) {
          console.log(`  - ${org.name}: SF ID = ${salesforceId}`);
        }

        return {
          id: org.id,
          name: org.name,
          domain_names: JSON.stringify(org.domain_names || []),
          salesforce_id: salesforceId,
          salesforce_account_name: null, // Will be populated during CSM sync
          sf_ultimate_parent_name: null, // Will be populated during hierarchy sync
          created_at: org.created_at,
          updated_at: org.updated_at,
        };
      });

      await this.db.upsertOrganizations(cachedOrgs);
      await this.db.updateSyncStatus("organizations", "success", orgs.length);

      const orgsWithSfId = cachedOrgs.filter((o) => o.salesforce_id).length;
      console.log(`Synced ${orgs.length} organizations (${orgsWithSfId} with Salesforce ID)`);
      return orgs.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.db.updateSyncStatus("organizations", "error", 0, message);
      throw error;
    }
  }

  // Get the last ticket sync end_time for delta syncs
  private async getLastTicketSyncTime(): Promise<number | null> {
    const statuses = await this.db.getSyncStatus();
    const status = statuses.find(s => s.type === "tickets");
    if (status && status.status === "success" && status.last_sync) {
      // Get the stored end_time from metadata if available
      const metadata = await this.db.getSyncMetadata("tickets_end_time");
      if (metadata) {
        return parseInt(metadata, 10);
      }
      // Fallback: use last_sync timestamp (less accurate but works)
      return Math.floor(new Date(status.last_sync).getTime() / 1000);
    }
    return null;
  }

  // Calculate the QBR cutoff date (start of Q-2 from current date)
  // Current quarter + 2 previous quarters = 3 quarters of solved/closed data
  private getQBRCutoffDate(): Date {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Determine current quarter (0-indexed: Q1=0, Q2=1, Q3=2, Q4=3)
    const currentQuarter = Math.floor(currentMonth / 3);

    // Go back 2 quarters to get the start of our QBR window
    let targetQuarter = currentQuarter - 2;
    let targetYear = currentYear;

    if (targetQuarter < 0) {
      targetQuarter += 4;
      targetYear -= 1;
    }

    // Return first day of that quarter
    return new Date(targetYear, targetQuarter * 3, 1);
  }

  // Optimized ticket sync strategy:
  // 1. Open/pending/new/hold tickets: Full details (always need these)
  // 2. Solved/closed tickets from last 2Q + current Q: Minimal data for QBR
  // 3. Older closed/solved: Skip entirely
  async syncTickets(deltaOnly = false): Promise<number> {
    console.log(`Syncing tickets (${deltaOnly ? "delta" : "full"} mode - optimized)...`);
    await this.db.updateSyncStatus("tickets", "in_progress", 0);

    try {
      // Ensure ticket fields are loaded for custom field extraction
      await this.zendesk.getTicketFields();

      // Get all organization IDs from cache for filtering
      const orgs = await this.db.getOrganizations();
      const orgIdSet = new Set(orgs.map(o => o.id));

      // Calculate QBR cutoff date (e.g., for Feb 2026, this is Jul 1, 2025)
      const qbrCutoff = this.getQBRCutoffDate();
      const qbrCutoffStr = qbrCutoff.toISOString().split('T')[0];
      console.log(`  QBR cutoff date: ${qbrCutoffStr} (solved/closed tickets before this will be skipped)`);

      let totalTickets = 0;
      const allCachedTickets: CachedTicket[] = [];

      // Step 1: Fetch ALL open/active tickets (new, open, pending, hold)
      // These are the most important and typically fewer in number
      console.log(`  Step 1: Fetching open/active tickets...`);
      const openStatuses = ["new", "open", "pending", "hold"];

      for (const status of openStatuses) {
        console.log(`    Fetching ${status} tickets...`);
        const tickets = await this.zendesk.searchTickets(`type:ticket status:${status}`, 50);

        // Filter to our orgs and convert to cached format
        const relevantTickets = tickets.filter(t => t.organization_id && orgIdSet.has(t.organization_id));

        for (const ticket of relevantTickets) {
          const customFields = this.zendesk.extractTicketCustomFields(ticket);
          allCachedTickets.push({
            id: ticket.id,
            organization_id: ticket.organization_id || 0,
            subject: ticket.subject || "",
            status: ticket.status,
            priority: ticket.priority || "normal",
            requester_id: ticket.requester_id,
            assignee_id: ticket.assignee_id || null,
            tags: JSON.stringify(ticket.tags || []),
            created_at: ticket.created_at,
            updated_at: ticket.updated_at,
            product: customFields.product,
            module: customFields.module,
            ticket_type: customFields.ticketType,
            workflow_status: customFields.workflowStatus,
            issue_subtype: customFields.issueSubtype,
            is_escalated: customFields.isEscalated ? 1 : 0,
          });
        }

        console.log(`    Found ${relevantTickets.length} ${status} tickets (${tickets.length} total)`);
        await this.db.updateSyncStatus("tickets", "in_progress", allCachedTickets.length);
      }

      console.log(`  Step 1 complete: ${allCachedTickets.length} open/active tickets`);

      // Step 2: Fetch solved/closed tickets from QBR window (for quarterly reviews)
      // Use date filter to only get recent solved/closed tickets
      console.log(`  Step 2: Fetching solved/closed tickets since ${qbrCutoffStr}...`);

      for (const status of ["solved", "closed"]) {
        console.log(`    Fetching ${status} tickets updated>=${qbrCutoffStr}...`);
        const tickets = await this.zendesk.searchTickets(
          `type:ticket status:${status} updated>=${qbrCutoffStr}`,
          30 // Limit pages for solved/closed
        );

        // Filter to our orgs
        const relevantTickets = tickets.filter(t => t.organization_id && orgIdSet.has(t.organization_id));

        for (const ticket of relevantTickets) {
          const customFields = this.zendesk.extractTicketCustomFields(ticket);
          allCachedTickets.push({
            id: ticket.id,
            organization_id: ticket.organization_id || 0,
            subject: ticket.subject || "",
            status: ticket.status,
            priority: ticket.priority || "normal",
            requester_id: ticket.requester_id,
            assignee_id: ticket.assignee_id || null,
            tags: JSON.stringify(ticket.tags || []),
            created_at: ticket.created_at,
            updated_at: ticket.updated_at,
            product: customFields.product,
            module: customFields.module,
            ticket_type: customFields.ticketType,
            workflow_status: customFields.workflowStatus,
            issue_subtype: customFields.issueSubtype,
            is_escalated: customFields.isEscalated ? 1 : 0,
          });
        }

        console.log(`    Found ${relevantTickets.length} ${status} tickets in QBR window (${tickets.length} total)`);
        await this.db.updateSyncStatus("tickets", "in_progress", allCachedTickets.length);
      }

      console.log(`  Step 2 complete: Total ${allCachedTickets.length} tickets`);

      // Deduplicate by ticket ID (in case any tickets changed status during sync)
      const ticketMap = new Map<number, CachedTicket>();
      for (const ticket of allCachedTickets) {
        ticketMap.set(ticket.id, ticket);
      }
      const dedupedTickets = Array.from(ticketMap.values());
      console.log(`  After deduplication: ${dedupedTickets.length} unique tickets`);

      // Batch upsert all tickets
      if (dedupedTickets.length > 0) {
        await this.db.upsertTickets(dedupedTickets);
      }

      // Store sync timestamp for delta syncs
      const validEndTime = Math.floor(Date.now() / 1000);
      await this.db.setSyncMetadata("tickets_end_time", validEndTime.toString());

      // Count by org for summary
      const orgCounts = new Map<number, number>();
      for (const t of dedupedTickets) {
        orgCounts.set(t.organization_id, (orgCounts.get(t.organization_id) || 0) + 1);
      }
      console.log(`  Tickets distributed across ${orgCounts.size} organizations`);

      // Count by status
      const statusCounts = new Map<string, number>();
      for (const t of dedupedTickets) {
        statusCounts.set(t.status, (statusCounts.get(t.status) || 0) + 1);
      }
      console.log(`  Status breakdown: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

      await this.db.updateSyncStatus("tickets", "success", dedupedTickets.length);
      console.log(`Synced ${dedupedTickets.length} tickets total (optimized: open + QBR-window closed)`);
      return dedupedTickets.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.db.updateSyncStatus("tickets", "error", 0, message);
      throw error;
    }
  }

  // Legacy per-org sync method - kept for targeted org refreshes
  async syncTicketsForOrganization(orgId: number): Promise<number> {
    console.log(`Syncing tickets for org ${orgId}...`);

    try {
      await this.zendesk.getTicketFields();
      const tickets = await this.zendesk.getTicketsByOrganization(orgId);

      const cachedTickets: CachedTicket[] = tickets.map((ticket) => {
        const customFields = this.zendesk.extractTicketCustomFields(ticket);

        return {
          id: ticket.id,
          organization_id: ticket.organization_id || 0,
          subject: ticket.subject || "",
          status: ticket.status,
          priority: ticket.priority || "normal",
          requester_id: ticket.requester_id,
          assignee_id: ticket.assignee_id || null,
          tags: JSON.stringify(ticket.tags || []),
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          product: customFields.product,
          module: customFields.module,
          ticket_type: customFields.ticketType,
          workflow_status: customFields.workflowStatus,
          issue_subtype: customFields.issueSubtype,
          is_escalated: customFields.isEscalated ? 1 : 0,
        };
      });

      await this.db.upsertTickets(cachedTickets);
      console.log(`  Synced ${tickets.length} tickets for org ${orgId}`);
      return tickets.length;
    } catch (error) {
      console.error(`  Error syncing tickets for org ${orgId}:`, error);
      throw error;
    }
  }

  async syncAccountHierarchy(): Promise<void> {
    if (!this.salesforce) {
      console.log("Salesforce not configured, skipping account hierarchy sync");
      return;
    }

    console.log("Syncing Salesforce account hierarchy...");

    try {
      const hierarchy = await this.salesforce.getAccountHierarchy();
      console.log(`  Fetched ${hierarchy.length} accounts from Salesforce hierarchy`);

      // Store hierarchy entries in database
      const cachedEntries: CachedAccountHierarchy[] = hierarchy.map((entry) => ({
        account_id: entry.accountId,
        account_name: entry.accountName,
        parent_id: entry.parentId,
        parent_name: entry.parentName,
        ultimate_parent_id: entry.ultimateParentId,
        ultimate_parent_name: entry.ultimateParentName,
      }));

      await this.db.upsertAccountHierarchy(cachedEntries);

      // Build SF Account ID -> ultimate parent name map
      const sfIdToParentName = new Map<string, string>();
      for (const entry of hierarchy) {
        sfIdToParentName.set(entry.accountId, entry.ultimateParentName);
      }

      // Also build a name-based lookup for orgs without SF ID
      // Map normalized SF account name -> ultimate parent name
      const sfNameToParentName = new Map<string, string>();
      for (const entry of hierarchy) {
        const normalized = normalizeAccents(entry.accountName.toLowerCase().trim());
        sfNameToParentName.set(normalized, entry.ultimateParentName);
      }

      // Update organizations with their ultimate parent name
      const orgs = await this.db.getOrganizations();
      let updatedBySfId = 0;
      let updatedByName = 0;

      for (const org of orgs) {
        let parentName: string | null = null;

        // Primary: Match by Salesforce ID
        if (org.salesforce_id && sfIdToParentName.has(org.salesforce_id)) {
          parentName = sfIdToParentName.get(org.salesforce_id)!;
          updatedBySfId++;
        }

        // Fallback: Match by name
        if (!parentName) {
          const orgNameNormalized = normalizeAccents(org.name.toLowerCase().trim());
          // Try exact match first
          if (sfNameToParentName.has(orgNameNormalized)) {
            parentName = sfNameToParentName.get(orgNameNormalized)!;
            updatedByName++;
          } else {
            // Try partial match: strip suffixes and try again
            const orgNameStripped = orgNameNormalized
              .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
              .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
              .trim();

            for (const [sfName, ultimateParent] of sfNameToParentName) {
              const sfNameStripped = sfName
                .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
                .trim();

              // Exact match (after stripping suffixes) or org name starts with SF name
              // startsWith requires a word boundary (space or dash) to avoid partial matches
              if (orgNameStripped === sfNameStripped ||
                  (sfNameStripped.length >= 3 && orgNameStripped.startsWith(sfNameStripped + " ")) ||
                  (sfNameStripped.length >= 3 && orgNameStripped.startsWith(sfNameStripped + "-"))) {
                parentName = ultimateParent;
                updatedByName++;
                break;
              }
            }
          }
        }

        if (parentName) {
          await this.db.updateOrganizationParentName(org.id, parentName);
        }
      }

      const withParent = hierarchy.filter((h) => h.parentId !== null).length;
      console.log(`  Account hierarchy: ${hierarchy.length} total, ${withParent} with parent accounts`);
      console.log(`  Updated org parent names: ${updatedBySfId} by SF ID, ${updatedByName} by name match`);
    } catch (error) {
      // Non-fatal: log error but don't break sync
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Account hierarchy sync error (non-fatal):", message);
    }
  }

  async syncCSMAssignments(): Promise<number> {
    if (!this.salesforce) {
      console.log("Salesforce not configured, skipping CSM sync");
      return 0;
    }

    console.log("Syncing CSM assignments from Salesforce...");
    await this.db.updateSyncStatus("csm_assignments", "in_progress", 0);

    try {
      const assignments = await this.salesforce.getCSMAssignments();

      // Get organizations for matching
      const orgs = await this.db.getOrganizations();

      // Primary: Build a map of Salesforce ID -> Zendesk org
      const sfIdToOrg = new Map<string, CachedOrganization>();
      for (const org of orgs) {
        if (org.salesforce_id) {
          sfIdToOrg.set(org.salesforce_id, org);
        }
      }

      console.log(`Matching using ${sfIdToOrg.size} orgs with Salesforce ID, ${orgs.length} total orgs`);

      let matchedBySfId = 0;
      let matchedByName = 0;
      let additionalOrgsMapped = 0;

      // Match Salesforce accounts to Zendesk organizations
      const cachedAssignments: CachedCSMAssignment[] = [];
      for (const a of assignments) {
        let primaryZendeskOrg: CachedOrganization | undefined;

        // Primary: Match by Salesforce Account ID
        primaryZendeskOrg = sfIdToOrg.get(a.accountId);
        if (primaryZendeskOrg) {
          matchedBySfId++;
          // Update the org's salesforce_account_name for display
          await this.db.updateOrganizationSfAccountName(primaryZendeskOrg.id, a.accountName);
        }

        // ALSO find ALL orgs whose name contains or is contained by the SF account name
        // This handles cases like "ADP" SF account matching "ADP -Corp", "ADP Enterprise", "ADP, Inc.", etc.
        // Also normalizes accents so "Nestlé" matches "Nestle"
        const accountNameLower = normalizeAccents(a.accountName.toLowerCase().trim());
        const accountNameNormalized = accountNameLower
          .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
          .trim();

        // Find all matching orgs by name pattern
        for (const org of orgs) {
          // Skip if already matched by SF ID or is the primary match
          if (org.salesforce_id === a.accountId) continue;
          if (primaryZendeskOrg && org.id === primaryZendeskOrg.id) continue;

          const orgNameLower = normalizeAccents(org.name.toLowerCase().trim());
          const orgNameNormalized = stripDomainSuffix(orgNameLower
            .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
            .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
            .trim());

          // Match criteria:
          // 1. Exact match (normalized, including accent normalization)
          // 2. Org name starts with SF account name (e.g., "ADP -Corp" starts with "ADP")
          // 3. SF account name starts with org name (e.g., "KPMG UK" starts with "KPMG",
          //    "British Telecommunications PLC" starts with "British Telecom")
          // 4. Org name contains SF account name as a word boundary (for longer names)
          // 5. SF account name contains org name as a word boundary (e.g., "Nestle Purina" contains "Purina")
          // 6. Parenthesized acronym in SF name matches org name initials
          //    (e.g., "...Limited (BAT)" matches "British American Tobacco" → B.A.T.)
          // 7. Org name is an acronym of the SF account name
          //    (e.g., "BMS" matches "Bristol-Myers Squibb", "GE" matches "General Electric")
          // 8. SF account name is an acronym of the org name
          // Escape special regex characters for word boundary matching
          const escapedAccountName = accountNameNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const escapedOrgName = orgNameNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isMatch =
            orgNameNormalized === accountNameNormalized ||
            orgNameLower === accountNameLower ||
            (accountNameNormalized.length >= 3 && orgNameNormalized.startsWith(accountNameNormalized)) ||
            (orgNameNormalized.length >= 4 && accountNameNormalized.startsWith(orgNameNormalized)) ||
            (accountNameNormalized.length >= 4 && new RegExp(`\\b${escapedAccountName}\\b`, 'i').test(orgNameLower)) ||
            (orgNameNormalized.length >= 5 && new RegExp(`\\b${escapedOrgName}\\b`, 'i').test(accountNameLower)) ||
            matchesParenthesizedAcronym(accountNameLower, orgNameLower) ||
            matchesAcronymToInitials(orgNameNormalized, accountNameNormalized) ||
            matchesAcronymToInitials(accountNameNormalized, orgNameNormalized);

          if (isMatch) {
            // Update this org's salesforce_account_name
            await this.db.updateOrganizationSfAccountName(org.id, a.accountName);
            additionalOrgsMapped++;

            // If no primary match yet, use this as the primary
            if (!primaryZendeskOrg) {
              primaryZendeskOrg = org;
              matchedByName++;
            }
          }
        }

        cachedAssignments.push({
          account_id: a.accountId,
          account_name: a.accountName,
          csm_id: a.csmId,
          csm_name: a.csmName,
          csm_email: a.csmEmail,
          zendesk_org_id: primaryZendeskOrg?.id || null,
        });
      }

      await this.db.upsertCSMAssignments(cachedAssignments);

      const matchedCount = cachedAssignments.filter((a) => a.zendesk_org_id !== null).length;
      console.log(`Synced ${assignments.length} CSM assignments:`);
      console.log(`  - ${matchedBySfId} matched by Salesforce ID`);
      console.log(`  - ${matchedByName} matched by name (fallback)`);
      console.log(`  - ${additionalOrgsMapped} additional orgs mapped to SF accounts`);
      console.log(`  - ${assignments.length - matchedCount} unmatched`);

      await this.db.updateSyncStatus("csm_assignments", "success", assignments.length);
      return assignments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.db.updateSyncStatus("csm_assignments", "error", 0, message);
      throw error;
    }
  }

  async syncPMAssignments(): Promise<number> {
    if (!this.salesforce) {
      console.log("Salesforce not configured, skipping PM sync");
      return 0;
    }

    console.log("Syncing Project Manager assignments from Salesforce...");
    await this.db.updateSyncStatus("pm_assignments", "in_progress", 0);

    try {
      const assignments = await this.salesforce.getProjectManagerAssignments();

      if (assignments.length === 0) {
        console.log("No Project Manager assignments found (Project_Manager__c field may not exist)");
        await this.db.updateSyncStatus("pm_assignments", "success", 0);
        return 0;
      }

      // Get organizations for matching
      const orgs = await this.db.getOrganizations();

      // Primary: Build a map of Salesforce ID -> Zendesk org
      const sfIdToOrg = new Map<string, CachedOrganization>();
      for (const org of orgs) {
        if (org.salesforce_id) {
          sfIdToOrg.set(org.salesforce_id, org);
        }
      }

      console.log(`Matching PM assignments using ${sfIdToOrg.size} orgs with Salesforce ID`);

      let matchedBySfId = 0;
      let matchedByName = 0;

      // Match Salesforce accounts to Zendesk organizations
      const cachedAssignments: CachedPMAssignment[] = assignments.map((a) => {
        let primaryZendeskOrg: CachedOrganization | undefined;

        // Primary: Match by Salesforce Account ID
        primaryZendeskOrg = sfIdToOrg.get(a.accountId);
        if (primaryZendeskOrg) {
          matchedBySfId++;
        }

        // Fallback: Match by name pattern (same logic as CSM)
        if (!primaryZendeskOrg) {
          const accountNameLower = normalizeAccents(a.accountName.toLowerCase().trim());
          const accountNameNormalized = accountNameLower
            .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
            .trim();

          for (const org of orgs) {
            if (org.salesforce_id === a.accountId) continue;

            const orgNameLower = normalizeAccents(org.name.toLowerCase().trim());
            const orgNameNormalized = stripDomainSuffix(orgNameLower
              .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
              .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
              .trim());

            const escapedAccountName = accountNameNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const isMatch =
              orgNameNormalized === accountNameNormalized ||
              orgNameLower === accountNameLower ||
              (accountNameNormalized.length >= 3 && orgNameNormalized.startsWith(accountNameNormalized)) ||
              (accountNameNormalized.length >= 4 && new RegExp(`\\b${escapedAccountName}\\b`, 'i').test(orgNameLower)) ||
              matchesAcronymToInitials(orgNameNormalized, accountNameNormalized) ||
              matchesAcronymToInitials(accountNameNormalized, orgNameNormalized);

            if (isMatch && !primaryZendeskOrg) {
              primaryZendeskOrg = org;
              matchedByName++;
              break;
            }
          }
        }

        return {
          account_id: a.accountId,
          account_name: a.accountName,
          pm_id: a.pmId,
          pm_name: a.pmName,
          pm_email: a.pmEmail,
          zendesk_org_id: primaryZendeskOrg?.id || null,
        };
      });

      await this.db.upsertPMAssignments(cachedAssignments);

      const matchedCount = cachedAssignments.filter((a) => a.zendesk_org_id !== null).length;
      console.log(`Synced ${assignments.length} PM assignments:`);
      console.log(`  - ${matchedBySfId} matched by Salesforce ID`);
      console.log(`  - ${matchedByName} matched by name (fallback)`);
      console.log(`  - ${assignments.length - matchedCount} unmatched`);

      await this.db.updateSyncStatus("pm_assignments", "success", assignments.length);
      return assignments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error syncing PM assignments:", message);
      await this.db.updateSyncStatus("pm_assignments", "error", 0, message);
      // Don't throw - PM sync failure shouldn't break the entire sync
      return 0;
    }
  }

  async syncGitHubLinks(): Promise<number> {
    if (!this.github) {
      console.log("GitHub not configured, skipping GitHub sync");
      return 0;
    }

    console.log("Syncing GitHub issue links (projects + repository search)...");
    await this.db.updateSyncStatus("github_links", "in_progress", 0);

    try {
      // Use getAllLinkedIssues to search both projects AND repositories
      const links = await this.github.getAllLinkedIssues();

      // Filter to only tickets that exist in our database
      const ticketIds = await this.db.getAllTicketIds();
      const ticketIdSet = new Set(ticketIds);

      const validLinks = links.filter((link) => ticketIdSet.has(link.zendeskTicketId));

      // Clear old links and insert new ones
      await this.db.clearGitHubLinks();

      const cachedLinks: CachedGitHubLink[] = validLinks.map((link) => ({
        zendesk_ticket_id: link.zendeskTicketId,
        github_issue_number: link.githubIssueNumber,
        github_repo: link.repoName,
        github_project_title: link.projectTitle,
        project_status: link.projectStatus,
        sprint: link.sprint || null,
        milestone: link.milestone || null,
        release_version: link.releaseVersion || null,
        github_url: link.githubUrl,
        github_updated_at: link.updatedAt,
      }));

      await this.db.upsertGitHubLinks(cachedLinks);

      console.log(`Synced ${validLinks.length} GitHub issue links (${links.length - validLinks.length} unmatched tickets filtered)`);
      await this.db.updateSyncStatus("github_links", "success", validLinks.length);

      return validLinks.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("GitHub sync error:", message);
      await this.db.updateSyncStatus("github_links", "error", 0, message);
      throw error;
    }
  }

  async getSyncStatus() {
    return this.db.getSyncStatus();
  }

  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}
