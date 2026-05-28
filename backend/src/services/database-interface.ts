// Shared interfaces and abstract database contract for SQLite and PostgreSQL implementations

export interface CachedOrganization {
  id: number;
  name: string;
  domain_names: string;
  salesforce_id: string | null;
  salesforce_account_name: string | null;
  sf_ultimate_parent_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CachedTicket {
  id: number;
  organization_id: number;
  subject: string;
  status: string;
  priority: string;
  requester_id: number;
  assignee_id: number | null;
  tags: string;
  created_at: string;
  updated_at: string;
  product: string | null;
  module: string | null;
  ticket_type: string | null;
  workflow_status: string | null;
  issue_subtype: string | null;
  is_escalated: number;
}

export interface CachedCSMAssignment {
  account_id: string;
  account_name: string;
  csm_id: string;
  csm_name: string;
  csm_email: string;
  zendesk_org_id: number | null;
}

export interface CachedPMAssignment {
  account_id: string;
  account_name: string;
  pm_id: string;
  pm_name: string;
  pm_email: string;
  zendesk_org_id: number | null;
}

export interface CachedAccountHierarchy {
  account_id: string;
  account_name: string;
  parent_id: string | null;
  parent_name: string | null;
  ultimate_parent_id: string;
  ultimate_parent_name: string;
}

export interface SyncStatus {
  type: string;
  last_sync: string;
  status: string;
  record_count: number;
}

export interface CachedGitHubLink {
  id?: number;
  zendesk_ticket_id: number;
  github_issue_number: number;
  github_repo: string;
  github_project_title: string | null;
  project_status: string | null;
  sprint: string | null;
  milestone: string | null;
  release_version: string | null;
  github_url: string | null;
  github_updated_at: string | null;
  cached_at?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  user_email: string;
  channel: "web" | "slack" | "email";
  created_at: string;
  updated_at: string;
  metadata?: string;
}

export interface ConversationMessage {
  id?: number;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool_use" | "tool_result";
  content: string;
  tool_name?: string | null;
  tool_input?: string | null;
  tool_result?: string | null;
  created_at: string;
}

export interface TicketStats {
  total: number;
  new: number;
  open: number;
  pending: number;
  hold: number;
  solved: number;
  closed: number;
}

export interface PriorityBreakdown {
  low: number;
  normal: number;
  high: number;
  urgent: number;
}

export interface CSMPortfolio {
  csm_email: string;
  csm_name: string;
  org_ids: number[];
}

export interface PMPortfolio {
  pm_email: string;
  pm_name: string;
  org_ids: number[];
}

// Common database interface that both SQLite and PostgreSQL implementations must satisfy.
// All methods return Promise to support both sync (SQLite) and async (PostgreSQL) implementations.
export interface IDatabaseService {
  // Organizations
  upsertOrganization(org: CachedOrganization): Promise<void>;
  upsertOrganizations(orgs: CachedOrganization[]): Promise<void>;
  getOrganizationBySalesforceId(salesforceId: string): Promise<CachedOrganization | undefined>;
  updateOrganizationSfAccountName(zendeskOrgId: number, sfAccountName: string): Promise<void>;
  getOrganizations(): Promise<CachedOrganization[]>;
  getDomainToAccountMap(): Promise<Map<string, string>>;
  getOrganization(id: number): Promise<CachedOrganization | undefined>;

  // Tickets
  upsertTicket(ticket: CachedTicket): Promise<void>;
  upsertTickets(tickets: CachedTicket[]): Promise<void>;
  getEscalationCount(orgId: number): Promise<number>;
  getTicketsByOrganization(orgId: number): Promise<CachedTicket[]>;
  getTicketsByStatus(orgId: number, status: string): Promise<CachedTicket[]>;
  getTicketsByPriority(orgId: number, priority: string): Promise<CachedTicket[]>;
  getTicketsByProduct(orgId: number, product: string): Promise<CachedTicket[]>;
  getTicketsByModule(orgId: number, product: string, module: string): Promise<CachedTicket[]>;
  getTicketsByType(orgId: number, ticketType: string): Promise<CachedTicket[]>;
  getAllTickets(): Promise<CachedTicket[]>;
  getTicketStats(orgId: number): Promise<TicketStats>;
  getPriorityBreakdown(orgId: number): Promise<PriorityBreakdown>;

