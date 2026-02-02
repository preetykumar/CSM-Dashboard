import Anthropic from "@anthropic-ai/sdk";
import { DatabaseService, CachedTicket, CachedOrganization } from "./database.js";
import { ZendeskService } from "./zendesk.js";
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
  private db: DatabaseService;
  private zendesk: ZendeskService;
  private model: string;
  private maxTokens: number;

  constructor(
    db: DatabaseService,
    zendesk: ZendeskService,
    config: {
      apiKey: string;
      model?: string;
      maxTokens?: number;
    }
  ) {
    this.anthropic = new Anthropic({ apiKey: config.apiKey });
    this.db = db;
    this.zendesk = zendesk;
    this.model = config.model || "claude-sonnet-4-20250514";
    this.maxTokens = config.maxTokens || 4096;
  }

  // System prompt for the CSM Agent
  private getSystemPrompt(context: ConversationContext): string {
    return `You are a helpful AI assistant for Customer Success Managers (CSMs) at Deque Systems. You help CSMs manage their customer relationships by providing insights about support tickets, customer health, and development status.

You have access to tools that can query:
- Zendesk support tickets (bugs, feature requests, status, priority, etc.)
- Customer organization information
- CSM portfolio assignments
- GitHub development status for tickets

When answering questions:
- Be concise and actionable
- Focus on the most relevant information
- Highlight urgent items (escalations, high-priority tickets)
- Provide context about trends when useful
- Format data clearly using bullet points or tables when appropriate

The current user is: ${context.userEmail}
Channel: ${context.channel}

If the user asks about "my portfolio" or "my customers", use their email to look up their assigned organizations.`;
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
          return this.toolGetTicketsForOrganization(toolInput as any);

        case "get_escalated_tickets":
          return this.toolGetEscalatedTickets(toolInput as any);

        case "get_customer_summary":
          return this.toolGetCustomerSummary(toolInput as any);

        case "get_csm_portfolio":
          return this.toolGetCSMPortfolio(toolInput as any, context);

        case "search_tickets":
          return this.toolSearchTickets(toolInput as any);

        case "get_ticket_details":
          return this.toolGetTicketDetails(toolInput as any);

        case "get_github_status":
          return this.toolGetGitHubStatus(toolInput as any);

        case "get_organization_list":
          return this.toolGetOrganizationList(toolInput as any);

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
  private toolGetTicketsForOrganization(input: {
    organization_name: string;
    status?: string;
    priority?: string;
    ticket_type?: string;
    limit?: number;
  }): string {
    const limit = input.limit || 20;

    // Find organization by name (partial match)
    const orgs = this.db.getOrganizations();
    const org = orgs.find((o) => o.name.toLowerCase().includes(input.organization_name.toLowerCase()));

    if (!org) {
      return JSON.stringify({
        error: `Organization not found: ${input.organization_name}`,
        suggestion: "Try using get_organization_list to find the correct name",
      });
    }

    let tickets = this.db.getTicketsByOrganization(org.id);

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

  private toolGetEscalatedTickets(input: { organization_name?: string; include_resolved?: boolean }): string {
    const orgs = this.db.getOrganizations();
    let targetOrgs = orgs;

    if (input.organization_name) {
      targetOrgs = orgs.filter((o) => o.name.toLowerCase().includes(input.organization_name!.toLowerCase()));
      if (targetOrgs.length === 0) {
        return JSON.stringify({ error: `Organization not found: ${input.organization_name}` });
      }
    }

    const escalatedTickets: Array<CachedTicket & { organization_name: string }> = [];

    for (const org of targetOrgs) {
      const tickets = this.db.getTicketsByOrganization(org.id);
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

  private toolGetCustomerSummary(input: { organization_name: string }): string {
    const orgs = this.db.getOrganizations();
    const org = orgs.find((o) => o.name.toLowerCase().includes(input.organization_name.toLowerCase()));

    if (!org) {
      return JSON.stringify({ error: `Organization not found: ${input.organization_name}` });
    }

    const tickets = this.db.getTicketsByOrganization(org.id);
    const stats = this.db.getTicketStats(org.id);
    const priorityBreakdown = this.db.getPriorityBreakdown(org.id);
    const escalationCount = this.db.getEscalationCount(org.id);

    // Calculate additional metrics
    const openTickets = tickets.filter((t) => !["solved", "closed"].includes(t.status));
    const bugs = tickets.filter((t) => t.ticket_type === "bug");
    const features = tickets.filter((t) => t.ticket_type === "feature");
    const openBugs = bugs.filter((t) => !["solved", "closed"].includes(t.status));
    const openFeatures = features.filter((t) => !["solved", "closed"].includes(t.status));

    // Get CSM assignment
    const csmAssignment = this.db.getCSMAssignmentByOrgId(org.id);

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

  private toolGetCSMPortfolio(input: { csm_email?: string }, context: ConversationContext): string {
    const email = input.csm_email || context.userEmail;
    const portfolio = this.db.getCSMPortfolioByEmail(email);

    if (!portfolio) {
      return JSON.stringify({
        error: `No portfolio found for ${email}`,
        suggestion: "This user may not have CSM assignments in Salesforce",
      });
    }

    // Get summary for each organization
    const customerSummaries = portfolio.org_ids.map((orgId) => {
      const org = this.db.getOrganization(orgId);
      if (!org) return null;

      const stats = this.db.getTicketStats(orgId);
      const escalations = this.db.getEscalationCount(orgId);

      return {
        id: orgId,
        name: org.name,
        open_tickets: stats.new + stats.open + stats.pending + stats.hold,
        escalations,
        high_priority: this.db.getTicketsByPriority(orgId, "high").filter((t) => !["solved", "closed"].includes(t.status))
          .length,
        urgent: this.db.getTicketsByPriority(orgId, "urgent").filter((t) => !["solved", "closed"].includes(t.status))
          .length,
      };
    }).filter(Boolean);

    return JSON.stringify({
      csm: {
        name: portfolio.csm_name,
        email: portfolio.csm_email,
      },
      total_customers: customerSummaries.length,
      customers: customerSummaries,
      totals: {
        open_tickets: customerSummaries.reduce((sum, c) => sum + (c?.open_tickets || 0), 0),
        escalations: customerSummaries.reduce((sum, c) => sum + (c?.escalations || 0), 0),
        high_priority: customerSummaries.reduce((sum, c) => sum + (c?.high_priority || 0), 0),
        urgent: customerSummaries.reduce((sum, c) => sum + (c?.urgent || 0), 0),
      },
    });
  }

  private toolSearchTickets(input: { query: string; status?: string; limit?: number }): string {
    const limit = input.limit || 20;
    const query = input.query.toLowerCase();

    // Get all organizations and their tickets
    const orgs = this.db.getOrganizations();
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    const matchingTickets: Array<CachedTicket & { organization_name: string }> = [];

    for (const org of orgs) {
      let tickets = this.db.getTicketsByOrganization(org.id);

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

  private toolGetTicketDetails(input: { ticket_id: number }): string {
    // Find ticket across all organizations
    const orgs = this.db.getOrganizations();

    for (const org of orgs) {
      const tickets = this.db.getTicketsByOrganization(org.id);
      const ticket = tickets.find((t) => t.id === input.ticket_id);

      if (ticket) {
        // Get GitHub links
        const githubLinks = this.db.getGitHubLinksByTicketId(ticket.id);

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

  private toolGetGitHubStatus(input: { ticket_id: number }): string {
    const links = this.db.getGitHubLinksByTicketId(input.ticket_id);

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

  private toolGetOrganizationList(input: { search?: string; limit?: number }): string {
    const limit = input.limit || 50;
    let orgs = this.db.getOrganizations();

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

  // Main chat method
  async chat(message: string, context: ConversationContext): Promise<AgentResponse> {
    // Get or create conversation
    let conversation = this.db.getConversation(context.conversationId);
    if (!conversation) {
      conversation = this.db.createConversation({
        id: context.conversationId,
        user_id: context.userId,
        user_email: context.userEmail,
        channel: context.channel,
      });
    }

    // Save user message
    this.db.saveMessage({
      conversation_id: context.conversationId,
      role: "user",
      content: message,
    });

    // Get conversation history for context
    const history = this.db.getRecentMessages(context.conversationId, 20);

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

    // Call Claude with tool use loop
    let response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.getSystemPrompt(context),
      tools: this.getTools() as Anthropic.Tool[],
      messages,
    });

    // Handle tool use in a loop
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name);

        // Save tool use to conversation
        this.db.saveMessage({
          conversation_id: context.conversationId,
          role: "tool_use",
          content: `Using tool: ${toolUse.name}`,
          tool_name: toolUse.name,
          tool_input: JSON.stringify(toolUse.input),
        });

        // Execute the tool
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, any>, context);

        // Save tool result
        this.db.saveMessage({
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

      response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.getSystemPrompt(context),
        tools: this.getTools() as Anthropic.Tool[],
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
    const finalResponse = textBlocks.map((b) => b.text).join("\n");

    // Save assistant response
    this.db.saveMessage({
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
  getConversationHistory(conversationId: string): ChatMessage[] {
    const messages = this.db.getMessages(conversationId);
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }

  // List user's conversations
  getUserConversations(userEmail: string): Array<{ id: string; created_at: string; updated_at: string }> {
    const conversations = this.db.getConversationsByUser(userEmail);
    return conversations.map((c) => ({
      id: c.id,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
  }

  // Delete a conversation
  deleteConversation(conversationId: string): void {
    this.db.deleteConversation(conversationId);
  }

  // Create a new conversation ID
  createConversationId(): string {
    return uuidv4();
  }
}
