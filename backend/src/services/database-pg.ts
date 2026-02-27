import { Pool, PoolClient, PoolConfig, types } from "pg";
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
} from "./database-interface.js";

// PostgreSQL connection configuration
interface PgConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

function loadPgConfig(): PgConfig {
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;

  if (instanceConnectionName) {
    // Cloud Run with Cloud SQL - use Unix socket
    return {
      host: `/cloudsql/${instanceConnectionName}`,
      database: process.env.PG_DATABASE || "csm_dashboard",
      user: process.env.PG_USER || "csm_app",
      password: process.env.PG_PASSWORD || "",
    };
  }

  // Local development with TCP
  return {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DATABASE || "csm_dashboard",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
  };
}

// Parse BIGINT (OID 20) as JavaScript numbers instead of strings.
// Safe because Zendesk IDs (max ~40 trillion) are well within Number.MAX_SAFE_INTEGER (~9 quadrillion).
types.setTypeParser(20, (val: string) => parseInt(val, 10));

export class DatabaseServicePg implements IDatabaseService {
  private pool: Pool;

  constructor(config?: PgConfig) {
    const pgConfig = config || loadPgConfig();

    const poolConfig: PoolConfig = {
      host: pgConfig.host,
      port: pgConfig.port,
      database: pgConfig.database,
      user: pgConfig.user,
      password: pgConfig.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    this.pool = new Pool(poolConfig);

    // Handle pool errors
    this.pool.on("error", (err) => {
      console.error("Unexpected PostgreSQL pool error:", err);
    });
  }

  async initialize(): Promise<void> {
    await this.createTables();
    await this.migrateSchema();
    console.log("PostgreSQL database initialized");
  }

  private async createTables(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        domain_names TEXT,
        salesforce_id TEXT,
        salesforce_account_name TEXT,
        created_at TEXT,
        updated_at TEXT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id BIGINT PRIMARY KEY,
        organization_id BIGINT REFERENCES organizations(id),
        subject TEXT,
        status TEXT NOT NULL,
        priority TEXT,
        requester_id BIGINT,
        assignee_id BIGINT,
        tags TEXT,
        created_at TEXT,
        updated_at TEXT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        product TEXT,
        module TEXT,
        ticket_type TEXT,
        workflow_status TEXT,
        issue_subtype TEXT,
        is_escalated INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS csm_assignments (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        csm_id TEXT NOT NULL,
        csm_name TEXT NOT NULL,
        csm_email TEXT NOT NULL,
        zendesk_org_id BIGINT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pm_assignments (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        pm_id TEXT NOT NULL,
        pm_name TEXT NOT NULL,
        pm_email TEXT NOT NULL,
        zendesk_org_id BIGINT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS account_hierarchy (
        account_id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        parent_id TEXT,
        parent_name TEXT,
        ultimate_parent_id TEXT NOT NULL,
        ultimate_parent_name TEXT NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_status (
        type TEXT PRIMARY KEY,
        last_sync TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS github_issue_links (
        id SERIAL PRIMARY KEY,
        zendesk_ticket_id BIGINT NOT NULL,
        github_issue_number INTEGER NOT NULL,
        github_repo TEXT NOT NULL,
        github_project_title TEXT,
        project_status TEXT,
        sprint TEXT,
        milestone TEXT,
        release_version TEXT,
        github_url TEXT,
        github_updated_at TEXT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(zendesk_ticket_id, github_issue_number, github_repo)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('web', 'slack', 'email')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_use', 'tool_result')),
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        tool_result TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(organization_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
      CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at);
      CREATE INDEX IF NOT EXISTS idx_csm_email ON csm_assignments(csm_email);
      CREATE INDEX IF NOT EXISTS idx_csm_name ON csm_assignments(csm_name);
      CREATE INDEX IF NOT EXISTS idx_csm_org ON csm_assignments(zendesk_org_id);
      CREATE INDEX IF NOT EXISTS idx_github_links_ticket ON github_issue_links(zendesk_ticket_id);
      CREATE INDEX IF NOT EXISTS idx_github_links_repo ON github_issue_links(github_repo);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_email);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON account_hierarchy(ultimate_parent_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_parent_name ON account_hierarchy(ultimate_parent_name);
    `);
  }

  private async migrateSchema(): Promise<void> {
    // Check and add missing columns for tickets table
    const ticketColumns = await this.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tickets'
    `);
    const ticketColumnNames = ticketColumns.rows.map((c) => c.column_name);

    if (!ticketColumnNames.includes("product")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN product TEXT");
    }
    if (!ticketColumnNames.includes("module")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN module TEXT");
    }
    if (!ticketColumnNames.includes("ticket_type")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN ticket_type TEXT");
    }
    if (!ticketColumnNames.includes("workflow_status")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN workflow_status TEXT");
    }
    if (!ticketColumnNames.includes("issue_subtype")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN issue_subtype TEXT");
    }
    if (!ticketColumnNames.includes("is_escalated")) {
      await this.pool.query("ALTER TABLE tickets ADD COLUMN is_escalated INTEGER DEFAULT 0");
    }

    // Check and add missing columns for organizations table
    const orgColumns = await this.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organizations'
    `);
    const orgColumnNames = orgColumns.rows.map((c) => c.column_name);

    if (!orgColumnNames.includes("salesforce_id")) {
      await this.pool.query("ALTER TABLE organizations ADD COLUMN salesforce_id TEXT");
    }
    if (!orgColumnNames.includes("salesforce_account_name")) {
      await this.pool.query("ALTER TABLE organizations ADD COLUMN salesforce_account_name TEXT");
    }
    if (!orgColumnNames.includes("sf_ultimate_parent_name")) {
      await this.pool.query("ALTER TABLE organizations ADD COLUMN sf_ultimate_parent_name TEXT");
    }
  }

  // ==================
  // Organizations
  // ==================

  async upsertOrganization(org: CachedOrganization): Promise<void> {
    await this.pool.query(
      `INSERT INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         domain_names = EXCLUDED.domain_names,
         salesforce_id = EXCLUDED.salesforce_id,
         salesforce_account_name = EXCLUDED.salesforce_account_name,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at,
         cached_at = CURRENT_TIMESTAMP`,
      [org.id, org.name, org.domain_names, org.salesforce_id, org.salesforce_account_name, org.created_at, org.updated_at]
    );
  }

  async upsertOrganizations(orgs: CachedOrganization[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const org of orgs) {
        await client.query(
          `INSERT INTO organizations (id, name, domain_names, salesforce_id, salesforce_account_name, created_at, updated_at, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             domain_names = EXCLUDED.domain_names,
             salesforce_id = EXCLUDED.salesforce_id,
             salesforce_account_name = EXCLUDED.salesforce_account_name,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             cached_at = CURRENT_TIMESTAMP`,
          [org.id, org.name, org.domain_names, org.salesforce_id, org.salesforce_account_name, org.created_at, org.updated_at]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getOrganizationBySalesforceId(salesforceId: string): Promise<CachedOrganization | undefined> {
    const result = await this.pool.query("SELECT * FROM organizations WHERE salesforce_id = $1", [salesforceId]);
    return result.rows[0] as CachedOrganization | undefined;
  }

  async updateOrganizationSfAccountName(zendeskOrgId: number, sfAccountName: string): Promise<void> {
    await this.pool.query("UPDATE organizations SET salesforce_account_name = $1 WHERE id = $2", [sfAccountName, zendeskOrgId]);
  }

  async getOrganizations(): Promise<CachedOrganization[]> {
    const result = await this.pool.query("SELECT * FROM organizations ORDER BY name");
    return result.rows as CachedOrganization[];
  }

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
    const result = await this.pool.query("SELECT * FROM organizations WHERE id = $1", [id]);
    return result.rows[0] as CachedOrganization | undefined;
  }

  // ==================
  // Tickets
  // ==================

  async upsertTicket(ticket: CachedTicket): Promise<void> {
    await this.pool.query(
      `INSERT INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status, issue_subtype, is_escalated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         subject = EXCLUDED.subject,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         requester_id = EXCLUDED.requester_id,
         assignee_id = EXCLUDED.assignee_id,
         tags = EXCLUDED.tags,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at,
         cached_at = CURRENT_TIMESTAMP,
         product = EXCLUDED.product,
         module = EXCLUDED.module,
         ticket_type = EXCLUDED.ticket_type,
         workflow_status = EXCLUDED.workflow_status,
         issue_subtype = EXCLUDED.issue_subtype,
         is_escalated = EXCLUDED.is_escalated`,
      [
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
        ticket.is_escalated,
      ]
    );
  }

  async upsertTickets(tickets: CachedTicket[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const ticket of tickets) {
        await client.query(
          `INSERT INTO tickets (id, organization_id, subject, status, priority, requester_id, assignee_id, tags, created_at, updated_at, cached_at, product, module, ticket_type, workflow_status, issue_subtype, is_escalated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO UPDATE SET
             organization_id = EXCLUDED.organization_id,
             subject = EXCLUDED.subject,
             status = EXCLUDED.status,
             priority = EXCLUDED.priority,
             requester_id = EXCLUDED.requester_id,
             assignee_id = EXCLUDED.assignee_id,
             tags = EXCLUDED.tags,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             cached_at = CURRENT_TIMESTAMP,
             product = EXCLUDED.product,
             module = EXCLUDED.module,
             ticket_type = EXCLUDED.ticket_type,
             workflow_status = EXCLUDED.workflow_status,
             issue_subtype = EXCLUDED.issue_subtype,
             is_escalated = EXCLUDED.is_escalated`,
          [
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
            ticket.is_escalated,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getEscalationCount(orgId: number): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM tickets
       WHERE organization_id = $1 AND is_escalated = 1 AND status NOT IN ('solved', 'closed')`,
      [orgId]
    );
    return parseInt(result.rows[0].count, 10) || 0;
  }

  async getTicketsByOrganization(orgId: number): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 ORDER BY updated_at DESC",
      [orgId]
    );
    return result.rows as CachedTicket[];
  }

  async getTicketsByStatus(orgId: number, status: string): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 AND status = $2 ORDER BY updated_at DESC",
      [orgId, status]
    );
    return result.rows as CachedTicket[];
  }

  async getTicketsByPriority(orgId: number, priority: string): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 AND priority = $2 AND status NOT IN ('solved', 'closed') ORDER BY updated_at DESC",
      [orgId, priority]
    );
    return result.rows as CachedTicket[];
  }