  // CSM Assignments
  upsertCSMAssignment(assignment: CachedCSMAssignment): Promise<void>;
  upsertCSMAssignments(assignments: CachedCSMAssignment[]): Promise<void>;
  getCSMAssignments(): Promise<CachedCSMAssignment[]>;
  getCSMPortfolios(): Promise<CSMPortfolio[]>;
  getCSMPortfolioByEmail(email: string): Promise<CSMPortfolio | null>;
  getCSMAssignmentByOrgId(orgId: number): Promise<CachedCSMAssignment | null>;

  // PM Assignments
  upsertPMAssignments(assignments: CachedPMAssignment[]): Promise<void>;
  getPMAssignments(): Promise<CachedPMAssignment[]>;
  getPMPortfolios(): Promise<PMPortfolio[]>;
  getPMPortfolioByEmail(email: string): Promise<PMPortfolio | null>;
  getPMAssignmentByOrgId(orgId: number): Promise<CachedPMAssignment | null>;

  // Account Hierarchy
  upsertAccountHierarchy(entries: CachedAccountHierarchy[]): Promise<void>;
  getAccountHierarchy(): Promise<CachedAccountHierarchy[]>;
  updateOrganizationParentName(zendeskOrgId: number, parentName: string): Promise<void>;
  // Returns the input account plus every other account in the same hierarchy tree
  // (parent, siblings, descendants — all sharing an ultimate_parent_id). Falls back to
  // [{ account_id, account_name: '' }] when the account isn't in the hierarchy table.
  getRelatedAccountIds(accountId: string): Promise<CachedAccountHierarchy[]>;

  // Sync Status
  updateSyncStatus(type: string, status: string, recordCount: number, errorMessage?: string): Promise<void>;
  getSyncStatus(): Promise<SyncStatus[]>;
  getLastSyncTime(type: string): Promise<string | null>;

  // Sync Metadata
  getSyncMetadata(key: string): Promise<string | null>;
  setSyncMetadata(key: string, value: string): Promise<void>;

  // GitHub Issue Links
  upsertGitHubLinks(links: CachedGitHubLink[]): Promise<void>;
  getGitHubLinksByTicketId(ticketId: number): Promise<CachedGitHubLink[]>;
  getGitHubLinksByTicketIds(ticketIds: number[]): Promise<Map<number, CachedGitHubLink[]>>;
  clearGitHubLinks(): Promise<void>;
  getAllTicketIds(): Promise<number[]>;

  // Utility
  clearAll(): Promise<void>;

