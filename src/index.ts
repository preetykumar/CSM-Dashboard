#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

interface ZendeskConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

interface TicketField {
  id: number;
  type: string;
  title: string;
  description?: string;
  active: boolean;
  required_in_portal?: boolean;
  custom_field_options?: Array<{
    id: number;
    name: string;
    value: string;
  }>;
}

interface Organization {
  id: number;
  url: string;
  name: string;
  domain_names?: string[];
  details?: string;
  notes?: string;
  group_id?: number;
  shared_tickets?: boolean;
  shared_comments?: boolean;
  external_id?: string;
  tags?: string[];
  organization_fields?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface Ticket {
  id: number;
  url: string;
  external_id?: string;
  type?: string;
  subject?: string;
  description?: string;
  priority?: string;
  status: string;
  recipient?: string;
  requester_id: number;
  submitter_id: number;
  assignee_id?: number;
  organization_id?: number;
  group_id?: number;
  collaborator_ids?: number[];
  follower_ids?: number[];
  email_cc_ids?: number[];
  forum_topic_id?: number;
  problem_id?: number;
  has_incidents?: boolean;
  is_public?: boolean;
  due_at?: string;
  tags?: string[];
  custom_fields?: Array<{
    id: number;
    value: any;
  }>;
  satisfaction_rating?: any;
  sharing_agreement_ids?: number[];
  custom_status_id?: number;
  fields?: Array<{
    id: number;
    value: any;
  }>;
  followup_ids?: number[];
  ticket_form_id?: number;
  brand_id?: number;
  allow_channelback?: boolean;
  allow_attachments?: boolean;
  from_messaging_channel?: boolean;
  created_at: string;
  updated_at: string;
}

class ZendeskMCPServer {
  private server: Server;
  private axiosClient: AxiosInstance;
  private config: ZendeskConfig;
  private ticketFields: TicketField[] = [];

