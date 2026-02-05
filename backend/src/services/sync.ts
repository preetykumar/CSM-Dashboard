import { DatabaseService, CachedOrganization, CachedTicket, CachedCSMAssignment, CachedGitHubLink } from "./database.js";
import { ZendeskService } from "./zendesk.js";
import { SalesforceService, CSMAssignment } from "./salesforce.js";
import { GitHubService } from "./github.js";
import type { Organization, Ticket } from "../types/index.js";

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

  async syncAll(): Promise<{ organizations: number; tickets: number; csmAssignments: number; githubLinks: number }> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    console.log("Starting full data sync...");

    try {
      const orgCount = await this.syncOrganizations();
      const ticketCount = await this.syncTickets();
      const csmCount = this.salesforce ? await this.syncCSMAssignments() : 0;
      const githubCount = this.github ? await this.syncGitHubLinks() : 0;

      console.log(`Sync complete: ${orgCount} orgs, ${ticketCount} tickets, ${csmCount} CSM assignments, ${githubCount} GitHub links`);

      return { organizations: orgCount, tickets: ticketCount, csmAssignments: csmCount, githubLinks: githubCount };
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

  async syncTickets(): Promise<number> {
    console.log("Syncing tickets...");
    this.db.updateSyncStatus("tickets", "in_progress", 0);

    try {
      // Ensure ticket fields are loaded for custom field extraction
      await this.zendesk.getTicketFields();

      // Get all organizations from cache
      const orgs = this.db.getOrganizations();
      let totalTickets = 0;

      // Fetch tickets for each organization
      for (const org of orgs) {
        try {
          const tickets = await this.zendesk.getTicketsByOrganization(org.id);

          const cachedTickets: CachedTicket[] = tickets.map((ticket) => {
            // Extract custom field values
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
          totalTickets += tickets.length;

          console.log(`  - ${org.name}: ${tickets.length} tickets`);
        } catch (error) {
          console.error(`  - Error syncing tickets for ${org.name}:`, error);
        }
      }

      this.db.updateSyncStatus("tickets", "success", totalTickets);
      console.log(`Synced ${totalTickets} tickets total`);
      return totalTickets;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.db.updateSyncStatus("tickets", "error", 0, message);
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
        const accountNameLower = a.accountName.toLowerCase().trim();
        const accountNameNormalized = accountNameLower
          .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
          .trim();

        // Find all matching orgs by name pattern
        for (const org of orgs) {
          // Skip if already matched by SF ID or is the primary match
          if (org.salesforce_id === a.accountId) continue;
          if (primaryZendeskOrg && org.id === primaryZendeskOrg.id) continue;

          const orgNameLower = org.name.toLowerCase().trim();
          const orgNameNormalized = orgNameLower
            .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
            .replace(/\s*-\s*(corp|enterprise|wfn|llc|inc)$/i, "")
            .trim();

          // Match criteria:
          // 1. Exact match (normalized)
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

  async syncGitHubLinks(): Promise<number> {
    if (!this.github) {
      console.log("GitHub not configured, skipping GitHub sync");
      return 0;
    }

    console.log("Syncing GitHub issue links...");
    this.db.updateSyncStatus("github_links", "in_progress", 0);

    try {
      const links = await this.github.getLinkedIssues();

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
