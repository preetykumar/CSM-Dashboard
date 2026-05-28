import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import type {
  IDatabaseService,
  CachedOrganization,
  CachedTicket,
  CachedCSMAssignment,
  CachedPMAssignment,
  CachedAccountHierarchy,
  SyncStatus,
  CachedGitHubLink,
  Conversation,
  ConversationMessage,
  TicketStats,
  PriorityBreakdown,
  CSMPortfolio,
  PMPortfolio,
  UserPreferences,
  CachedOrgContact,
  CachedProductUserActivity,
  DeploymentTemplate,
  DeploymentTemplateItem,
  DeploymentAuditEntry,
  DeploymentType,
  DeploymentPlan,
  DeploymentPlanItem,
  PlanStatus,
} from "./database-interface.js";

// Re-export all interfaces so existing imports from "./database.js" still work
export type {
  IDatabaseService,
  CachedOrganization,
  CachedTicket,
  CachedCSMAssignment,
  CachedPMAssignment,
  CachedAccountHierarchy,
  SyncStatus,
  CachedGitHubLink,
  Conversation,
  ConversationMessage,
  TicketStats,
  PriorityBreakdown,
  CSMPortfolio,
  PMPortfolio,
  CachedOrgContact,
  CachedProductUserActivity,
  DeploymentTemplate,
  DeploymentTemplateItem,
  DeploymentAuditEntry,
  DeploymentType,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DatabaseService implements IDatabaseService {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(__dirname, "../../data/zendesk-cache.db");
    this.db = new Database(dbPath || defaultPath);
    this.initializeSync();
  }

  private initializeSync(): void {
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

      CREATE TABLE IF NOT EXISTS pm_assignments (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        pm_id TEXT NOT NULL,
        pm_name TEXT NOT NULL,
        pm_email TEXT NOT NULL,
        zendesk_org_id INTEGER,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS account_hierarchy (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        parent_id TEXT,
        parent_name TEXT,
        ultimate_parent_id TEXT NOT NULL,
        ultimate_parent_name TEXT NOT NULL,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON account_hierarchy(ultimate_parent_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent_name ON account_hierarchy(ultimate_parent_name);

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
      CREATE INDEX IF NOT EXISTS idx_csm_name ON csm_assignments(csm_name);
      CREATE INDEX IF NOT EXISTS idx_csm_org ON csm_assignments(zendesk_org_id);

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

      -- User preferences (role, Calendly settings)
      CREATE TABLE IF NOT EXISTS user_preferences (
        email TEXT PRIMARY KEY,
        role TEXT,
        calendly_url TEXT,
        calendly_token TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Sync metadata for delta sync timestamps
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- SF Contacts with axe_keycloak_id__c (refreshed nightly)
      CREATE TABLE IF NOT EXISTS org_contacts (
        keycloak_id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        email TEXT,
        name TEXT,
        title TEXT,
        account_id TEXT,
        account_name TEXT,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_org_contacts_account ON org_contacts(account_id);
      CREATE INDEX IF NOT EXISTS idx_org_contacts_email ON org_contacts(email);

      -- Per-(product, org_key, keycloak_id) activity from Amplitude
      CREATE TABLE IF NOT EXISTS product_user_activity (
        product_slug TEXT NOT NULL,
        org_key TEXT NOT NULL,
        keycloak_id TEXT NOT NULL,
        last_seen TEXT,
        event_count_90d INTEGER DEFAULT 0,
        cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (product_slug, org_key, keycloak_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pua_product_org ON product_user_activity(product_slug, org_key);
      CREATE INDEX IF NOT EXISTS idx_pua_keycloak ON product_user_activity(keycloak_id);

      -- Deployment templates (Phase 2): playbooks per product + deployment-type
      CREATE TABLE IF NOT EXISTS deployment_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product TEXT NOT NULL,
        deployment_type TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        source_file TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product, deployment_type, version)
      );

      CREATE TABLE IF NOT EXISTS deployment_template_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES deployment_templates(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES deployment_template_items(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        description TEXT NOT NULL,
        target_outcome TEXT,
        default_deque_role TEXT,
        default_estimated_days INTEGER,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dti_template ON deployment_template_items(template_id);
      CREATE INDEX IF NOT EXISTS idx_dti_parent ON deployment_template_items(parent_id);

      CREATE TABLE IF NOT EXISTS deployment_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES deployment_templates(id),
        opportunity_id TEXT NOT NULL,
        opportunity_name TEXT,
        product TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT,
        tsa_email TEXT,
        ie_email TEXT,
        status TEXT NOT NULL DEFAULT 'not_started',
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(opportunity_id, product)
      );
      CREATE INDEX IF NOT EXISTS idx_dp_tsa ON deployment_plans(tsa_email);
      CREATE INDEX IF NOT EXISTS idx_dp_account ON deployment_plans(account_id);

      CREATE TABLE IF NOT EXISTS deployment_plan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES deployment_plans(id) ON DELETE CASCADE,
        template_item_id INTEGER REFERENCES deployment_template_items(id) ON DELETE SET NULL,
        parent_id INTEGER REFERENCES deployment_plan_items(id) ON DELETE CASCADE,
        item_id TEXT,
        position INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        description TEXT NOT NULL,
        target_outcome TEXT,
        progress_status TEXT NOT NULL DEFAULT 'not_started',
        notes TEXT,
        deque_responsible TEXT,
        customer_responsible TEXT,
        start_date TEXT,
        end_date TEXT,
        estimated_days INTEGER,
        actual_days INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_dpi_plan ON deployment_plan_items(plan_id);
      CREATE INDEX IF NOT EXISTS idx_dpi_parent ON deployment_plan_items(parent_id);
      CREATE INDEX IF NOT EXISTS idx_dpi_status ON deployment_plan_items(progress_status);

      CREATE TABLE IF NOT EXISTS deployment_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER REFERENCES deployment_plans(id) ON DELETE CASCADE,
        plan_item_id INTEGER REFERENCES deployment_plan_items(id) ON DELETE SET NULL,
        template_id INTEGER REFERENCES deployment_templates(id) ON DELETE SET NULL,
        template_item_id INTEGER REFERENCES deployment_template_items(id) ON DELETE SET NULL,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_da_plan ON deployment_audit(plan_id);
      CREATE INDEX IF NOT EXISTS idx_da_actor ON deployment_audit(actor_email);
      CREATE INDEX IF NOT EXISTS idx_da_created ON deployment_audit(created_at);
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
    if (!orgColumnNames.includes("sf_ultimate_parent_name")) {
      this.db.exec("ALTER TABLE organizations ADD COLUMN sf_ultimate_parent_name TEXT");
    }
  }

  // Organizations
  async upsertOrganization(org: CachedOrganization): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(org.id, org.name, org.domain_names, org.salesforce_id, org.salesforce_account_name, org.created_at, org.updated_at);
  }

  async upsertOrganizations(orgs: CachedOrganization[]): Promise<void> {
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
  async getOrganizationBySalesforceId(salesforceId: string): Promise<CachedOrganization | undefined> {
    return this.db.prepare("SELECT * FROM organizations WHERE salesforce_id = ?").get(salesforceId) as CachedOrganization | undefined;
  }

  // Update organization with SF Account Name
  async updateOrganizationSfAccountName(zendeskOrgId: number, sfAccountName: string): Promise<void> {
    this.db.prepare("UPDATE organizations SET salesforce_account_name = ? WHERE id = ?").run(sfAccountName, zendeskOrgId);
  }

  async getOrganizations(): Promise<CachedOrganization[]> {
    return this.db.prepare("SELECT * FROM organizations ORDER BY name").all() as CachedOrganization[];
  }

  // Get domain to account name mapping
  async getDomainToAccountMap(): Promise<Map<string, string>> {
    const orgs = await this.getOrganizations();
    const domainMap = new Map<string, string>();

    for (const org of orgs) {
      const accountName = org.salesforce_account_name || org.name;
      const domains = JSON.parse(org.domain_names || "[]") as string[];

      for (const domain of domains) {
        domainMap.set(domain.toLowerCase(), accountName);
      }
    }

    return domainMap;
  }

  async getOrganization(id: number): Promise<CachedOrganization | undefined> {
    return this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as CachedOrganization | undefined;
  }

  // Tickets
  async upsertTicket(ticket: CachedTicket): Promise<void> {
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

  async upsertTickets(tickets: CachedTicket[]): Promise<void> {
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
  async getEscalationCount(orgId: number): Promise<number> {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM tickets
      WHERE organization_id = ? AND is_escalated = 1 AND status NOT IN ('solved', 'closed')
    `).get(orgId) as { count: number };
    return row.count || 0;
  }

  async getTicketsByOrganization(orgId: number): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? ORDER BY updated_at DESC").all(orgId) as CachedTicket[];
  }

  async getTicketsByStatus(orgId: number, status: string): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND status = ? ORDER BY updated_at DESC").all(orgId, status) as CachedTicket[];
  }

  async getTicketsByPriority(orgId: number, priority: string): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND priority = ? AND status NOT IN ('solved', 'closed') ORDER BY updated_at DESC").all(orgId, priority) as CachedTicket[];
  }

  async getTicketsByProduct(orgId: number, product: string): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND product = ? ORDER BY updated_at DESC").all(orgId, product) as CachedTicket[];
  }

  async getTicketsByModule(orgId: number, product: string, module: string): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND product = ? AND module = ? ORDER BY updated_at DESC").all(orgId, product, module) as CachedTicket[];
  }

  async getTicketsByType(orgId: number, ticketType: string): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets WHERE organization_id = ? AND ticket_type = ? ORDER BY updated_at DESC").all(orgId, ticketType) as CachedTicket[];
  }

  async getAllTickets(): Promise<CachedTicket[]> {
    return this.db.prepare("SELECT * FROM tickets ORDER BY updated_at DESC").all() as CachedTicket[];
  }

  async getTicketStats(orgId: number): Promise<TicketStats> {
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

  async getPriorityBreakdown(orgId: number): Promise<PriorityBreakdown> {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN priority = 'normal' OR priority IS NULL THEN 1 ELSE 0 END) as normal,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent
      FROM tickets WHERE organization_id = ? AND status NOT IN ('solved', 'closed')
    `).get(orgId) as any;

    return {
      low: row.low || 0,
      normal: row.normal || 0,
      high: row.high || 0,
      urgent: row.urgent || 0,
    };
  }

  // CSM Assignments
  async upsertCSMAssignment(assignment: CachedCSMAssignment): Promise<void> {
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

  async upsertCSMAssignments(assignments: CachedCSMAssignment[]): Promise<void> {
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

  async getCSMAssignments(): Promise<CachedCSMAssignment[]> {
    return this.db.prepare("SELECT * FROM csm_assignments ORDER BY csm_name, account_name").all() as CachedCSMAssignment[];
  }

  async getCSMPortfolios(): Promise<CSMPortfolio[]> {
    // Group by csm_name to consolidate CSMs with multiple Salesforce IDs/emails
    // Prefer @deque.com emails, fall back to any email
    const rows = this.db.prepare(`
      SELECT
        csm_name,
        GROUP_CONCAT(DISTINCT zendesk_org_id) as org_ids,
        GROUP_CONCAT(DISTINCT csm_email) as emails
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL
      GROUP BY csm_name
      ORDER BY csm_name
    `).all() as any[];

    return rows.map((row) => {
      // Pick the best email (prefer @deque.com)
      const emails = row.emails ? row.emails.split(",") : [];
      const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
      const csm_email = dequeEmail || emails[0] || "";

      return {
        csm_email,
        csm_name: row.csm_name,
        org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
      };
    });
  }

  // Get portfolio for a specific CSM by email
  // Finds CSM by email, then returns ALL their accounts (even if they have multiple Salesforce IDs)
  async getCSMPortfolioByEmail(email: string): Promise<CSMPortfolio | null> {
    // First, find the CSM name for this email
    const csmName = this.db.prepare(`
      SELECT csm_name FROM csm_assignments WHERE LOWER(csm_email) = LOWER(?) LIMIT 1
    `).get(email) as { csm_name: string } | undefined;

    if (!csmName) return null;

    // Then get all accounts for this CSM (by name, to include all their Salesforce IDs)
    const rows = this.db.prepare(`
      SELECT
        csm_name,
        GROUP_CONCAT(DISTINCT zendesk_org_id) as org_ids,
        GROUP_CONCAT(DISTINCT csm_email) as emails
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL AND csm_name = ?
      GROUP BY csm_name
    `).all(csmName.csm_name) as any[];

    if (rows.length === 0) return null;

    const row = rows[0];
    // Prefer @deque.com email
    const emails = row.emails ? row.emails.split(",") : [];
    const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
    const csm_email = dequeEmail || emails[0] || email;

    return {
      csm_email,
      csm_name: row.csm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    };
  }

  // Get CSM assignment details for an organization
  async getCSMAssignmentByOrgId(orgId: number): Promise<CachedCSMAssignment | null> {
    const row = this.db.prepare(`
      SELECT * FROM csm_assignments WHERE zendesk_org_id = ?
    `).get(orgId) as CachedCSMAssignment | undefined;
    return row || null;
  }

  // Project Manager Assignment Methods
  async upsertPMAssignments(assignments: CachedPMAssignment[]): Promise<void> {
    // Clear existing assignments first
    this.db.prepare("DELETE FROM pm_assignments").run();

    const stmt = this.db.prepare(`
      INSERT INTO pm_assignments (account_id, account_name, pm_id, pm_name, pm_email, zendesk_org_id, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const transaction = this.db.transaction((assignments: CachedPMAssignment[]) => {
      for (const a of assignments) {
        stmt.run(a.account_id, a.account_name, a.pm_id, a.pm_name, a.pm_email, a.zendesk_org_id);
      }
    });
    transaction(assignments);
  }

  async getPMAssignments(): Promise<CachedPMAssignment[]> {
    return this.db.prepare("SELECT * FROM pm_assignments ORDER BY pm_name, account_name").all() as CachedPMAssignment[];
  }

  async getPMPortfolios(): Promise<PMPortfolio[]> {
    // Group by pm_name to consolidate PMs with multiple Salesforce IDs/emails
    // Prefer @deque.com emails, fall back to any email
    const rows = this.db.prepare(`
      SELECT
        pm_name,
        GROUP_CONCAT(DISTINCT zendesk_org_id) as org_ids,
        GROUP_CONCAT(DISTINCT pm_email) as emails
      FROM pm_assignments
      WHERE zendesk_org_id IS NOT NULL
      GROUP BY pm_name
      ORDER BY pm_name
    `).all() as any[];

    return rows.map((row) => {
      // Pick the best email (prefer @deque.com)
      const emails = row.emails ? row.emails.split(",") : [];
      const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
      const pm_email = dequeEmail || emails[0] || "";

      return {
        pm_email,
        pm_name: row.pm_name,
        org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
      };
    });
  }

  // Get portfolio for a specific PM by email
  async getPMPortfolioByEmail(email: string): Promise<PMPortfolio | null> {
    // First, find the PM name for this email
    const pmName = this.db.prepare(`
      SELECT pm_name FROM pm_assignments WHERE LOWER(pm_email) = LOWER(?) LIMIT 1
    `).get(email) as { pm_name: string } | undefined;

    if (!pmName) return null;

    // Then get all accounts for this PM (by name, to include all their Salesforce IDs)
    const rows = this.db.prepare(`
      SELECT
        pm_name,
        GROUP_CONCAT(DISTINCT zendesk_org_id) as org_ids,
        GROUP_CONCAT(DISTINCT pm_email) as emails
      FROM pm_assignments
      WHERE zendesk_org_id IS NOT NULL AND pm_name = ?
      GROUP BY pm_name
    `).all(pmName.pm_name) as any[];

    if (rows.length === 0) return null;

    const row = rows[0];
    // Prefer @deque.com email
    const emails = row.emails ? row.emails.split(",") : [];
    const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
    const pm_email = dequeEmail || emails[0] || email;

    return {
      pm_email,
      pm_name: row.pm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    };
  }

  // Get PM assignment details for an organization
  async getPMAssignmentByOrgId(orgId: number): Promise<CachedPMAssignment | null> {
    const row = this.db.prepare(`
      SELECT * FROM pm_assignments WHERE zendesk_org_id = ?
    `).get(orgId) as CachedPMAssignment | undefined;
    return row || null;
  }

  // Account Hierarchy
  async upsertAccountHierarchy(entries: CachedAccountHierarchy[]): Promise<void> {
    this.db.prepare("DELETE FROM account_hierarchy").run();

    const stmt = this.db.prepare(`
      INSERT INTO account_hierarchy (account_id, account_name, parent_id, parent_name, ultimate_parent_id, ultimate_parent_name, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const transaction = this.db.transaction((entries: CachedAccountHierarchy[]) => {
      for (const e of entries) {
        stmt.run(e.account_id, e.account_name, e.parent_id, e.parent_name, e.ultimate_parent_id, e.ultimate_parent_name);
      }
    });
    transaction(entries);
  }

  async getAccountHierarchy(): Promise<CachedAccountHierarchy[]> {
    return this.db.prepare("SELECT * FROM account_hierarchy ORDER BY ultimate_parent_name, account_name").all() as CachedAccountHierarchy[];
  }

  async getRelatedAccountIds(accountId: string): Promise<CachedAccountHierarchy[]> {
    if (!accountId) return [];
    const row = this.db
      .prepare("SELECT ultimate_parent_id FROM account_hierarchy WHERE account_id = ?")
      .get(accountId) as { ultimate_parent_id?: string } | undefined;
    if (!row?.ultimate_parent_id) {
      // Account not in hierarchy table — return self only
      return [{
        account_id: accountId,
        account_name: "",
        parent_id: null,
        parent_name: null,
        ultimate_parent_id: accountId,
        ultimate_parent_name: "",
      }];
    }
    return this.db
      .prepare(
        "SELECT * FROM account_hierarchy WHERE ultimate_parent_id = ? ORDER BY account_name"
      )
      .all(row.ultimate_parent_id) as CachedAccountHierarchy[];
  }

  async updateOrganizationParentName(zendeskOrgId: number, parentName: string): Promise<void> {
    this.db.prepare("UPDATE organizations SET sf_ultimate_parent_name = ? WHERE id = ?").run(parentName, zendeskOrgId);
  }

  // Sync Status
  async updateSyncStatus(type: string, status: string, recordCount: number, errorMessage?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_status (type, last_sync, status, record_count, error_message)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?)
    `);
    stmt.run(type, status, recordCount, errorMessage || null);
  }

  async getSyncStatus(): Promise<SyncStatus[]> {
    return this.db.prepare("SELECT * FROM sync_status ORDER BY type").all() as SyncStatus[];
  }

  async getLastSyncTime(type: string): Promise<string | null> {
    const row = this.db.prepare("SELECT last_sync FROM sync_status WHERE type = ?").get(type) as any;
    return row?.last_sync || null;
  }

  // Sync Metadata - for storing delta sync timestamps
  async getSyncMetadata(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM sync_metadata WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  async setSyncMetadata(key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(key, value);
  }

  // GitHub Issue Links
  async upsertGitHubLinks(links: CachedGitHubLink[]): Promise<void> {
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

  async getGitHubLinksByTicketId(ticketId: number): Promise<CachedGitHubLink[]> {
    return this.db.prepare("SELECT * FROM github_issue_links WHERE zendesk_ticket_id = ?").all(ticketId) as CachedGitHubLink[];
  }

  async getGitHubLinksByTicketIds(ticketIds: number[]): Promise<Map<number, CachedGitHubLink[]>> {
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

  async clearGitHubLinks(): Promise<void> {
    this.db.prepare("DELETE FROM github_issue_links").run();
  }

  async getAllTicketIds(): Promise<number[]> {
    const rows = this.db.prepare("SELECT id FROM tickets").all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  // Utility
  async clearAll(): Promise<void> {
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

  async createConversation(conversation: Omit<Conversation, "created_at" | "updated_at">): Promise<Conversation> {
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
    return (await this.getConversation(conversation.id))!;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
    return row || null;
  }

  async getConversationsByUser(userEmail: string, limit: number = 50): Promise<Conversation[]> {
    return this.db
      .prepare("SELECT * FROM conversations WHERE user_email = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userEmail, limit) as Conversation[];
  }

  async updateConversationTimestamp(conversationId: string): Promise<void> {
    this.db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    });
    transaction();
  }

  // Conversation Messages
  async saveMessage(message: Omit<ConversationMessage, "id" | "created_at">): Promise<ConversationMessage> {
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
    await this.updateConversationTimestamp(message.conversation_id);

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

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.db
      .prepare("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId) as ConversationMessage[];
  }

  async getRecentMessages(conversationId: string, limit: number = 20): Promise<ConversationMessage[]> {
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

  getUserPreferences(email: string): Promise<UserPreferences | null> {
    const stmt = this.db.prepare("SELECT * FROM user_preferences WHERE email = ?");
    return Promise.resolve((stmt.get(email) as UserPreferences) || null);
  }

  upsertUserPreferences(prefs: Omit<UserPreferences, "updated_at">): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO user_preferences (email, role, calendly_url, calendly_token, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        role = excluded.role,
        calendly_url = excluded.calendly_url,
        calendly_token = excluded.calendly_token,
        updated_at = excluded.updated_at
    `);
    stmt.run(prefs.email, prefs.role || null, prefs.calendly_url || null, prefs.calendly_token || null, new Date().toISOString());
    return Promise.resolve();
  }

  // ----- Org Contacts -----

  async upsertOrgContacts(contacts: CachedOrgContact[]): Promise<void> {
    this.db.prepare("DELETE FROM org_contacts").run();
    const stmt = this.db.prepare(`
      INSERT INTO org_contacts (keycloak_id, contact_id, email, name, title, account_id, account_name, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const tx = this.db.transaction((rows: CachedOrgContact[]) => {
      for (const c of rows) {
        stmt.run(c.keycloak_id, c.contact_id, c.email, c.name, c.title, c.account_id, c.account_name);
      }
    });
    tx(contacts);
  }

  async getOrgContactsByKeycloakIds(keycloakIds: string[]): Promise<Map<string, CachedOrgContact>> {
    const map = new Map<string, CachedOrgContact>();
    if (keycloakIds.length === 0) return map;
    const chunkSize = 500;
    for (let i = 0; i < keycloakIds.length; i += chunkSize) {
      const chunk = keycloakIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db
        .prepare(`SELECT * FROM org_contacts WHERE keycloak_id IN (${placeholders})`)
        .all(...chunk) as CachedOrgContact[];
      for (const r of rows) map.set(r.keycloak_id, r);
    }
    return map;
  }

  async getOrgContactsByAccountIds(accountIds: string[]): Promise<CachedOrgContact[]> {
    if (accountIds.length === 0) return [];
    const placeholders = accountIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM org_contacts WHERE account_id IN (${placeholders}) ORDER BY name`)
      .all(...accountIds) as CachedOrgContact[];
  }

  async countOrgContacts(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM org_contacts").get() as { n: number };
    return row.n;
  }

  // ----- Product User Activity -----

  async upsertProductUserActivity(rows: CachedProductUserActivity[]): Promise<void> {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO product_user_activity (product_slug, org_key, keycloak_id, last_seen, event_count_90d, cached_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(product_slug, org_key, keycloak_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        event_count_90d = excluded.event_count_90d,
        cached_at = CURRENT_TIMESTAMP
    `);
    const tx = this.db.transaction((items: CachedProductUserActivity[]) => {
      for (const r of items) {
        stmt.run(r.product_slug, r.org_key, r.keycloak_id, r.last_seen, r.event_count_90d);
      }
    });
    tx(rows);
  }

  async deleteProductUserActivityByProduct(productSlug: string): Promise<void> {
    this.db.prepare("DELETE FROM product_user_activity WHERE product_slug = ?").run(productSlug);
  }

  async getProductUserActivity(productSlug: string, orgKeys: string[]): Promise<CachedProductUserActivity[]> {
    if (orgKeys.length === 0) return [];
    const placeholders = orgKeys.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM product_user_activity
         WHERE product_slug = ? AND org_key IN (${placeholders})
         ORDER BY event_count_90d DESC`
      )
      .all(productSlug, ...orgKeys) as CachedProductUserActivity[];
  }

  async getProductUserActivityByKeycloakIds(
    productSlug: string,
    keycloakIds: string[]
  ): Promise<CachedProductUserActivity[]> {
    if (keycloakIds.length === 0) return [];
    const out: CachedProductUserActivity[] = [];
    // Chunk to avoid SQLite parameter limit
    const CHUNK = 500;
    for (let i = 0; i < keycloakIds.length; i += CHUNK) {
      const chunk = keycloakIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT product_slug, org_key, keycloak_id,
                  MAX(last_seen) AS last_seen,
                  SUM(event_count_90d) AS event_count_90d,
                  MAX(cached_at) AS cached_at
           FROM product_user_activity
           WHERE product_slug = ? AND keycloak_id IN (${placeholders})
           GROUP BY keycloak_id
           ORDER BY event_count_90d DESC`
        )
        .all(productSlug, ...chunk) as CachedProductUserActivity[];
      out.push(...rows);
    }
    return out;
  }

  async countProductUserActivity(productSlug?: string): Promise<number> {
    const sql = productSlug
      ? "SELECT COUNT(*) as n FROM product_user_activity WHERE product_slug = ?"
      : "SELECT COUNT(*) as n FROM product_user_activity";
    const row = (productSlug
      ? this.db.prepare(sql).get(productSlug)
      : this.db.prepare(sql).get()) as { n: number };
    return row.n;
  }

  async getActiveUserCountsByAccountIds(accountIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const id of accountIds) out.set(id, 0);
    if (accountIds.length === 0) return out;
    const CHUNK = 500;
    for (let i = 0; i < accountIds.length; i += CHUNK) {
      const chunk = accountIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT oc.account_id AS account_id, COUNT(DISTINCT pua.keycloak_id) AS n
           FROM org_contacts oc
           INNER JOIN product_user_activity pua ON pua.keycloak_id = oc.keycloak_id
           WHERE oc.account_id IN (${placeholders})
           AND pua.event_count_90d > 0
           GROUP BY oc.account_id`
        )
        .all(...chunk) as Array<{ account_id: string; n: number }>;
      for (const r of rows) out.set(r.account_id, r.n);
    }
    return out;
  }

  // ─── Deployment Templates (Phase 2) ─────────────────────────────────────

  async listDeploymentTemplates(filter?: {
    product?: string;
    deployment_type?: DeploymentType;
    is_active?: boolean;
  }): Promise<DeploymentTemplate[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filter?.product) {
      where.push("product = ?");
      params.push(filter.product);
    }
    if (filter?.deployment_type) {
      where.push("deployment_type = ?");
      params.push(filter.deployment_type);
    }
    if (filter?.is_active !== undefined) {
      where.push("is_active = ?");
      params.push(filter.is_active ? 1 : 0);
    }
    const sql = `SELECT * FROM deployment_templates ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY product, deployment_type, version DESC`;
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(rowToTemplate);
  }

  async getDeploymentTemplate(id: number): Promise<DeploymentTemplate | null> {
    const row = this.db.prepare("SELECT * FROM deployment_templates WHERE id = ?").get(id) as any;
    return row ? rowToTemplate(row) : null;
  }

  async createDeploymentTemplate(
    template: Omit<DeploymentTemplate, "id" | "created_at" | "updated_at">,
    items: Array<Omit<DeploymentTemplateItem, "id" | "template_id" | "parent_id"> & {
      parent_index: number | null;
    }>
  ): Promise<number> {
    const txn = this.db.transaction(() => {
      const insertTpl = this.db.prepare(`
        INSERT INTO deployment_templates
          (product, deployment_type, name, version, is_active, description, source_file, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tplResult = insertTpl.run(
        template.product,
        template.deployment_type,
        template.name,
        template.version,
        template.is_active ? 1 : 0,
        template.description,
        template.source_file,
        template.created_by
      );
      const templateId = tplResult.lastInsertRowid as number;

      const insertItem = this.db.prepare(`
        INSERT INTO deployment_template_items
          (template_id, parent_id, item_id, position, activity_type, description,
           target_outcome, default_deque_role, default_estimated_days, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Items must be ordered so any parent appears before its children.
      const dbIds: number[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const parentId = it.parent_index !== null ? dbIds[it.parent_index] : null;
        const r = insertItem.run(
          templateId,
          parentId,
          it.item_id,
          it.position,
          it.activity_type,
          it.description,
          it.target_outcome,
          it.default_deque_role,
          it.default_estimated_days,
          it.notes
        );
        dbIds.push(r.lastInsertRowid as number);
      }
      return templateId;
    });
    return txn();
  }

  async updateDeploymentTemplate(
    id: number,
    updates: Partial<Pick<DeploymentTemplate, "name" | "description" | "is_active">>
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) {
      sets.push("name = ?");
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.is_active !== undefined) {
      sets.push("is_active = ?");
      params.push(updates.is_active ? 1 : 0);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    this.db.prepare(`UPDATE deployment_templates SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  async listDeploymentTemplateItems(templateId: number): Promise<DeploymentTemplateItem[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM deployment_template_items WHERE template_id = ? ORDER BY position ASC, id ASC"
      )
      .all(templateId) as any[];
    return rows.map(rowToTemplateItem);
  }

  async addDeploymentTemplateItem(
    item: Omit<DeploymentTemplateItem, "id">
  ): Promise<number> {
    const r = this.db
      .prepare(
        `INSERT INTO deployment_template_items
          (template_id, parent_id, item_id, position, activity_type, description,
           target_outcome, default_deque_role, default_estimated_days, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.template_id,
        item.parent_id,
        item.item_id,
        item.position,
        item.activity_type,
        item.description,
        item.target_outcome,
        item.default_deque_role,
        item.default_estimated_days,
        item.notes
      );
    return r.lastInsertRowid as number;
  }

  async updateDeploymentTemplateItem(
    id: number,
    updates: Partial<Omit<DeploymentTemplateItem, "id" | "template_id">>
  ): Promise<void> {
    const allowed: Array<keyof typeof updates> = [
      "parent_id",
      "item_id",
      "position",
      "activity_type",
      "description",
      "target_outcome",
      "default_deque_role",
      "default_estimated_days",
      "notes",
    ];
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db
      .prepare(`UPDATE deployment_template_items SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  async deleteDeploymentTemplateItem(id: number): Promise<void> {
    this.db.prepare("DELETE FROM deployment_template_items WHERE id = ?").run(id);
  }

  // ─── Deployment Plans (Phase 3) ─────────────────────────────────────────

  async listDeploymentPlans(filter?: {
    tsa_email?: string;
    ie_email?: string;
    account_id?: string;
    opportunity_id?: string;
    status?: PlanStatus;
  }): Promise<DeploymentPlan[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filter?.tsa_email) {
      where.push("LOWER(tsa_email) = LOWER(?)");
      params.push(filter.tsa_email);
    }
    if (filter?.ie_email) {
      where.push("LOWER(ie_email) = LOWER(?)");
      params.push(filter.ie_email);
    }
    if (filter?.account_id) {
      where.push("account_id = ?");
      params.push(filter.account_id);
    }
    if (filter?.opportunity_id) {
      where.push("opportunity_id = ?");
      params.push(filter.opportunity_id);
    }
    if (filter?.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT * FROM deployment_plans ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(rowToPlan);
  }

  async getDeploymentPlan(id: number): Promise<DeploymentPlan | null> {
    const row = this.db.prepare("SELECT * FROM deployment_plans WHERE id = ?").get(id) as any;
    return row ? rowToPlan(row) : null;
  }

  async createDeploymentPlanFromTemplate(
    plan: Omit<DeploymentPlan, "id" | "created_at" | "updated_at">,
    templateItemsInOrder: DeploymentTemplateItem[]
  ): Promise<number> {
    const txn = this.db.transaction(() => {
      const r = this.db.prepare(
        `INSERT INTO deployment_plans
          (template_id, opportunity_id, opportunity_name, product, account_id, account_name,
           tsa_email, ie_email, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        plan.template_id,
        plan.opportunity_id,
        plan.opportunity_name,
        plan.product,
        plan.account_id,
        plan.account_name,
        plan.tsa_email,
        plan.ie_email,
        plan.status,
        plan.created_by
      );
      const planId = r.lastInsertRowid as number;

      // Walk template items in their stored order; map template id → new plan id.
      const templateIdToPlanItemId = new Map<number, number>();
      const insertItem = this.db.prepare(
        `INSERT INTO deployment_plan_items
          (plan_id, template_item_id, parent_id, item_id, position, activity_type,
           description, target_outcome, progress_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started')`
      );
      for (const tItem of templateItemsInOrder) {
        const parentPlanItemId =
          tItem.parent_id !== null ? templateIdToPlanItemId.get(tItem.parent_id) ?? null : null;
        const itemResult = insertItem.run(
          planId,
          tItem.id,
          parentPlanItemId,
          tItem.item_id,
          tItem.position,
          tItem.activity_type,
          tItem.description,
          tItem.target_outcome
        );
        templateIdToPlanItemId.set(tItem.id, itemResult.lastInsertRowid as number);
      }
      return planId;
    });
    return txn();
  }

  async updateDeploymentPlan(
    id: number,
    updates: Partial<Pick<DeploymentPlan, "status" | "tsa_email" | "ie_email">>
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.tsa_email !== undefined) {
      sets.push("tsa_email = ?");
      params.push(updates.tsa_email);
    }
    if (updates.ie_email !== undefined) {
      sets.push("ie_email = ?");
      params.push(updates.ie_email);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    this.db.prepare(`UPDATE deployment_plans SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  async deleteDeploymentPlan(id: number): Promise<void> {
    this.db.prepare("DELETE FROM deployment_plans WHERE id = ?").run(id);
  }

  async listDeploymentPlanItems(planId: number): Promise<DeploymentPlanItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM deployment_plan_items WHERE plan_id = ? ORDER BY position ASC, id ASC")
      .all(planId) as any[];
    return rows.map(rowToPlanItem);
  }

  async logDeploymentAudit(entry: Omit<DeploymentAuditEntry, "id" | "created_at">): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO deployment_audit
          (plan_id, plan_item_id, template_id, template_item_id, actor_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.plan_id,
        entry.plan_item_id,
        entry.template_id,
        entry.template_item_id,
        entry.actor_email,
        entry.action,
        entry.details_json
      );
  }

  close(): void {
    this.db.close();
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────

function rowToTemplate(row: any): DeploymentTemplate {
  return {
    id: row.id,
    product: row.product,
    deployment_type: row.deployment_type,
    name: row.name,
    version: row.version,
    is_active: row.is_active === 1 || row.is_active === true,
    description: row.description,
    source_file: row.source_file,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToTemplateItem(row: any): DeploymentTemplateItem {
  return {
    id: row.id,
    template_id: row.template_id,
    parent_id: row.parent_id,
    item_id: row.item_id,
    position: row.position,
    activity_type: row.activity_type,
    description: row.description,
    target_outcome: row.target_outcome,
    default_deque_role: row.default_deque_role,
    default_estimated_days: row.default_estimated_days,
    notes: row.notes,
  };
}

function rowToPlan(row: any): DeploymentPlan {
  return {
    id: row.id,
    template_id: row.template_id,
    opportunity_id: row.opportunity_id,
    opportunity_name: row.opportunity_name,
    product: row.product,
    account_id: row.account_id,
    account_name: row.account_name,
    tsa_email: row.tsa_email,
    ie_email: row.ie_email,
    status: row.status as PlanStatus,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToPlanItem(row: any): DeploymentPlanItem {
  return {
    id: row.id,
    plan_id: row.plan_id,
    template_item_id: row.template_item_id,
    parent_id: row.parent_id,
    item_id: row.item_id,
    position: row.position,
    activity_type: row.activity_type,
    description: row.description,
    target_outcome: row.target_outcome,
    progress_status: row.progress_status,
    notes: row.notes,
    deque_responsible: row.deque_responsible,
    customer_responsible: row.customer_responsible,
    start_date: row.start_date,
    end_date: row.end_date,
    estimated_days: row.estimated_days,
    actual_days: row.actual_days,
    updated_at: row.updated_at,
  };
}
