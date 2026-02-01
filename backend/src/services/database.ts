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
      INSERT OR REPLACE INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
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
      ticket.workflow_status
    );
  }

  upsertTickets(tickets: CachedTicket[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
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
          ticket.workflow_status
        );
      }
    });
    transaction(tickets);
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

  // Utility
  clearAll(): void {
    this.db.exec(`
      DELETE FROM tickets;
      DELETE FROM organizations;
      DELETE FROM csm_assignments;
      DELETE FROM sync_status;
    `);
  }

  close(): void {
    this.db.close();
  }
}