  // Conversations
  createConversation(conversation: Omit<Conversation, "created_at" | "updated_at">): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  getConversationsByUser(userEmail: string, limit?: number): Promise<Conversation[]>;
  updateConversationTimestamp(conversationId: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;

  // Conversation Messages
  saveMessage(message: Omit<ConversationMessage, "id" | "created_at">): Promise<ConversationMessage>;
  getMessages(conversationId: string): Promise<ConversationMessage[]>;
  getRecentMessages(conversationId: string, limit?: number): Promise<ConversationMessage[]>;

  // User Preferences
  getUserPreferences(email: string): Promise<UserPreferences | null>;
  upsertUserPreferences(prefs: Omit<UserPreferences, "updated_at">): Promise<void>;

  // Org Contacts (SF Contact with axe_keycloak_id__c)
  upsertOrgContacts(contacts: CachedOrgContact[]): Promise<void>;
  getOrgContactsByKeycloakIds(keycloakIds: string[]): Promise<Map<string, CachedOrgContact>>;
  getOrgContactsByAccountIds(accountIds: string[]): Promise<CachedOrgContact[]>;
  countOrgContacts(): Promise<number>;

  // Product User Activity (Amplitude multi-group-by output)
  upsertProductUserActivity(rows: CachedProductUserActivity[]): Promise<void>;
  deleteProductUserActivityByProduct(productSlug: string): Promise<void>;
  getProductUserActivity(productSlug: string, orgKeys: string[]): Promise<CachedProductUserActivity[]>;
  // Identity-based lookup (fallback when org_key is unknown/abbreviation/etc).
  // For each keycloak_id with any activity for the product, returns the row with the
  // most recent last_seen (collapses cross-org duplicates if the same user appears under
  // multiple org_keys).
  getProductUserActivityByKeycloakIds(productSlug: string, keycloakIds: string[]): Promise<CachedProductUserActivity[]>;
  countProductUserActivity(productSlug?: string): Promise<number>;
  // For each requested account, returns the count of distinct keycloak_ids
  // that are SF contacts at that account AND have product activity in the
  // last 90 days. Used to fill amplitudeActiveUsers90d in portfolio enrichment.
  getActiveUserCountsByAccountIds(accountIds: string[]): Promise<Map<string, number>>;

  // Deployment Templates (Phase 2)
  listDeploymentTemplates(filter?: {
    product?: string;
    deployment_type?: DeploymentType;
    is_active?: boolean;
  }): Promise<DeploymentTemplate[]>;
  getDeploymentTemplate(id: number): Promise<DeploymentTemplate | null>;
  // Create a template with all its items in a single transaction. Items use
  // tree-local indices (parent_index = position in the `items` array) so the
  // caller doesn't need to know DB ids in advance.
  createDeploymentTemplate(
    template: Omit<DeploymentTemplate, "id" | "created_at" | "updated_at">,
    items: Array<Omit<DeploymentTemplateItem, "id" | "template_id" | "parent_id"> & {
      parent_index: number | null;
    }>
  ): Promise<number>;
  updateDeploymentTemplate(
    id: number,
    updates: Partial<Pick<DeploymentTemplate, "name" | "description" | "is_active">>
  ): Promise<void>;
  listDeploymentTemplateItems(templateId: number): Promise<DeploymentTemplateItem[]>;
  addDeploymentTemplateItem(
    item: Omit<DeploymentTemplateItem, "id">
  ): Promise<number>;
  updateDeploymentTemplateItem(
    id: number,
    updates: Partial<Omit<DeploymentTemplateItem, "id" | "template_id">>
  ): Promise<void>;
  deleteDeploymentTemplateItem(id: number): Promise<void>;

  // Deployment Plans (Phase 3)
  // Lists plans for either a TSA, an account, or by other filters. All
  // filters AND together; pass {} to get every plan in the DB (admin use).
  listDeploymentPlans(filter?: {
    tsa_email?: string;
    ie_email?: string;
    account_id?: string;
    opportunity_id?: string;
    status?: PlanStatus;
  }): Promise<DeploymentPlan[]>;
  getDeploymentPlan(id: number): Promise<DeploymentPlan | null>;
  // Creates a plan and atomically copies all items from the given template
  // (template_items.parent_id chain preserved). Items keep their template
  // item_id ("2.14.1") for display. Returns the new plan id.
  createDeploymentPlanFromTemplate(
    plan: Omit<DeploymentPlan, "id" | "created_at" | "updated_at">,
    templateItemsInOrder: DeploymentTemplateItem[]
  ): Promise<number>;
  updateDeploymentPlan(
    id: number,
    updates: Partial<Pick<DeploymentPlan, "status" | "tsa_email" | "ie_email">>
  ): Promise<void>;
  deleteDeploymentPlan(id: number): Promise<void>;
  listDeploymentPlanItems(planId: number): Promise<DeploymentPlanItem[]>;

  // Deployment Audit (Phase 2: writes only; reads added when audit-viewing UI lands)
  logDeploymentAudit(entry: Omit<DeploymentAuditEntry, "id" | "created_at">): Promise<void>;

  // Lifecycle
  close(): Promise<void> | void;
}

export interface UserPreferences {
  email: string;
  role: string | null;
  calendly_url: string | null;
  calendly_token: string | null;
  updated_at?: string;
}

// SF Contact with axe_keycloak_id__c — refreshed nightly from one paginated SOQL query.
export interface CachedOrgContact {
  keycloak_id: string;
  contact_id: string;
  email: string | null;
  name: string | null;
  title: string | null;
  account_id: string | null;
  account_name: string | null;
  cached_at?: string;
}

// Per-(product, org_key, keycloak_id) activity from Amplitude — refreshed nightly via multi-group-by segmentation.
// org_key is gp:organization (UUID for products that use UUIDs, name for those that don't).
export interface CachedProductUserActivity {
  product_slug: string;
  org_key: string;
  keycloak_id: string;
  last_seen: string | null;     // ISO date 'YYYY-MM-DD'
  event_count_90d: number;
  cached_at?: string;
}

// Joined row for API responses (Contact + Activity).
export interface ProductUserRow {
  keycloak_id: string;
  email: string | null;
  name: string | null;
  title: string | null;
  account_id: string | null;
  account_name: string | null;
  last_seen: string | null;
  event_count_90d: number;
  matched: boolean;             // true if SF Contact found
}

// ───────────────────────────────────────────────────────────────────────────
// Deployment templates (Phase 2): playbooks per product/deployment-type with
// hierarchical items (Milestone → Epic → Task) seeded from xlsx files.
// ───────────────────────────────────────────────────────────────────────────

export type DeploymentType = "cloud" | "on_prem";
export type ActivityType = "milestone" | "epic" | "task";

export interface DeploymentTemplate {
  id: number;
  product: string;                  // 'axe-monitor', 'axe-devtools', ...
  deployment_type: DeploymentType;
  name: string;                     // 'Axe Monitor SaaS Playbook v1'
  version: number;
  is_active: boolean;
  description: string | null;
  source_file: string | null;       // original xlsx filename (audit trail)
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentTemplateItem {
  id: number;
  template_id: number;
  parent_id: number | null;
  item_id: string;                  // '2.14.1' — dotted hierarchy key
  position: number;                 // sort order within siblings
  activity_type: ActivityType;
  description: string;
  target_outcome: string | null;
  default_deque_role: string | null; // 'TSA' | 'IE' | 'PM' | 'CSM'
  default_estimated_days: number | null;
  notes: string | null;
}

// Tree node for API responses (parent + recursive children).
export interface DeploymentTemplateItemTree extends DeploymentTemplateItem {
  children: DeploymentTemplateItemTree[];
}

export type PlanStatus = "not_started" | "in_progress" | "completed" | "paused";
export type ProgressStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "delayed"
  | "at_risk"
  | "blocked";

export interface DeploymentPlan {
  id: number;
  template_id: number;
  opportunity_id: string;
  opportunity_name: string | null;
  product: string;
  account_id: string;
  account_name: string | null;
  tsa_email: string | null;
  ie_email: string | null;
  status: PlanStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentPlanItem {
  id: number;
  plan_id: number;
  template_item_id: number | null;
  parent_id: number | null;
  item_id: string | null;
  position: number;
  activity_type: ActivityType;
  description: string;
  target_outcome: string | null;
  progress_status: ProgressStatus;
  notes: string | null;
  deque_responsible: string | null;
  customer_responsible: string | null;
  start_date: string | null;        // ISO date
  end_date: string | null;
  estimated_days: number | null;
  actual_days: number | null;
  updated_at: string;
}

export type DeploymentAuditAction =
  | "template_create"
  | "template_edit"
  | "template_activate"
  | "template_deactivate"
  | "item_create"
  | "item_edit"
  | "item_delete"
  | "plan_create"
  | "plan_status_change"
  | "plan_assign"
  | "plan_item_status_change"
  | "plan_item_edit"
  | "plan_item_create"
  | "plan_item_delete";

export interface DeploymentAuditEntry {
  id?: number;
  plan_id: number | null;
  plan_item_id: number | null;
  template_id: number | null;
  template_item_id: number | null;
  actor_email: string;
  action: DeploymentAuditAction;
  details_json: string | null;      // JSON-stringified payload
  created_at?: string;
}
