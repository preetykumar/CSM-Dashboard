import { DatabaseService, CachedOrganization, CachedTicket, CachedCSMAssignment, CachedPMAssignment, CachedGitHubLink } from "./database.js";
import { ZendeskService } from "./zendesk.js";
import { SalesforceService, CSMAssignment, PMAssignment } from "./salesforce.js";
import { GitHubService } from "./github.js";
import type { Organization, Ticket } from "../types/index.js";

// Helper function to normalize text by removing diacritical marks (accents)
// e.g., "Nestlé" -> "nestle", "Café" -> "cafe"
function normalizeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export class SyncService {
  private db: DatabaseService;
  private zendesk: ZendeskService;
  private salesforce: SalesforceService | null;
  private github: GitHubService | null;
  private isSyncing = false;

  constructor(
    db: DatabaseService,
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
      const csmCount = this.salesforce ? await this.syncCSMAssignments() : 0;
      const pmCount = this.salesforce ? await this.syncPMAssignments() : 0;
      const githubCount = this.github ? await this.syncGitHubLinks() : 0;

      console.log(`Sync complete: ${orgCount} orgs, ${ticketCount} tickets, ${csmCount} CSM assignments, ${pmCount} PM assignments, ${githubCount} GitHub links`);

      return { organizations: orgCount, tickets: ticketCount, csmAssignments: csmCount, pmAssignments: pmCount, githubLinks: githubCount };
    } finally {
      this.isSyncing = false;
    }
  }

  async syncOrganizations(): Promise<number> {
    console.log("Syncing organizations...");
    this.db.updateSyncStatus("organizations", "in_progress", 0);

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
          created_at: org.created_at,
          updated_at: org.updated_at,
        };
      });

      this.db.upsertOrganizations(cachedOrgs);
      this.db.updateSyncStatus("organizations", "success", orgs.length);

      const orgsWithSfId = cachedOrgs.filter((o) => o.salesforce_id).length;
      console.log(`Synced ${orgs.length} organizations (${orgsWithSfId} with Salesforce ID)`);
      return orgs.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.db.updateSyncStatus("organizations", "error", 0, message);
      throw error;
    }
  }

  // Get the last ticket sync end_time for delta syncs
  private getLastTicketSyncTime(): number | null {
    const status = this.db.getSyncStatus().find(s => s.type === "tickets");
    if (status && status.status === "success" && status.last_sync) {
      // Get the stored end_time from metadata if available
      const metadata = this.db.getSyncMetadata("tickets_end_time");
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
    this.db.updateSyncStatus("tickets", "in_progress", 0);

    try {
      // Ensure ticket fields are loaded for custom field extraction
      await this.zendesk.getTicketFields();

      // Get all organization IDs from cache for filtering
      const orgs = this.db.getOrganizations();
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
        this.db.updateSyncStatus("tickets", "in_progress", allCachedTickets.length);
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
        this.db.updateSyncStatus("tickets", "in_progress", allCachedTickets.length);
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
        this.db.upsertTickets(dedupedTickets);
      }

      // Store sync timestamp for delta syncs
      const validEndTime = Math.floor(Date.now() / 1000);
      this.db.setSyncMetadata("tickets_end_time", validEndTime.toString());

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

      this.db.updateSyncStatus("tickets", "success", dedupedTickets.length);
      console.log(`Synced ${dedupedTickets.length} tickets total (optimized: open + QBR-window closed)`);
      return dedupedTickets.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.db.updateSyncStatus("tickets", "error", 0, message);
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

      this.db.upsertTickets(cachedTickets);
      console.log(`  Synced ${tickets.length} tickets for org ${orgId}`);
      return tickets.length;
    } catch (error) {
      console.error(`  Error syncing tickets for org ${orgId}:`, error);
      throw error;
    }
  }

  async syncCSMAssignments(): Promise<number> {
    if (!this.salesforce) {
      console.log("Salesforce not configured, skipping CSM sync");
      return 0;
    }

    console.log("Syncing CSM assignments from Salesforce...");
    this.db.updateSyncStatus("csm_assignments", "in_progress", 0);

    try {
      const assignments = await this.salesforce.getCSMAssignments();

      // Get organizations for matching
      const orgs = this.db.getOrganizations();

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
      const cachedAssignments: CachedCSMAssignment[] = assignments.map((a) => {
        let primaryZendeskOrg: CachedOrganization | undefined;

        // Primary: Match by Salesforce Account ID
        primaryZendeskOrg = sfIdToOrg.get(a.accountId);
        if (primaryZendeskOrg) {
          matchedBySfId++;
          // Update the org's salesforce_account_name for display
          this.db.updateOrganizationSfAccountName(primaryZendeskOrg.id, a.accountName);
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
          const orgNameNormalized = orgNameLower
            .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
            .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
            .trim();

          // Match criteria:
          // 1. Exact match (normalized, including accent normalization)
          // 2. Org name starts with SF account name (e.g., "ADP -Corp" starts with "ADP")
          // 3. Org name contains SF account name as a word boundary (for longer names)
          // Escape special regex characters in account name for word boundary matching
          const escapedAccountName = accountNameNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isMatch =
            orgNameNormalized === accountNameNormalized ||
            orgNameLower === accountNameLower ||
            (accountNameNormalized.length >= 3 && orgNameNormalized.startsWith(accountNameNormalized)) ||
            (accountNameNormalized.length >= 4 && new RegExp(`\\b${escapedAccountName}\\b`, 'i').test(orgNameLower));

          if (isMatch) {
            // Update this org's salesforce_account_name
            this.db.updateOrganizationSfAccountName(org.id, a.accountName);
            additionalOrgsMapped++;

            // If no primary match yet, use this as the primary
            if (!primaryZendeskOrg) {
              primaryZendeskOrg = org;
              matchedByName++;
            }
          }
        }

        return {
          account_id: a.accountId,
          account_name: a.accountName,
          csm_id: a.csmId,
          csm_name: a.csmName,
          csm_email: a.csmEmail,
          zendesk_org_id: primaryZendeskOrg?.id || null,
        };
      });

      this.db.upsertCSMAssignments(cachedAssignments);

      const matchedCount = cachedAssignments.filter((a) => a.zendesk_org_id !== null).length;
      console.log(`Synced ${assignments.length} CSM assignments:`);
      console.log(`  - ${matchedBySfId} matched by Salesforce ID`);
      console.log(`  - ${matchedByName} matched by name (fallback)`);
      console.log(`  - ${additionalOrgsMapped} additional orgs mapped to SF accounts`);
      console.log(`  - ${assignments.length - matchedCount} unmatched`);

      this.db.updateSyncStatus("csm_assignments", "success", assignments.length);
      return assignments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.db.updateSyncStatus("csm_assignments", "error", 0, message);
      throw error;
    }
  }

  async syncPMAssignments(): Promise<number> {
    if (!this.salesforce) {
      console.log("Salesforce not configured, skipping PM sync");
      return 0;
    }

    console.log("Syncing Project Manager assignments from Salesforce...");
    this.db.updateSyncStatus("pm_assignments", "in_progress", 0);

    try {
      const assignments = await this.salesforce.getProjectManagerAssignments();

      if (assignments.length === 0) {
        console.log("No Project Manager assignments found (Project_Manager__c field may not exist)");
        this.db.updateSyncStatus("pm_assignments", "success", 0);
        return 0;
      }

      // Get organizations for matching
      const orgs = this.db.getOrganizations();

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
            const orgNameNormalized = orgNameLower
              .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
              .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
              .trim();

            const escapedAccountName = accountNameNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const isMatch =
              orgNameNormalized === accountNameNormalized ||
              orgNameLower === accountNameLower ||
              (accountNameNormalized.length >= 3 && orgNameNormalized.startsWith(accountNameNormalized)) ||
              (accountNameNormalized.length >= 4 && new RegExp(`\\b${escapedAccountName}\\b`, 'i').test(orgNameLower));

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

      this.db.upsertPMAssignments(cachedAssignments);

      const matchedCount = cachedAssignments.filter((a) => a.zendesk_org_id !== null).length;
      console.log(`Synced ${assignments.length} PM assignments:`);
      console.log(`  - ${matchedBySfId} matched by Salesforce ID`);
      console.log(`  - ${matchedByName} matched by name (fallback)`);
      console.log(`  - ${assignments.length - matchedCount} unmatched`);

      this.db.updateSyncStatus("pm_assignments", "success", assignments.length);
      return assignments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error syncing PM assignments:", message);
      this.db.updateSyncStatus("pm_assignments", "error", 0, message);
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
    this.db.updateSyncStatus("github_links", "in_progress", 0);

    try {
      // Use getAllLinkedIssues to search both projects AND repositories
      const links = await this.github.getAllLinkedIssues();

      // Filter to only tickets that exist in our database
      const ticketIds = this.db.getAllTicketIds();
      const ticketIdSet = new Set(ticketIds);

      const validLinks = links.filter((link) => ticketIdSet.has(link.zendeskTicketId));

      // Clear old links and insert new ones
      this.db.clearGitHubLinks();

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

      this.db.upsertGitHubLinks(cachedLinks);

      console.log(`Synced ${validLinks.length} GitHub issue links (${links.length - validLinks.length} unmatched tickets filtered)`);
      this.db.updateSyncStatus("github_links", "success", validLinks.length);

      return validLinks.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("GitHub sync error:", message);
      this.db.updateSyncStatus("github_links", "error", 0, message);
      throw error;
    }
  }

  getSyncStatus() {
    return this.db.getSyncStatus();
  }

  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}
