import Anthropic from "@anthropic-ai/sdk";
import type { IDatabaseService, CachedTicket, CachedOrganization } from "./database-interface.js";
import { ZendeskService } from "./zendesk.js";
import { SalesforceService, RenewalOpportunity } from "./salesforce.js";
import { v4 as uuidv4 } from "uuid";

// Tool definitions for Claude
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// Context passed to the agent for each conversation
export interface ConversationContext {
  conversationId: string;
  userId: string;
  userEmail: string;
  channel: "web" | "slack" | "email";
  csmPortfolioOrgIds?: number[];
}

// Agent response structure
export interface AgentResponse {
  response: string;
  conversationId: string;
  toolsUsed?: string[];
}

// Message format for conversation history
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class AgentService {
  private anthropic: Anthropic;
  private db: IDatabaseService;
  private zendesk: ZendeskService;
  private salesforce: SalesforceService | null;
  private apiBaseUrl: string;
  private model: string;
  private maxTokens: number;

  constructor(
    db: IDatabaseService,
    zendesk: ZendeskService,
    config: {
      apiKey: string;
      model?: string;
      maxTokens?: number;
    },
    salesforce?: SalesforceService | null,
    apiBaseUrl?: string
  ) {
    this.anthropic = new Anthropic({ apiKey: config.apiKey });
    this.db = db;
    this.zendesk = zendesk;
    this.salesforce = salesforce || null;
    this.apiBaseUrl = apiBaseUrl || "http://localhost:3001";
    this.model = config.model || "claude-sonnet-4-20250514";
    this.maxTokens = config.maxTokens || 4096;
  }

  // System prompt for the CSM Agent
  private getSystemPrompt(context: ConversationContext): string {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return `You are a helpful AI assistant for Customer Success Managers (CSMs) and Product Renewal Specialists (PRS) at Deque Systems. You help manage customer relationships by providing insights about support tickets, product usage analytics, and renewal opportunities.

Today's date is ${today}. Always use this as the reference for "this month", "current month", "upcoming", etc.

You have access to tools that can query:
- Zendesk support tickets (bugs, feature requests, status, priority, etc.)
- Customer organization information
- CSM and PRS portfolio assignments
- GitHub development status for tickets
- Product usage analytics from Amplitude (axe DevTools, Monitor, University, etc.)
- Salesforce renewal opportunities and subscription data

When answering questions:
- Be concise and actionable
- Focus on the most relevant information
- Highlight urgent items (escalations, high-priority tickets, at-risk renewals)
- Provide context about trends when useful (usage growth/decline, renewal timelines)
- Format data clearly using bullet points or tables when appropriate

The current user is: ${context.userEmail}
Channel: ${context.channel}

If the user asks about "my portfolio" or "my customers", use their email to look up their assigned organizations.
If the user asks about "renewals" or "opportunities", use the renewal tools to fetch Salesforce data.
If the user asks about "usage" or "analytics", use the product usage tools to fetch Amplitude data.`;
  }

  // Define available tools
  private getTools(): ToolDefinition[] {
    return [
      {
        name: "get_tickets_for_organization",
        description:
          "Retrieves support tickets for a specific organization. Can filter by status, priority, or ticket type. Use this when the user asks about tickets for a specific customer.",
        input_schema: {
          type: "object",
          properties: {
            organization_name: {
              type: "string",
              description: "Name of the organization (partial match supported)",
            },
            status: {
              type: "string",
              enum: ["new", "open", "pending", "hold", "solved", "closed"],
              description: "Filter by ticket status",
            },
            priority: {
              type: "string",
              enum: ["low", "normal", "high", "urgent"],
              description: "Filter by priority level",
            },
            ticket_type: {
              type: "string",
              enum: ["bug", "feature", "other"],
              description: "Filter by ticket type",
            },
            limit: {
              type: "number",
              description: "Maximum number of tickets to return (default: 20)",
            },
          },
          required: ["organization_name"],
        },
      },
      {
        name: "get_escalated_tickets",
        description:
          "Gets all escalated tickets across organizations or for a specific organization. Escalated tickets require immediate attention.",
        input_schema: {
          type: "object",
          properties: {
            organization_name: {
              type: "string",
              description: "Optional: filter to a specific organization",
            },
            include_resolved: {
              type: "boolean",
              description: "Include resolved escalations (default: false)",
            },
          },
        },
      },
      {
        name: "get_customer_summary",
        description:
          "Gets a comprehensive summary of a customer including ticket statistics, priority breakdown, open issues, and recent activity.",
        input_schema: {
          type: "object",
          properties: {
            organization_name: {
              type: "string",
              description: "Name of the organization",
            },
          },
          required: ["organization_name"],
        },
      },
      {
        name: "get_csm_portfolio",
        description:
          "Gets the list of customers assigned to a CSM along with summary statistics for each. Use this when asking about 'my customers' or a specific CSM's portfolio.",
        input_schema: {
          type: "object",
          properties: {
            csm_email: {
              type: "string",
              description: "CSM's email address. If not provided, uses the current user's email.",
            },
          },
        },
      },
      {
        name: "search_tickets",
        description:
          "Searches for tickets across all organizations by keyword in subject or description. Use for finding specific tickets or patterns.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query - matches against ticket subject",
            },
            status: {
              type: "string",
              enum: ["new", "open", "pending", "hold", "solved", "closed"],
              description: "Optional status filter",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_ticket_details",
        description: "Gets detailed information about a specific ticket by ID.",
        input_schema: {
          type: "object",
          properties: {
            ticket_id: {
              type: "number",
              description: "The Zendesk ticket ID",
            },
          },
          required: ["ticket_id"],
        },
      },
      {
        name: "get_github_status",
        description:
          "Gets GitHub development status for a ticket, including linked issues, sprint assignment, and progress status.",
        input_schema: {
          type: "object",
          properties: {
            ticket_id: {
              type: "number",
              description: "The Zendesk ticket ID to check for GitHub links",
            },
          },
          required: ["ticket_id"],
        },
      },
      {
        name: "get_organization_list",
        description: "Gets a list of all customer organizations. Use to find organization names or IDs.",
        input_schema: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "Optional search filter for organization name",
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 50)",
            },
          },
        },
      },
      // Usage Analytics Tools
      {
        name: "get_product_usage_summary",
        description: "Gets product usage summary for a specific organization. Shows metrics like active users, page views, and logins for products like axe DevTools, axe Monitor, Deque University, etc.",
        input_schema: {
          type: "object",
          properties: {
            organization_name: {
              type: "string",
              description: "Name or domain of the organization to get usage for",
            },
            product: {
              type: "string",
              enum: ["axe-devtools", "axe-monitor", "deque-university", "axe-auditor", "axe-reports", "axe-account-portal"],
              description: "Product to get usage for. If not specified, returns all products.",
            },
          },
          required: ["organization_name"],
        },
      },
      // Renewal Tools
      {
        name: "get_renewal_opportunities",
        description: "Gets upcoming renewal opportunities from Salesforce. Shows renewal date, amount, stage, owner, and PRS assignment. Use this to find renewals coming up in the next N days.",
        input_schema: {
          type: "object",
          properties: {
            days_ahead: {
              type: "number",
              description: "Number of days to look ahead for renewals (default: 60, max: 180)",
            },
            account_name: {
              type: "string",
              description: "Optional: filter to a specific account/customer name",
            },
            prs_name: {
              type: "string",
              description: "Optional: filter to renewals assigned to a specific PRS",
            },
            at_risk_only: {
              type: "boolean",
              description: "If true, only return at-risk renewals",
            },
          },
        },
      },
      {
        name: "get_enterprise_subscriptions",
        description: "Gets enterprise subscription/license information for an account from Salesforce. Shows product types, license counts, and subscription details.",
        input_schema: {
          type: "object",
          properties: {
            account_name: {
              type: "string",
              description: "Name of the account/customer to get subscriptions for",
            },
          },
          required: ["account_name"],
        },
      },
    ];
  }

  // Execute a tool call
  private async executeTool(
    toolName: string,
    toolInput: Record<string, any>,
    context: ConversationContext
  ): Promise<string> {
    try {
      switch (toolName) {
        case "get_tickets_for_organization":
          return await this.toolGetTicketsForOrganization(toolInput as any);

        case "get_escalated_tickets":
          return await this.toolGetEscalatedTickets(toolInput as any);

        case "get_customer_summary":
          return await this.toolGetCustomerSummary(toolInput as any);

        case "get_csm_portfolio":
          return await this.toolGetCSMPortfolio(toolInput as any, context);

        case "search_tickets":
          return await this.toolSearchTickets(toolInput as any);

        case "get_ticket_details":
          return await this.toolGetTicketDetails(toolInput as any);

        case "get_github_status":
          return await this.toolGetGitHubStatus(toolInput as any);

        case "get_organization_list":
          return await this.toolGetOrganizationList(toolInput as any);

        // Usage Analytics tools
        case "get_product_usage_summary":
          return await this.toolGetProductUsageSummary(toolInput as any);

        // Renewal tools
        case "get_renewal_opportunities":
          return await this.toolGetRenewalOpportunities(toolInput as any);

        case "get_enterprise_subscriptions":
          return await this.toolGetEnterpriseSubscriptions(toolInput as any);

        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error) {
      console.error(`Tool execution error (${toolName}):`, error);
      return JSON.stringify({
        error: `Failed to execute ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  // Tool implementations
  private async toolGetTicketsForOrganization(input: {
    organization_name: string;
    status?: string;
    priority?: string;
    ticket_type?: string;
    limit?: number;
  }): Promise<string> {
    const limit = input.limit || 20;

    // Find organization by name (partial match)
    const orgs = await this.db.getOrganizations();
    const org = orgs.find((o) => o.name.toLowerCase().includes(input.organization_name.toLowerCase()));

    if (!org) {
      return JSON.stringify({
        error: `Organization not found: ${input.organization_name}`,
        suggestion: "Try using get_organization_list to find the correct name",
      });
    }

    let tickets = await this.db.getTicketsByOrganization(org.id);

    // Apply filters
    if (input.status) {
      tickets = tickets.filter((t) => t.status === input.status);
    }
    if (input.priority) {
      tickets = tickets.filter((t) => t.priority === input.priority);
    }
    if (input.ticket_type) {
      tickets = tickets.filter((t) => t.ticket_type === input.ticket_type);
    }

    // Limit results
    tickets = tickets.slice(0, limit);

    return JSON.stringify({
      organization: { id: org.id, name: org.name },
      total_found: tickets.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        type: t.ticket_type,
        product: t.product,
        module: t.module,
        is_escalated: t.is_escalated === 1,
        updated_at: t.updated_at,
      })),
    });
  }

  private async toolGetEscalatedTickets(input: { organization_name?: string; include_resolved?: boolean }): Promise<string> {
    const orgs = await this.db.getOrganizations();
    let targetOrgs = orgs;

    if (input.organization_name) {
      targetOrgs = orgs.filter((o) => o.name.toLowerCase().includes(input.organization_name!.toLowerCase()));
      if (targetOrgs.length === 0) {
        return JSON.stringify({ error: `Organization not found: ${input.organization_name}` });
      }
    }

    const escalatedTickets: Array<CachedTicket & { organization_name: string }> = [];

    for (const org of targetOrgs) {
      const tickets = await this.db.getTicketsByOrganization(org.id);
      const escalated = tickets.filter((t) => {
        if (t.is_escalated !== 1) return false;
        if (!input.include_resolved && (t.status === "solved" || t.status === "closed")) return false;
        return true;
      });
      escalated.forEach((t) => escalatedTickets.push({ ...t, organization_name: org.name }));
    }

    // Sort by updated_at descending
    escalatedTickets.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return JSON.stringify({
      total_escalations: escalatedTickets.length,
      escalations: escalatedTickets.slice(0, 50).map((t) => ({
        id: t.id,
        subject: t.subject,
        organization: t.organization_name,
        status: t.status,
        priority: t.priority,
        product: t.product,
        updated_at: t.updated_at,
      })),
    });
  }

  private async toolGetCustomerSummary(input: { organization_name: string }): Promise<string> {
    const orgs = await this.db.getOrganizations();
    const org = orgs.find((o) => o.name.toLowerCase().includes(input.organization_name.toLowerCase()));

    if (!org) {
      return JSON.stringify({ error: `Organization not found: ${input.organization_name}` });
    }

    const tickets = await this.db.getTicketsByOrganization(org.id);
    const stats = await this.db.getTicketStats(org.id);
    const priorityBreakdown = await this.db.getPriorityBreakdown(org.id);
    const escalationCount = await this.db.getEscalationCount(org.id);

    // Calculate additional metrics
    const openTickets = tickets.filter((t) => !["solved", "closed"].includes(t.status));
    const bugs = tickets.filter((t) => t.ticket_type === "bug");
    const features = tickets.filter((t) => t.ticket_type === "feature");
    const openBugs = bugs.filter((t) => !["solved", "closed"].includes(t.status));
    const openFeatures = features.filter((t) => !["solved", "closed"].includes(t.status));

    // Get CSM assignment
    const csmAssignment = await this.db.getCSMAssignmentByOrgId(org.id);

    // Recent high priority tickets
    const recentHighPriority = openTickets
      .filter((t) => t.priority === "high" || t.priority === "urgent")
      .slice(0, 5);

    return JSON.stringify({
      organization: {
        id: org.id,
        name: org.name,
        salesforce_account: org.salesforce_account_name,
      },
      csm: csmAssignment
        ? {
            name: csmAssignment.csm_name,
            email: csmAssignment.csm_email,
          }
        : null,
      ticket_stats: {
        total: stats.total,
        open: stats.new + stats.open + stats.pending + stats.hold,
        solved: stats.solved,
        closed: stats.closed,
      },
      priority_breakdown: priorityBreakdown,
      escalations: escalationCount,
      by_type: {
        bugs: { total: bugs.length, open: openBugs.length },
        features: { total: features.length, open: openFeatures.length },
      },
      recent_high_priority: recentHighPriority.map((t) => ({
        id: t.id,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        type: t.ticket_type,
      })),
    });
  }

  private async toolGetCSMPortfolio(input: { csm_email?: string }, context: ConversationContext): Promise<string> {
    const email = input.csm_email || context.userEmail;
    const portfolio = await this.db.getCSMPortfolioByEmail(email);

    if (!portfolio) {
      return JSON.stringify({
        error: `No portfolio found for ${email}`,
        suggestion: "This user may not have CSM assignments in Salesforce",
      });
    }

    // Get summary for each organization
    const customerSummaries: Array<{
      id: number;
      name: string;
      open_tickets: number;
      escalations: number;
      high_priority: number;
      urgent: number;
    }> = [];
    for (const orgId of portfolio.org_ids) {
      const org = await this.db.getOrganization(orgId);
      if (!org) continue;

      const stats = await this.db.getTicketStats(orgId);
      const escalations = await this.db.getEscalationCount(orgId);
      const highPriorityTickets = await this.db.getTicketsByPriority(orgId, "high");
      const urgentTickets = await this.db.getTicketsByPriority(orgId, "urgent");

      customerSummaries.push({
        id: orgId,
        name: org.name,
        open_tickets: stats.new + stats.open + stats.pending + stats.hold,
        escalations,
        high_priority: highPriorityTickets.filter((t) => !["solved", "closed"].includes(t.status)).length,
        urgent: urgentTickets.filter((t) => !["solved", "closed"].includes(t.status)).length,
      });
    }

    return JSON.stringify({
      csm: {
        name: portfolio.csm_name,
        email: portfolio.csm_email,
      },
      total_customers: customerSummaries.length,
      customers: customerSummaries,
      totals: {
        open_tickets: customerSummaries.reduce((sum, c) => sum + c.open_tickets, 0),
        escalations: customerSummaries.reduce((sum, c) => sum + c.escalations, 0),
        high_priority: customerSummaries.reduce((sum, c) => sum + c.high_priority, 0),
        urgent: customerSummaries.reduce((sum, c) => sum + c.urgent, 0),
      },
    });
  }

  private async toolSearchTickets(input: { query: string; status?: string; limit?: number }): Promise<string> {
    const limit = input.limit || 20;
    const query = input.query.toLowerCase();

    // Get all organizations and their tickets
    const orgs = await this.db.getOrganizations();
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    const matchingTickets: Array<CachedTicket & { organization_name: string }> = [];

    for (const org of orgs) {
      let tickets = await this.db.getTicketsByOrganization(org.id);

      // Filter by status if provided
      if (input.status) {
        tickets = tickets.filter((t) => t.status === input.status);
      }

      // Search in subject
      const matches = tickets.filter((t) => t.subject.toLowerCase().includes(query));

      matches.forEach((t) => matchingTickets.push({ ...t, organization_name: org.name }));
    }

    // Sort by relevance (exact match first) then by date
    matchingTickets.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return JSON.stringify({
      query: input.query,
      total_found: matchingTickets.length,
      showing: Math.min(limit, matchingTickets.length),
      tickets: matchingTickets.slice(0, limit).map((t) => ({
        id: t.id,
        subject: t.subject,
        organization: t.organization_name,
        status: t.status,
        priority: t.priority,
        type: t.ticket_type,
        is_escalated: t.is_escalated === 1,
        updated_at: t.updated_at,
      })),
    });
  }

  private async toolGetTicketDetails(input: { ticket_id: number }): Promise<string> {
    // Find ticket across all organizations
    const orgs = await this.db.getOrganizations();

    for (const org of orgs) {
      const tickets = await this.db.getTicketsByOrganization(org.id);
      const ticket = tickets.find((t) => t.id === input.ticket_id);

      if (ticket) {
        // Get GitHub links
        const githubLinks = await this.db.getGitHubLinksByTicketId(ticket.id);

        return JSON.stringify({
          ticket: {
            id: ticket.id,
            subject: ticket.subject,
            status: ticket.status,
            priority: ticket.priority,
            type: ticket.ticket_type,
            product: ticket.product,
            module: ticket.module,
            workflow_status: ticket.workflow_status,
            is_escalated: ticket.is_escalated === 1,
            created_at: ticket.created_at,
            updated_at: ticket.updated_at,
            tags: ticket.tags ? JSON.parse(ticket.tags) : [],
          },
          organization: {
            id: org.id,
            name: org.name,
          },
          github_links: githubLinks.map((l) => ({
            repo: l.github_repo,
            issue_number: l.github_issue_number,
            status: l.project_status,
            sprint: l.sprint,
            url: l.github_url,
          })),
        });
      }
    }

    return JSON.stringify({ error: `Ticket not found: ${input.ticket_id}` });
  }

  private async toolGetGitHubStatus(input: { ticket_id: number }): Promise<string> {
    const links = await this.db.getGitHubLinksByTicketId(input.ticket_id);

    if (links.length === 0) {
      return JSON.stringify({
        ticket_id: input.ticket_id,
        github_links: [],
        message: "No GitHub issues linked to this ticket",
      });
    }

    return JSON.stringify({
      ticket_id: input.ticket_id,
      total_links: links.length,
      github_issues: links.map((l) => ({
        repo: l.github_repo,
        issue_number: l.github_issue_number,
        project: l.github_project_title,
        status: l.project_status,
        sprint: l.sprint,
        milestone: l.milestone,
        release: l.release_version,
        url: l.github_url,
      })),
    });
  }

  private async toolGetOrganizationList(input: { search?: string; limit?: number }): Promise<string> {
    const limit = input.limit || 50;
    let orgs = await this.db.getOrganizations();

    if (input.search) {
      const search = input.search.toLowerCase();
      orgs = orgs.filter((o) => o.name.toLowerCase().includes(search));
    }

    return JSON.stringify({
      total: orgs.length,
      organizations: orgs.slice(0, limit).map((o) => ({
        id: o.id,
        name: o.name,
        salesforce_account: o.salesforce_account_name,
      })),
    });
  }

  // Usage Analytics tool - fetches from internal API
  private async toolGetProductUsageSummary(input: {
    organization_name: string;
    product?: string;
  }): Promise<string> {
    try {
      const orgEncoded = encodeURIComponent(input.organization_name);
      const url = `${this.apiBaseUrl}/api/amplitude/org/${orgEncoded}`;

      const response = await fetch(url);
      if (!response.ok) {
        return JSON.stringify({
          error: `Failed to fetch usage data: ${response.status}`,
          organization: input.organization_name,
        });
      }

      const data = await response.json();

      // Filter by product if specified
      let summaries = data.summaries || [];
      if (input.product) {
        summaries = summaries.filter((s: any) =>
          s.slug?.toLowerCase().includes(input.product!.toLowerCase())
        );
      }

      return JSON.stringify({
        organization: input.organization_name,
        total_products: summaries.length,
        usage_summaries: summaries.map((s: any) => ({
          product: s.product || s.slug,
          active_users_30d: s.activeUsers30d,
          new_users_30d: s.newUsers30d,
          total_events_30d: s.totalEvents30d,
          trend: s.trend,
        })),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to fetch usage data: ${error instanceof Error ? error.message : "Unknown error"}`,
        organization: input.organization_name,
      });
    }
  }

  // Renewal opportunities tool - fetches from Salesforce
  private async toolGetRenewalOpportunities(input: {
    days_ahead?: number;
    account_name?: string;
    prs_name?: string;
    at_risk_only?: boolean;
  }): Promise<string> {
    if (!this.salesforce) {
      return JSON.stringify({
        error: "Salesforce is not configured. Renewal data is unavailable.",
      });
    }

    try {
      const daysAhead = Math.min(input.days_ahead || 60, 180);
      let opportunities = await this.salesforce.getRenewalOpportunities(daysAhead);

      // Filter by account name
      if (input.account_name) {
        const search = input.account_name.toLowerCase();
        opportunities = opportunities.filter((o) =>
          o.accountName.toLowerCase().includes(search)
        );
      }

      // Filter by PRS name
      if (input.prs_name) {
        const search = input.prs_name.toLowerCase();
        opportunities = opportunities.filter((o) =>
          o.prsName?.toLowerCase().includes(search)
        );
      }

      // Filter by at-risk status
      if (input.at_risk_only) {
        opportunities = opportunities.filter((o) => o.atRisk === true);
      }

      // Calculate summary stats
      const totalValue = opportunities.reduce((sum, o) => sum + (o.amount || 0), 0);
      const atRiskCount = opportunities.filter((o) => o.atRisk).length;
      const atRiskValue = opportunities.filter((o) => o.atRisk).reduce((sum, o) => sum + (o.amount || 0), 0);

      return JSON.stringify({
        days_ahead: daysAhead,
        total_opportunities: opportunities.length,
        total_value: totalValue,
        at_risk_count: atRiskCount,
        at_risk_value: atRiskValue,
        opportunities: opportunities.slice(0, 50).map((o) => ({
          name: o.name,
          account: o.accountName,
          amount: o.amount,
          stage: o.stageName,
          renewal_date: o.renewalDate,
          owner: o.ownerName,
          prs: o.prsName || "Unassigned",
          renewal_status: o.renewalStatus,
          at_risk: o.atRisk,
          po_required: o.poRequired,
        })),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to fetch renewal opportunities: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  // Enterprise subscriptions tool - fetches from Salesforce
  private async toolGetEnterpriseSubscriptions(input: {
    account_name: string;
  }): Promise<string> {
    if (!this.salesforce) {
      return JSON.stringify({
        error: "Salesforce is not configured. Subscription data is unavailable.",
      });
    }

    try {
      const subscriptions = await this.salesforce.getEnterpriseSubscriptionsByAccountName(input.account_name);

      if (subscriptions.length === 0) {
        return JSON.stringify({
          account_name: input.account_name,
          message: "No enterprise subscriptions found for this account",
          subscriptions: [],
        });
      }

      // Calculate total licenses
      const totalLicenses = subscriptions.reduce((sum, s) => sum + (s.licenseCount || 0), 0);

      return JSON.stringify({
        account_name: input.account_name,
        total_subscriptions: subscriptions.length,
        total_licenses: totalLicenses,
        subscriptions: subscriptions.map((s) => ({
          name: s.name,
          product_type: s.productType,
          license_count: s.licenseCount,
          assigned_seats: s.assignedSeats,
          percentage_assigned: s.percentageAssigned,
          start_date: s.startDate,
          end_date: s.endDate,
          environment: s.environment,
        })),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to fetch subscriptions: ${error instanceof Error ? error.message : "Unknown error"}`,
        account_name: input.account_name,
      });
    }
  }

  // Main chat method
  async chat(message: string, context: ConversationContext): Promise<AgentResponse> {
    // Get or create conversation
    let conversation = await this.db.getConversation(context.conversationId);
    if (!conversation) {
      conversation = await this.db.createConversation({
        id: context.conversationId,
        user_id: context.userId,
        user_email: context.userEmail,
        channel: context.channel,
      });
    }

    // Save user message
    await this.db.saveMessage({
      conversation_id: context.conversationId,
      role: "user",
      content: message,
    });

    // Get conversation history for context
    const history = await this.db.getRecentMessages(context.conversationId, 20);

    // Build messages array for Claude
    const messages: Anthropic.MessageParam[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Make sure we have the current message
    if (messages.length === 0 || messages[messages.length - 1].content !== message) {
      messages.push({ role: "user", content: message });
    }

    const toolsUsed: string[] = [];

    // Call Claude with tool use loop (with retry on rate limit)
    const callClaude = async (msgs: Anthropic.MessageParam[]) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.anthropic.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: this.getSystemPrompt(context),
            tools: this.getTools() as Anthropic.Tool[],
            messages: msgs,
          });
        } catch (err: any) {
          const status = err?.status || err?.error?.status;
          if ((status === 429 || status === 529) && attempt < 2) {
            const delay = (attempt + 1) * 5000; // 5s, 10s
            console.warn(`Claude API rate limited (${status}), retrying in ${delay / 1000}s...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
      throw new Error("Claude API failed after retries");
    };

    let response = await callClaude(messages);

    // Handle tool use in a loop
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name);

        // Save tool use to conversation
        await this.db.saveMessage({
          conversation_id: context.conversationId,
          role: "tool_use",
          content: `Using tool: ${toolUse.name}`,
          tool_name: toolUse.name,
          tool_input: JSON.stringify(toolUse.input),
        });

        // Execute the tool
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, any>, context);

        // Save tool result
        await this.db.saveMessage({
          conversation_id: context.conversationId,
          role: "tool_result",
          content: `Tool result: ${toolUse.name}`,
          tool_name: toolUse.name,
          tool_result: result,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Continue the conversation with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await callClaude(messages);
    }

    // Extract final text response
    const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
    const finalResponse = textBlocks.map((b) => b.text).join("\n");

    // Save assistant response
    await this.db.saveMessage({
      conversation_id: context.conversationId,
      role: "assistant",
      content: finalResponse,
    });

    return {
      response: finalResponse,
      conversationId: context.conversationId,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  }

  // Get conversation history
  async getConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    const messages = await this.db.getMessages(conversationId);
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }

  // List user's conversations
  async getUserConversations(userEmail: string): Promise<Array<{ id: string; created_at: string; updated_at: string }>> {
    const conversations = await this.db.getConversationsByUser(userEmail);
    return conversations.map((c) => ({
      id: c.id,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
  }

  // Delete a conversation
  async deleteConversation(conversationId: string): Promise<void> {
    await this.db.deleteConversation(conversationId);
  }

  // Create a new conversation ID
  createConversationId(): string {
    return uuidv4();
  }
}
