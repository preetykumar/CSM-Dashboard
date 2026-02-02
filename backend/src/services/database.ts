import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CachedOrganization {
  id: number;
  name: string;
  domain_names: string;
  salesforce_id: string | null; // 18-char SF Account ID from Zendesk org custom field
  salesforce_account_name: string | null; // SF Account Name for display
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
  // Enhanced fields for product backlog view
  product: string | null;
  module: string | null;
  ticket_type: string | null; // 'bug', 'feature', or 'other'
  workflow_status: string | null;
  issue_subtype: string | null; // More specific categorization within type
  is_escalated: number; // 0 or 1, for SQLite boolean
}

export interface CachedCSMAssignment {
  account_id: string;
  account_name: string;
  csm_id: string;
  csm_name: string;
  csm_email: string;
  zendesk_org_id: number | null;
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

// Agent conversation types
export interface Conversation {
  id: string;
  user_id: string;
  user_email: string;
  channel: "web" | "slack" | "email";
  created_at: string;
  updated_at: string;
  metadata?: string; // JSON string
}

export interface ConversationMessage {
  id?: number;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool_use" | "tool_result";
  content: string;
  tool_name?: string | null;
  tool_input?: string | null; // JSON string
  tool_result?: string | null; // JSON string
  created_at: string;
}

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(__dirname, "../../data/zendesk-cache.db");
    this.db = new Database(dbPath || defaultPath);
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        domain_names TEXT,
        salesforce_id TEXT,
        salesforce_account_name TEXT,
        created_at TEXT,
        updated_at TEXT,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER,
        subject TEXT,
        status TEXT NOT NULL,
        priority TEXT,
        requester_id INTEGER,
        assignee_id INTEGER,
        tags TEXT,
        created_at TEXT,
        updated_at TEXT,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
        product TEXT,
        module TEXT,
        ticket_type TEXT,
        workflow_status TEXT,
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      CREATE TABLE IF NOT EXISTS csm_assignments (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        csm_id TEXT NOT NULL,
        csm_name TEXT NOT NULL,
        csm_email TEXT NOT NULL,
        zendesk_org_id INTEGER,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_status (
        type TEXT PRIMARY KEY,
        last_sync TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER DEFAULT 0,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(organization_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
      CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at);
      CREATE INDEX IF NOT EXISTS idx_csm_email ON csm_assignments(csm_email);

      CREATE TABLE IF NOT EXISTS github_issue_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zendesk_ticket_id INTEGER NOT NULL,
        github_issue_number INTEGER NOT NULL,
        github_repo TEXT NOT NULL,
        github_project_title TEXT,
        project_status TEXT,
        sprint TEXT,
        milestone TEXT,
        release_version TEXT,
        github_url TEXT,
        github_updated_at TEXT,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(zendesk_ticket_id, github_issue_number, github_repo)
      );

      CREATE INDEX IF NOT EXISTS idx_github_links_ticket ON github_issue_links(zendesk_ticket_id);
      CREATE INDEX IF NOT EXISTS idx_github_links_repo ON github_issue_links(github_repo);

      -- Agent conversation tables
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('web', 'slack', 'email')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_use', 'tool_result')),
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        tool_result TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_email);
    `);

    // Migration: Add new columns if they don't exist (for existing databases)
    this.migrateSchema();

    console.log("Database initialized");
  }

  private migrateSchema(): void {
    // Check if new columns exist and add them if not (tickets table)
    const ticketColumns = this.db.pragma("table_info(tickets)") as any[];
    const ticketColumnNames = ticketColumns.map((c) => c.name);

    if (!ticketColumnNames.includes("product")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN product TEXT");
    }
    if (!ticketColumnNames.includes("module")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN module TEXT");
    }
    if (!ticketColumnNames.includes("ticket_type")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN ticket_type TEXT");
    }
    if (!ticketColumnNames.includes("workflow_status")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN workflow_status TEXT");
    }
    if (!ticketColumnNames.includes("issue_subtype")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN issue_subtype TEXT");
    }
    if (!ticketColumnNames.includes("is_escalated")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN is_escalated INTEGER DEFAULT 0");
    }

    // Check organizations table for new columns
    const orgColumns = this.db.pragma("table_info(organizations)") as any[];
    const orgColumnNames = orgColumns.map((c) => c.name);

    if (!orgColumnNames.includes("salesforce_id")) {
      this.db.exec("ALTER TABLE organizations ADD COLUMN salesforce_id TEXT");
    }
    if (!orgColumnNames.includes("salesforce_account_name")) {
      this.db.exec("ALTER TABLE organizations ADD COLUMN salesforce_account_name TEXT");
    }
  }

  // Organizations
  upsertOrganization(org: CachedOrganization): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(org.id, org.name, org.domain_names, org.salesforce_id, org.salesforce_account_name, org.created_at, org.updated_at);
  }

  upsertOrganizations(orgs: CachedOrganization[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const transaction = this.db.transaction((orgs: CachedOrganization[]) => {
      for (const org of orgs) {
        stmt.run(org.id, org.name, org.domain_names, org.salesforce_id, org.salesforce_account_name, org.created_at, org.updated_at);
      }
    });
    transaction(orgs);
  }

  // Get organizations by Salesforce ID
  getOrganizationBySalesforceId(salesforceId: string): CachedOrganization | undefined {
    return this.db.prepare("SELECT * FROM organizations WHERE salesforce_id = ?").get(salesforceId) as CachedOrganization | undefined;
  }

  // Update organization with SF Account Name
  updateOrganizationSfAccountName(zendeskOrgId: number, sfAccountName: string): void {
    this.db.prepare("UPDATE organizations SET salesforce_account_name = ? WHERE id = ?").run(sfAccountName, zendeskOrgId);
  }

  getOrganizations(): CachedOrganization[] {
    return this.db.prepare("SELECT * FROM organizations ORDER BY name").all() as CachedOrganization[];
  }

  getOrganization(id: number): CachedOrganization | undefined {
    return this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as CachedOrganization | undefined;
  }

  // Tickets
  upsertTicket(ticket: CachedTicket): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status, issue_subtype, is_escalated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      ticket.id,
      ticket.organization_id,
      ticket.subject,
      ticket.status,
      ticket.priority,
      ticket.requester_id,
      ticket.assignee_id,
      ticket.tags,
      ticket.created_at,
      ticket.updated_at,
      ticket.product,
      ticket.module,
      ticket.ticket_type,
      ticket.workflow_status,
      ticket.issue_subtype,
      ticket.is_escalated
    );
  }

  upsertTickets(tickets: CachedTicket[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status, issue_subtype, is_escalated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction((tickets: CachedTicket[]) => {
      for (const ticket of tickets) {
        stmt.run(
          ticket.id,
          ticket.organization_id,
          ticket.subject,
          ticket.status,
          ticket.priority,
          ticket.requester_id,
          ticket.assignee_id,
          ticket.tags,
          ticket.created_at,
          ticket.updated_at,
          ticket.product,
          ticket.module,
          ticket.ticket_type,
          ticket.workflow_status,
          ticket.issue_subtype,
          ticket.is_escalated
        );
      }
    });
    transaction(tickets);
  }

  // Get escalation count for an organization
  getEscalationCount(orgId: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM tickets
      WHERE organization_id = ? AND is_escalated = 1 AND status NOT IN ('solved', 'closed')
    `).get(orgId) as { count: number };
    return row.count || 0;
  }

  getTicketsByOrganization(orgId: number): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? ORDER BY updated_at DESC").all(orgId) as CachedTicket[];
  }

  getTicketsByStatus(orgId: number, status: string): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND status = ? ORDER BY updated_at DESC").all(orgId, status) as CachedTicket[];
  }

  getTicketsByPriority(orgId: number, priority: string): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND priority = ? ORDER BY updated_at DESC").all(orgId, priority) as CachedTicket[];
  }

  getTicketsByProduct(orgId: number, product: string): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND product = ? ORDER BY updated_at DESC").all(orgId, product) as CachedTicket[];
  }

  getTicketsByModule(orgId: number, product: string, module: string): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND product = ? AND module = ? ORDER BY updated_at DESC").all(orgId, product, module) as CachedTicket[];
  }

  getTicketsByType(orgId: number, ticketType: string): CachedTicket[] {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND ticket_type = ? ORDER BY updated_at DESC").all(orgId, ticketType) as CachedTicket[];
  }

  getTicketStats(orgId: number): { total: number; new: number; open: number; pending: number; hold: number; solved: number; closed: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as hold,
        SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) as solved,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
      FROM tickets WHERE organization_id = ?
    `).get(orgId) as any;

    return {
      total: row.total || 0,
      new: row.new || 0,
      open: row.open || 0,
      pending: row.pending || 0,
      hold: row.hold || 0,
      solved: row.solved || 0,
      closed: row.closed || 0,
    };
  }

  getPriorityBreakdown(orgId: number): { low: number; normal: number; high: number; urgent: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN priority = 'normal' OR priority IS NULL THEN 1 ELSE 0 END) as normal,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent
      FROM tickets WHERE organization_id = ?
    `).get(orgId) as any;

    return {
      low: row.low || 0,
      normal: row.normal || 0,
      high: row.high || 0,
      urgent: row.urgent || 0,
    };
  }

  // CSM Assignments
  upsertCSMAssignment(assignment: CachedCSMAssignment): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      assignment.account_id,
      assignment.account_name,
      assignment.csm_id,
      assignment.csm_name,
      assignment.csm_email,
      assignment.zendesk_org_id
    );
  }

  upsertCSMAssignments(assignments: CachedCSMAssignment[]): void {
    // Clear existing assignments first
    this.db.prepare("DELETE FROM csm_assignments").run();

    const stmt = this.db.prepare(`
      INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const transaction = this.db.transaction((assignments: CachedCSMAssignment[]) => {
      for (const a of assignments) {
        stmt.run(a.account_id, a.account_name, a.csm_id, a.csm_name, a.csm_email, a.zendesk_org_id);
      }
    });
    transaction(assignments);
  }

  getCSMAssignments(): CachedCSMAssignment[] {
    return this.db.prepare("SELECT * FROM csm_assignments ORDER BY csm_name, account_name").all() as CachedCSMAssignment[];
  }

  getCSMPortfolios(): { csm_email: string; csm_name: string; org_ids: number[] }[] {
    const rows = this.db.prepare(`
      SELECT csm_email, csm_name, GROUP_CONCAT(zendesk_org_id) as org_ids
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL
      GROUP BY csm_email, csm_name
      ORDER BY csm_name
    `).all() as any[];

    return rows.map((row) => ({
      csm_email: row.csm_email,
      csm_name: row.csm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    }));
  }

  // Get portfolio for a specific CSM by email
  getCSMPortfolioByEmail(email: string): { csm_email: string; csm_name: string; org_ids: number[] } | null {
    const rows = this.db.prepare(`
      SELECT csm_email, csm_name, GROUP_CONCAT(zendesk_org_id) as org_ids
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL AND LOWER(csm_email) = LOWER(?)
      GROUP BY csm_email, csm_name
    `).all(email) as any[];

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      csm_email: row.csm_email,
      csm_name: row.csm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    };
  }

  // Get CSM assignment details for an organization
  getCSMAssignmentByOrgId(orgId: number): CachedCSMAssignment | null {
    const row = this.db.prepare(`
      SELECT * FROM csm_assignments WHERE zendesk_org_id = ?
    `).get(orgId) as CachedCSMAssignment | undefined;
    return row || null;
  }

  // Sync Status
  updateSyncStatus(type: string, status: string, recordCount: number, errorMessage?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_status (type, last_sync, status, record_count, error_message)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?)
    `);
    stmt.run(type, status, recordCount, errorMessage || null);
  }

  getSyncStatus(): SyncStatus[] {
    return this.db.prepare("SELECT * FROM sync_status ORDER BY type").all() as SyncStatus[];
  }

  getLastSyncTime(type: string): string | null {
    const row = this.db.prepare("SELECT last_sync FROM sync_status WHERE type = ?").get(type) as any;
    return row?.last_sync || null;
  }

  // GitHub Issue Links
  upsertGitHubLinks(links: CachedGitHubLink[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO github_issue_links
      (zendesk_ticket_id, github_issue_number, github_repo, github_project_title, project_status, sprint, milestone, release_version, github_url, github_updated_at, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const transaction = this.db.transaction((links: CachedGitHubLink[]) => {
      for (const link of links) {
        stmt.run(
          link.zendesk_ticket_id,
          link.github_issue_number,
          link.github_repo,
          link.github_project_title,
          link.project_status,
          link.sprint,
          link.milestone,
          link.release_version,
          link.github_url,
          link.github_updated_at
        );
      }
    });
    transaction(links);
  }

  getGitHubLinksByTicketId(ticketId: number): CachedGitHubLink[] {
    return this.db.prepare("SELECT * FROM github_issue_links WHERE zendesk_ticket_id = ?").all(ticketId) as CachedGitHubLink[];
  }

  getGitHubLinksByTicketIds(ticketIds: number[]): Map<number, CachedGitHubLink[]> {
    if (ticketIds.length === 0) return new Map();

    const placeholders = ticketIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT * FROM github_issue_links WHERE zendesk_ticket_id IN (${placeholders})`).all(...ticketIds) as CachedGitHubLink[];

    const linkMap = new Map<number, CachedGitHubLink[]>();
    for (const row of rows) {
      const existing = linkMap.get(row.zendesk_ticket_id) || [];
      existing.push(row);
      linkMap.set(row.zendesk_ticket_id, existing);
    }
    return linkMap;
  }

  clearGitHubLinks(): void {
    this.db.prepare("DELETE FROM github_issue_links").run();
  }

  getAllTicketIds(): number[] {
    const rows = this.db.prepare("SELECT id FROM tickets").all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  // Utility
  clearAll(): void {
    this.db.exec(`
      DELETE FROM tickets;
      DELETE FROM organizations;
      DELETE FROM csm_assignments;
      DELETE FROM sync_status;
      DELETE FROM github_issue_links;
    `);
  }

  // ==================
  // Conversation Methods
  // ==================

  createConversation(conversation: Omit<Conversation, "created_at" | "updated_at">): Conversation {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, user_id, user_email, channel, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      conversation.id,
      conversation.user_id,
      conversation.user_email,
      conversation.channel,
      conversation.metadata || null
    );
    return this.getConversation(conversation.id)!;
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
    return row || null;
  }

  getConversationsByUser(userEmail: string, limit: number = 50): Conversation[] {
    return this.db
      .prepare("SELECT * FROM conversations WHERE user_email = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userEmail, limit) as Conversation[];
  }

  updateConversationTimestamp(conversationId: string): void {
    this.db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversationId);
  }

  deleteConversation(conversationId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    });
    transaction();
  }

  // Conversation Messages
  saveMessage(message: Omit<ConversationMessage, "id" | "created_at">): ConversationMessage {
    const stmt = this.db.prepare(`
      INSERT INTO conversation_messages (conversation_id, role, content, tool_name, tool_input, tool_result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      message.conversation_id,
      message.role,
      message.content,
      message.tool_name || null,
      message.tool_input || null,
      message.tool_result || null
    );

    // Update conversation timestamp
    this.updateConversationTimestamp(message.conversation_id);

    return {
      id: Number(result.lastInsertRowid),
      conversation_id: message.conversation_id,
      role: message.role,
      content: message.content,
      tool_name: message.tool_name,
      tool_input: message.tool_input,
      tool_result: message.tool_result,
      created_at: new Date().toISOString(),
    };
  }

  getMessages(conversationId: string): ConversationMessage[] {
    return this.db
      .prepare("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId) as ConversationMessage[];
  }

  getRecentMessages(conversationId: string, limit: number = 20): ConversationMessage[] {
    // Get most recent messages, but return them in chronological order
    const messages = this.db
      .prepare(
        `SELECT * FROM conversation_messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(conversationId, limit) as ConversationMessage[];
    return messages.reverse();
  }

  close(): void {
    this.db.close();
  }
}