  constructor() {
    this.server = new Server(
      {
        name: "zendesk-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.config = this.loadConfig();
    this.axiosClient = this.createAxiosClient();
    this.setupHandlers();
  }

  private loadConfig(): ZendeskConfig {
    const subdomain = process.env.ZENDESK_SUBDOMAIN;
    const email = process.env.ZENDESK_EMAIL;
    const apiToken = process.env.ZENDESK_API_TOKEN;

    if (!subdomain || !email || !apiToken) {
      throw new Error(
        "Missing required environment variables: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN"
      );
    }

    return { subdomain, email, apiToken };
  }

  private createAxiosClient(): AxiosInstance {
    const baseURL = `https://${this.config.subdomain}.zendesk.com`;
    const auth = Buffer.from(`${this.config.email}/token:${this.config.apiToken}`).toString("base64");

    return axios.create({
      baseURL,
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });
  }

  private async loadTicketFields(): Promise<void> {
    try {
      const response = await this.axiosClient.get("/api/v2/ticket_fields.json");
      this.ticketFields = response.data.ticket_fields;
    } catch (error) {
      console.error("Failed to load ticket fields:", error);
      this.ticketFields = [];
    }
  }

  private buildSearchToolDefinition(): Tool {
    const properties: Record<string, any> = {
      query: {
        type: "string",
        description: "Search query using Zendesk search syntax. Examples: 'type:ticket status:open' for open tickets, 'requester:*@adp.com' for tickets from ADP users, 'created>2024-01-01 priority:high' for recent high-priority tickets, 'subject:\"login issues\"' for text search, or 'organization:\"ADP, Inc\" status:pending' for specific organization pending tickets. Supports wildcards (*), date ranges (>, <, :), and quoted text search.",
      },
    };

    for (const field of this.ticketFields) {
      if (field.active) {
        const fieldName = field.title.toLowerCase()
          .replace(/[^a-zA-Z0-9_.-]/g, "_")
          .replace(/_{2,}/g, "_")
          .replace(/^_|_$/g, "")
          .substring(0, 64);
        let fieldDescription = `Filter by ${field.title}`;
        
        if (field.description) {
          fieldDescription += `: ${field.description}`;
        }

        if (field.type === "dropdown" && field.custom_field_options) {
          const options = field.custom_field_options.map(opt => opt.name).join(", ");
          fieldDescription += ` (Options: ${options})`;
          properties[fieldName] = {
            type: "string",
            description: fieldDescription,
            enum: field.custom_field_options.map(opt => opt.value),
          };
        } else {
          properties[fieldName] = {
            type: "string",
            description: fieldDescription,
          };
        }
      }
    }

    properties["sort_by"] = {
      type: "string",
      description: "Sort Zendesk search results by specific field. Use 'updated_at' for most recently modified tickets, 'created_at' for newest/oldest tickets, 'priority' for priority-based ordering, 'status' for status-based grouping, or 'ticket_type' for type-based sorting.",
      enum: ["updated_at", "created_at", "priority", "status", "ticket_type"],
    };

    properties["sort_order"] = {
      type: "string",
      description: "Sort order for search results. Use 'desc' for descending order (newest/highest first) or 'asc' for ascending order (oldest/lowest first). Default is typically 'desc' for most recent results first.",
      enum: ["asc", "desc"],
    };

    return {
      name: "searchTickets",
      description: "Search for Zendesk tickets using powerful search API with dynamic field filtering and automatic pagination. Use this tool to find tickets based on criteria like status, assignee, requester, date ranges, or text content. Automatically discovers and supports all custom fields from your Zendesk instance. Returns up to 1000 ticket IDs with efficient pagination. Example usage: 'requester:*@adp.com' to find all tickets from ADP users, 'status:open priority:high' for urgent open tickets, or 'created>2024-01-01 subject:\"accessibility\"' for recent accessibility-related tickets. Supports Zendesk's full query syntax including wildcards, date ranges, and text search.",
      inputSchema: {
        type: "object",
        properties,
        required: ["query"],
      },
    };
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.loadTicketFields();

      return {
        tools: [
          {
            name: "getTicketByID",
            description: "Fetch a specific Zendesk ticket by its ID with complete details including custom fields, collaborators, timestamps, and all metadata. Use this tool when you need detailed information about a specific ticket, such as analyzing ticket content, checking status, reviewing custom field values, or understanding ticket relationships. Returns the full ticket object with all available information from Zendesk. Example usage: Retrieving ticket #12345 to analyze its description field for sentiment analysis, or checking the current status and assignee of a specific support request.",
            inputSchema: {
              type: "object",
              properties: {
                ticketId: {
                  type: "string",
                  description: "The numeric ID of the Zendesk ticket to fetch (e.g., '12345')",
                },
              },
              required: ["ticketId"],
            },
          },
          {
            name: "searchOrganizations",
            description: "Search for Zendesk organizations by name or fetch a specific organization by ID. Use this tool when you need to find organization details, verify organization names, or get organization IDs for further ticket filtering. When searching by ID, returns the complete organization object. When searching by name, returns an array of matching organizations with metadata. Example usage: Finding 'ADP, Inc' organization details to understand their account structure, or getting organization ID 123456 to analyze all tickets from that organization. Either organizationId OR organizationName must be provided, not both.",
            inputSchema: {
              type: "object",
              properties: {
                organizationId: {
                  type: "string",
                  description: "The numeric ID of the Zendesk organization to fetch (e.g., '123456'). Use when you know the specific organization ID.",
                },
                organizationName: {
                  type: "string",
                  description: "The exact or partial name of the organization to search for (e.g., 'ADP, Inc' or 'ADP'). Use when you need to find organizations by name.",
                },
              },
            },
          },
          this.buildSearchToolDefinition(),
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No arguments provided",
            },
          ],
        };
      }

      try {
        switch (name) {
          case "getTicketByID":
            return await this.getTicketByID(args.ticketId as string);

          case "searchOrganizations":
            return await this.searchOrganizations(args as { organizationId?: string; organizationName?: string });

          case "searchTickets":
            return await this.searchTickets(args as Record<string, any>);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private async getTicketByID(ticketId: string) {
    try {
      const response = await this.axiosClient.get(`/api/v2/tickets/${ticketId}.json`);
      const ticket: Ticket = response.data.ticket;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(ticket, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error(`Ticket with ID ${ticketId} not found`);
        }
        throw new Error(`API error: ${error.response?.status} - ${error.response?.statusText}`);
      }
      throw error;
    }
  }

  private async searchOrganizations(args: { organizationId?: string; organizationName?: string }) {
    try {
      const { organizationId, organizationName } = args;

      if (!organizationId && !organizationName) {
        throw new Error("Either organizationId or organizationName must be provided");
      }

      let response;

      if (organizationId) {
        // Fetch organization by ID
        response = await this.axiosClient.get(`/api/v2/organizations/${organizationId}.json`);
        const organization: Organization = response.data.organization;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(organization, null, 2),
            },
          ],
        };
      } else {
        // Search organizations by name
        const query = `type:organization name:"${organizationName}"`;
        response = await this.axiosClient.get("/api/v2/search.json", {
          params: { query }
        });

        const organizations = response.data.results.filter((result: any) => result.result_type === "organization");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: organizations.length,
                total_count: response.data.count,
                next_page: response.data.next_page,
                prev_page: response.data.previous_page,
                organizations: organizations,
              }, null, 2),
            },
          ],
        };
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          const identifier = args.organizationId ? `ID ${args.organizationId}` : `name "${args.organizationName}"`;
          throw new Error(`Organization with ${identifier} not found`);
        }
        throw new Error(`API error: ${error.response?.status} - ${error.response?.statusText}`);
      }
      throw error;
    }
  }

  private async searchTickets(args: Record<string, any>) {
    try {
      let query = args.query as string;
      const params: Record<string, string> = { query };

      if (args.sort_by) {
        params.sort_by = args.sort_by;
      }
      if (args.sort_order) {
        params.sort_order = args.sort_order;
      }

      for (const [key, value] of Object.entries(args)) {
        if (key !== "query" && key !== "sort_by" && key !== "sort_order" && value) {
          const field = this.ticketFields.find(f => 
            f.title.toLowerCase().replace(/\s+/g, "_") === key
          );
          if (field) {
            query += ` ${field.title}:"${value}"`;
          }
        }
      }

      params.query = query;

      // Collect all ticket IDs across all pages
      const allTicketIds: number[] = [];
      let nextPageUrl: string | null = null;
      let pageCount = 0;

      // Set per_page to maximum (100) for efficient pagination
      params.per_page = "100";

      do {
        const url: string = nextPageUrl || "/api/v2/search.json";
        const requestParams: Record<string, string> = nextPageUrl ? {} : params;

        const response = await this.axiosClient.get(url, { params: requestParams });
        const tickets = response.data.results.filter((result: any) => result.result_type === "ticket");
        
        // Extract only ticket IDs
        const ticketIds = tickets.map((ticket: any) => ticket.id);
        allTicketIds.push(...ticketIds);

        nextPageUrl = response.data.next_page;
        pageCount++;

        // Safety check: limit to 10 pages (1000 results max with per_page=100)
        if (pageCount >= 10) {
          break;
        }
      } while (nextPageUrl);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ticket_ids: allTicketIds,
              count: allTicketIds.length,
              pages_fetched: pageCount,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`API error: ${error.response?.status} - ${error.response?.statusText}`);
      }
      throw error;
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new ZendeskMCPServer();
server.run().catch(console.error);