  async getTicketsByProduct(orgId: number, product: string): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 AND product = $2 ORDER BY updated_at DESC",
      [orgId, product]
    );
    return result.rows as CachedTicket[];
  }

  async getTicketsByModule(orgId: number, product: string, module: string): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 AND product = $2 AND module = $3 ORDER BY updated_at DESC",
      [orgId, product, module]
    );
    return result.rows as CachedTicket[];
  }

  async getTicketsByType(orgId: number, ticketType: string): Promise<CachedTicket[]> {
    const result = await this.pool.query(
      "SELECT * FROM tickets WHERE organization_id = $1 AND ticket_type = $2 ORDER BY updated_at DESC",
      [orgId, ticketType]
    );
    return result.rows as CachedTicket[];
  }

  async getAllTickets(): Promise<CachedTicket[]> {
    const result = await this.pool.query("SELECT * FROM tickets ORDER BY updated_at DESC");
    return result.rows as CachedTicket[];
  }

  async getTicketStats(orgId: number): Promise<TicketStats> {
    const result = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as hold,
        SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) as solved,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
      FROM tickets WHERE organization_id = $1`,
      [orgId]
    );

    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10) || 0,
      new: parseInt(row.new, 10) || 0,
      open: parseInt(row.open, 10) || 0,
      pending: parseInt(row.pending, 10) || 0,
      hold: parseInt(row.hold, 10) || 0,
      solved: parseInt(row.solved, 10) || 0,
      closed: parseInt(row.closed, 10) || 0,
    };
  }

  async getPriorityBreakdown(orgId: number): Promise<PriorityBreakdown> {
    const result = await this.pool.query(
      `SELECT
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN priority = 'normal' OR priority IS NULL THEN 1 ELSE 0 END) as normal,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent
      FROM tickets WHERE organization_id = $1 AND status NOT IN ('solved', 'closed')`,
      [orgId]
    );

    const row = result.rows[0];
    return {
      low: parseInt(row.low, 10) || 0,
      normal: parseInt(row.normal, 10) || 0,
      high: parseInt(row.high, 10) || 0,
      urgent: parseInt(row.urgent, 10) || 0,
    };
  }

  // ==================
  // CSM Assignments
  // ==================

  async upsertCSMAssignment(assignment: CachedCSMAssignment): Promise<void> {
    await this.pool.query(
      `INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (account_id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         csm_id = EXCLUDED.csm_id,
         csm_name = EXCLUDED.csm_name,
         csm_email = EXCLUDED.csm_email,
         zendesk_org_id = EXCLUDED.zendesk_org_id,
         cached_at = CURRENT_TIMESTAMP`,
      [assignment.account_id, assignment.account_name, assignment.csm_id, assignment.csm_name, assignment.csm_email, assignment.zendesk_org_id]
    );
  }

  async upsertCSMAssignments(assignments: CachedCSMAssignment[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Clear existing assignments first
      await client.query("DELETE FROM csm_assignments");

      for (const a of assignments) {
        await client.query(
          `INSERT INTO csm_assignments (account_id, account_name, csm_id, csm_name, csm_email, zendesk_org_id, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [a.account_id, a.account_name, a.csm_id, a.csm_name, a.csm_email, a.zendesk_org_id]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getCSMAssignments(): Promise<CachedCSMAssignment[]> {
    const result = await this.pool.query("SELECT * FROM csm_assignments ORDER BY csm_name, account_name");
    return result.rows as CachedCSMAssignment[];
  }

  async getCSMPortfolios(): Promise<CSMPortfolio[]> {
    // Use STRING_AGG instead of GROUP_CONCAT
    const result = await this.pool.query(`
      SELECT
        csm_name,
        STRING_AGG(DISTINCT zendesk_org_id::text, ',') as org_ids,
        STRING_AGG(DISTINCT csm_email, ',') as emails
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL
      GROUP BY csm_name
      ORDER BY csm_name
    `);

    return result.rows.map((row) => {
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

  async getCSMPortfolioByEmail(email: string): Promise<CSMPortfolio | null> {
    // First, find the CSM name for this email
    const csmNameResult = await this.pool.query(
      "SELECT csm_name FROM csm_assignments WHERE LOWER(csm_email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (csmNameResult.rows.length === 0) return null;

    const csmName = csmNameResult.rows[0].csm_name;

    // Then get all accounts for this CSM
    const result = await this.pool.query(
      `SELECT
        csm_name,
        STRING_AGG(DISTINCT zendesk_org_id::text, ',') as org_ids,
        STRING_AGG(DISTINCT csm_email, ',') as emails
      FROM csm_assignments
      WHERE zendesk_org_id IS NOT NULL AND csm_name = $1
      GROUP BY csm_name`,
      [csmName]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const emails = row.emails ? row.emails.split(",") : [];
    const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
    const csm_email = dequeEmail || emails[0] || email;

    return {
      csm_email,
      csm_name: row.csm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    };
  }

  async getCSMAssignmentByOrgId(orgId: number): Promise<CachedCSMAssignment | null> {
    const result = await this.pool.query("SELECT * FROM csm_assignments WHERE zendesk_org_id = $1", [orgId]);
    return result.rows[0] as CachedCSMAssignment | null;
  }

  // ==================
  // PM Assignments
  // ==================

  async upsertPMAssignments(assignments: CachedPMAssignment[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Clear existing assignments first
      await client.query("DELETE FROM pm_assignments");

      for (const a of assignments) {
        await client.query(
          `INSERT INTO pm_assignments (account_id, account_name, pm_id, pm_name, pm_email, zendesk_org_id, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [a.account_id, a.account_name, a.pm_id, a.pm_name, a.pm_email, a.zendesk_org_id]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getPMAssignments(): Promise<CachedPMAssignment[]> {
    const result = await this.pool.query("SELECT * FROM pm_assignments ORDER BY pm_name, account_name");
    return result.rows as CachedPMAssignment[];
  }

  async getPMPortfolios(): Promise<PMPortfolio[]> {
    const result = await this.pool.query(`
      SELECT
        pm_name,
        STRING_AGG(DISTINCT zendesk_org_id::text, ',') as org_ids,
        STRING_AGG(DISTINCT pm_email, ',') as emails
      FROM pm_assignments
      WHERE zendesk_org_id IS NOT NULL
      GROUP BY pm_name
      ORDER BY pm_name
    `);

    return result.rows.map((row) => {
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

  async getPMPortfolioByEmail(email: string): Promise<PMPortfolio | null> {
    const pmNameResult = await this.pool.query(
      "SELECT pm_name FROM pm_assignments WHERE LOWER(pm_email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (pmNameResult.rows.length === 0) return null;

    const pmName = pmNameResult.rows[0].pm_name;

    const result = await this.pool.query(
      `SELECT
        pm_name,
        STRING_AGG(DISTINCT zendesk_org_id::text, ',') as org_ids,
        STRING_AGG(DISTINCT pm_email, ',') as emails
      FROM pm_assignments
      WHERE zendesk_org_id IS NOT NULL AND pm_name = $1
      GROUP BY pm_name`,
      [pmName]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const emails = row.emails ? row.emails.split(",") : [];
    const dequeEmail = emails.find((e: string) => e.toLowerCase().endsWith("@deque.com"));
    const pm_email = dequeEmail || emails[0] || email;

    return {
      pm_email,
      pm_name: row.pm_name,
      org_ids: row.org_ids ? row.org_ids.split(",").map(Number) : [],
    };
  }

  async getPMAssignmentByOrgId(orgId: number): Promise<CachedPMAssignment | null> {
    const result = await this.pool.query("SELECT * FROM pm_assignments WHERE zendesk_org_id = $1", [orgId]);
    return result.rows[0] as CachedPMAssignment | null;
  }

  // ==================
  // Account Hierarchy
  // ==================

  async upsertAccountHierarchy(entries: CachedAccountHierarchy[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM account_hierarchy");

      for (const e of entries) {
        await client.query(
          `INSERT INTO account_hierarchy (account_id, account_name, parent_id, parent_name, ultimate_parent_id, ultimate_parent_name, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [e.account_id, e.account_name, e.parent_id, e.parent_name, e.ultimate_parent_id, e.ultimate_parent_name]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getAccountHierarchy(): Promise<CachedAccountHierarchy[]> {
    const result = await this.pool.query("SELECT * FROM account_hierarchy ORDER BY ultimate_parent_name, account_name");
    return result.rows as CachedAccountHierarchy[];
  }

  async updateOrganizationParentName(zendeskOrgId: number, parentName: string): Promise<void> {
    await this.pool.query("UPDATE organizations SET sf_ultimate_parent_name = $1 WHERE id = $2", [parentName, zendeskOrgId]);
  }

  // ==================
  // Sync Status
  // ==================

  async updateSyncStatus(type: string, status: string, recordCount: number, errorMessage?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_status (type, last_sync, status, record_count, error_message)
       VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4)
       ON CONFLICT (type) DO UPDATE SET
         last_sync = CURRENT_TIMESTAMP,
         status = EXCLUDED.status,
         record_count = EXCLUDED.record_count,
         error_message = EXCLUDED.error_message`,
      [type, status, recordCount, errorMessage || null]
    );
  }

  async getSyncStatus(): Promise<SyncStatus[]> {
    const result = await this.pool.query("SELECT * FROM sync_status ORDER BY type");
    return result.rows as SyncStatus[];
  }

  async getLastSyncTime(type: string): Promise<string | null> {
    const result = await this.pool.query("SELECT last_sync FROM sync_status WHERE type = $1", [type]);
    return result.rows[0]?.last_sync || null;
  }

  // ==================
  // Sync Metadata
  // ==================

  async getSyncMetadata(key: string): Promise<string | null> {
    const result = await this.pool.query("SELECT value FROM sync_metadata WHERE key = $1", [key]);
    return result.rows[0]?.value || null;
  }

  async setSyncMetadata(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_metadata (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  }

  // ==================
  // GitHub Issue Links
  // ==================

  async upsertGitHubLinks(links: CachedGitHubLink[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const link of links) {
        await client.query(
          `INSERT INTO github_issue_links
           (zendesk_ticket_id, github_issue_number, github_repo, github_project_title, project_status, sprint, milestone, release_version, github_url, github_updated_at, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
           ON CONFLICT (zendesk_ticket_id, github_issue_number, github_repo) DO UPDATE SET
             github_project_title = EXCLUDED.github_project_title,
             project_status = EXCLUDED.project_status,
             sprint = EXCLUDED.sprint,
             milestone = EXCLUDED.milestone,
             release_version = EXCLUDED.release_version,
             github_url = EXCLUDED.github_url,
             github_updated_at = EXCLUDED.github_updated_at,
             cached_at = CURRENT_TIMESTAMP`,
          [
            link.zendesk_ticket_id,
            link.github_issue_number,
            link.github_repo,
            link.github_project_title,
            link.project_status,
            link.sprint,
            link.milestone,
            link.release_version,
            link.github_url,
            link.github_updated_at,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getGitHubLinksByTicketId(ticketId: number): Promise<CachedGitHubLink[]> {
    const result = await this.pool.query("SELECT * FROM github_issue_links WHERE zendesk_ticket_id = $1", [ticketId]);
    return result.rows as CachedGitHubLink[];
  }

  async getGitHubLinksByTicketIds(ticketIds: number[]): Promise<Map<number, CachedGitHubLink[]>> {
    if (ticketIds.length === 0) return new Map();

    // Create parameterized placeholders: $1, $2, $3, ...
    const placeholders = ticketIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await this.pool.query(
      `SELECT * FROM github_issue_links WHERE zendesk_ticket_id IN (${placeholders})`,
      ticketIds
    );

    const linkMap = new Map<number, CachedGitHubLink[]>();
    for (const row of result.rows) {
      const existing = linkMap.get(row.zendesk_ticket_id) || [];
      existing.push(row as CachedGitHubLink);
      linkMap.set(row.zendesk_ticket_id, existing);
    }
    return linkMap;
  }

  async clearGitHubLinks(): Promise<void> {
    await this.pool.query("DELETE FROM github_issue_links");
  }

  async getAllTicketIds(): Promise<number[]> {
    const result = await this.pool.query("SELECT id FROM tickets");
    return result.rows.map((r) => r.id);
  }

  // ==================
  // Utility
  // ==================

  async clearAll(): Promise<void> {
    await this.pool.query(`
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
    await this.pool.query(
      `INSERT INTO conversations (id, user_id, user_email, channel, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [conversation.id, conversation.user_id, conversation.user_email, conversation.channel, conversation.metadata || null]
    );
    return (await this.getConversation(conversation.id))!;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const result = await this.pool.query("SELECT * FROM conversations WHERE id = $1", [id]);
    return (result.rows[0] as Conversation) || null;
  }

  async getConversationsByUser(userEmail: string, limit: number = 50): Promise<Conversation[]> {
    const result = await this.pool.query(
      "SELECT * FROM conversations WHERE user_email = $1 ORDER BY updated_at DESC LIMIT $2",
      [userEmail, limit]
    );
    return result.rows as Conversation[];
  }

  async updateConversationTimestamp(conversationId: string): Promise<void> {
    await this.pool.query("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [conversationId]);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM conversation_messages WHERE conversation_id = $1", [conversationId]);
      await client.query("DELETE FROM conversations WHERE id = $1", [conversationId]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ==================
  // Conversation Messages
  // ==================

  async saveMessage(message: Omit<ConversationMessage, "id" | "created_at">): Promise<ConversationMessage> {
    const result = await this.pool.query(
      `INSERT INTO conversation_messages (conversation_id, role, content, tool_name, tool_input, tool_result, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING id, created_at`,
      [message.conversation_id, message.role, message.content, message.tool_name || null, message.tool_input || null, message.tool_result || null]
    );

    // Update conversation timestamp
    await this.updateConversationTimestamp(message.conversation_id);

    return {
      id: result.rows[0].id,
      conversation_id: message.conversation_id,
      role: message.role,
      content: message.content,
      tool_name: message.tool_name,
      tool_input: message.tool_input,
      tool_result: message.tool_result,
      created_at: result.rows[0].created_at,
    };
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const result = await this.pool.query(
      "SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [conversationId]
    );
    return result.rows as ConversationMessage[];
  }

  async getRecentMessages(conversationId: string, limit: number = 20): Promise<ConversationMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit]
    );
    return result.rows.reverse() as ConversationMessage[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
