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

  // Lifecycle
  close(): Promise<void> | void;
}
