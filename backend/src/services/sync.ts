import { DatabaseService, CachedOrganization, CachedTicket, CachedCSMAssignment } from "./database.js";
import { ZendeskService } from "./zendesk.js";
import { SalesforceService, CSMAssignment } from "./salesforce.js";
import type { Organization, Ticket } from "../types/index.js";

export class SyncService {
  private db: DatabaseService;
  private zendesk: ZendeskService;
  private salesforce: SalesforceService | null;
  private isSyncing = false;

  constructor(db: DatabaseService, zendesk: ZendeskService, salesforce: SalesforceService | null) {
    this.db = db;
    this.zendesk = zendesk;
    this.salesforce = salesforce;
  }

  async syncAll(): Promise<{ organizations: number; tickets: number; csmAssignments: number }> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    console.log("Starting full data sync...");

    try {
      const orgCount = await this.syncOrganizations();
      const ticketCount = await this.syncTickets();
      const csmCount = this.salesforce ? await this.syncCSMAssignments() : 0;

      console.log(`Sync complete: ${orgCount} orgs, ${ticketCount} tickets, ${csmCount} CSM assignments`);

      return { organizations: orgCount, tickets: ticketCount, csmAssignments: csmCount };
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

      // Fallback: Build name map for ALL orgs (used when SF ID doesn't match)
      const orgNameMap = new Map<string, CachedOrganization>();
      for (const org of orgs) {
        const orgNameLower = org.name.toLowerCase().trim();
        // Skip very short names that would cause false matches
        if (orgNameLower.length >= 3) {
          orgNameMap.set(orgNameLower, org);
        }
        const normalized = orgNameLower
          .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
          .trim();
        // Only add normalized version if it's meaningful (not empty and at least 3 chars)
        if (normalized.length >= 3 && normalized !== orgNameLower) {
          orgNameMap.set(normalized, org);
        }
      }

      console.log(`Matching using ${sfIdToOrg.size} orgs with Salesforce ID, ${orgNameMap.size} orgs by name`);

      let matchedBySfId = 0;
      let matchedByName = 0;

      // Match Salesforce accounts to Zendesk organizations
      const cachedAssignments: CachedCSMAssignment[] = assignments.map((a) => {
        let zendeskOrg: CachedOrganization | undefined;

        // Primary: Match by Salesforce Account ID
        zendeskOrg = sfIdToOrg.get(a.accountId);
        if (zendeskOrg) {
          matchedBySfId++;
          // Update the org's salesforce_account_name for display
          this.db.updateOrganizationSfAccountName(zendeskOrg.id, a.accountName);
        } else {
          // Fallback: Match by name (for orgs without Salesforce ID in Zendesk)
          const accountNameLower = a.accountName.toLowerCase().trim();
          const accountNameNormalized = accountNameLower
            .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
            .trim();

          zendeskOrg = orgNameMap.get(accountNameLower) || orgNameMap.get(accountNameNormalized);

          // Try partial matching as last resort (only for meaningful matches)
          if (!zendeskOrg && accountNameNormalized.length >= 5) {
            for (const [orgName, org] of orgNameMap) {
              // Only match if both strings are substantial and one contains the other
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
            // Also update SF account name for name-matched orgs
            this.db.updateOrganizationSfAccountName(zendeskOrg.id, a.accountName);
          }
        }

        return {
          account_id: a.accountId,
          account_name: a.accountName,
          csm_id: a.csmId,
          csm_name: a.csmName,
          csm_email: a.csmEmail,
          zendesk_org_id: zendeskOrg?.id || null,
        };
      });

      this.db.upsertCSMAssignments(cachedAssignments);

      const matchedCount = cachedAssignments.filter((a) => a.zendesk_org_id !== null).length;
      console.log(`Synced ${assignments.length} CSM assignments:`);
      console.log(`  - ${matchedBySfId} matched by Salesforce ID`);
      console.log(`  - ${matchedByName} matched by name (fallback)`);
      console.log(`  - ${assignments.length - matchedCount} unmatched`);

      this.db.updateSyncStatus("csm_assignments", "success", assignments.length);
      return assignments.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.db.updateSyncStatus("csm_assignments", "error", 0, message);
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
