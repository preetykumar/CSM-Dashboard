import axios, { AxiosInstance, AxiosError } from "axios";
import type {
  ZendeskConfig,
  Ticket,
  Organization,
  User,
  CustomerSummary,
  TicketField,
  DetailedCustomerSummary,
  ProductStats,
  ExtendedFieldMapping,
  CSMPortfolio,
  CSMCustomerSummary,
  VelocitySnapshot,
  ModuleSummary,
  ProductBacklog,
  EnhancedCustomerSummary,
  QuarterlySummary,
} from "../types/index.js";
import type { CSMAssignment } from "./salesforce.js";

// Helper to delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ZendeskService {
  private client: AxiosInstance;
  private config: ZendeskConfig;
  private ticketFields: TicketField[] = [];
  private fieldMapping: ExtendedFieldMapping = {};
  private requestDelay = 100; // ms between requests

  constructor(config: ZendeskConfig) {
    this.config = config;
    const auth = Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64");

    this.client = axios.create({
      baseURL: `https://${config.subdomain}.zendesk.com`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });
  }

  // Rate-limited API call with retry logic
  private async apiCall<T>(
    method: "get" | "post",
    url: string,
    options?: { params?: Record<string, any>; data?: any }
  ): Promise<T> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await delay(this.requestDelay);
        const response =
          method === "get"
            ? await this.client.get(url, { params: options?.params })
            : await this.client.post(url, options?.data);
        return response.data;
      } catch (error) {
        lastError = error as Error;
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 429) {
          // Rate limited - wait and retry
          const retryAfter = parseInt(
            axiosError.response.headers["retry-after"] as string || "15",
            10
          );
          console.log(`Rate limited. Waiting ${retryAfter} seconds before retry...`);
          await delay(retryAfter * 1000);
        } else if (axiosError.response?.status && axiosError.response.status >= 500) {
          // Server error - wait and retry
          await delay(2000 * (attempt + 1));
        } else {
          // Other error - don't retry
          throw error;
        }
      }
    }

    throw lastError;
  }

  async getTicketFields(): Promise<TicketField[]> {
    if (this.ticketFields.length > 0) {
      return this.ticketFields;
    }

    const data = await this.apiCall<{ ticket_fields: TicketField[] }>(
      "get",
      "/api/v2/ticket_fields.json"
    );
    this.ticketFields = data.ticket_fields;

    // Auto-detect product and request type fields
    this.detectFieldMapping();

    return this.ticketFields;
  }

  private detectFieldMapping(): void {
    for (const field of this.ticketFields) {
      const titleLower = field.title.toLowerCase();

      // Detect product field
      if (
        titleLower.includes("product") ||
        titleLower.includes("application") ||
        titleLower.includes("software")
      ) {
        if (!this.fieldMapping.productFieldId) {
          this.fieldMapping.productFieldId = field.id;
          this.fieldMapping.productFieldName = field.title;
          console.log(`Detected product field: ${field.title} (ID: ${field.id})`);
        }
      }

      // Detect module/component field
      if (
        titleLower.includes("module") ||
        titleLower.includes("component") ||
        titleLower.includes("area")
      ) {
        if (!this.fieldMapping.moduleFieldId) {
          this.fieldMapping.moduleFieldId = field.id;
          this.fieldMapping.moduleFieldName = field.title;
          console.log(`Detected module field: ${field.title} (ID: ${field.id})`);
        }
      }

      // Detect ticket type field (bug vs feature)
      if (
        titleLower.includes("ticket type") ||
        titleLower.includes("issue type") ||
        titleLower.includes("request type") ||
        titleLower === "type"
      ) {
        if (!this.fieldMapping.ticketTypeFieldId) {
          this.fieldMapping.ticketTypeFieldId = field.id;
          this.fieldMapping.ticketTypeFieldName = field.title;
          console.log(`Detected ticket type field: ${field.title} (ID: ${field.id})`);
        }
      }

      // Detect workflow status field
      if (
        titleLower.includes("workflow") ||
        titleLower.includes("stage") ||
        titleLower.includes("progress") ||
        titleLower.includes("dev status")
      ) {
        if (!this.fieldMapping.workflowStatusFieldId) {
          this.fieldMapping.workflowStatusFieldId = field.id;
          this.fieldMapping.workflowStatusFieldName = field.title;
          console.log(`Detected workflow status field: ${field.title} (ID: ${field.id})`);
        }
      }

      // Detect issue subtype field
      if (
        titleLower.includes("issue subtype") ||
        titleLower.includes("sub-type") ||
        titleLower.includes("subtype") ||
        titleLower.includes("subcategory") ||
        titleLower.includes("sub-category")
      ) {
        if (!this.fieldMapping.issueSubtypeFieldId) {
          this.fieldMapping.issueSubtypeFieldId = field.id;
          this.fieldMapping.issueSubtypeFieldName = field.title;
          console.log(`Detected issue subtype field: ${field.title} (ID: ${field.id})`);
        }
      }

      // Legacy: Detect request type field (for backward compatibility)
      if (
        titleLower.includes("request type") ||
        titleLower.includes("ticket type") ||
        titleLower.includes("issue type") ||
        titleLower.includes("category")
      ) {
        if (!this.fieldMapping.requestTypeFieldId) {
          this.fieldMapping.requestTypeFieldId = field.id;
          this.fieldMapping.requestTypeFieldName = field.title;
        }
      }
    }
  }

  getFieldMapping(): ExtendedFieldMapping {
    return this.fieldMapping;
  }

  setFieldMapping(mapping: Partial<ExtendedFieldMapping>): void {
    this.fieldMapping = { ...this.fieldMapping, ...mapping };
  }

  // Public method to extract all custom field values for a ticket (used by sync service)
  extractTicketCustomFields(ticket: Ticket): {
    product: string;
    module: string;
    ticketType: "bug" | "feature" | "other";
    workflowStatus: string;
    issueSubtype: string;
    isEscalated: boolean;
  } {
    return {
      product: this.getProductName(ticket),
      module: this.getModuleName(ticket),
      ticketType: this.getTicketType(ticket),
      workflowStatus: this.getWorkflowStatus(ticket),
      issueSubtype: this.getIssueSubtype(ticket),
      isEscalated: this.checkEscalation(ticket),
    };
  }

  // Extract issue subtype from ticket custom fields
  private getIssueSubtype(ticket: Ticket): string {
    const { issueSubtypeFieldId } = this.fieldMapping;
    if (issueSubtypeFieldId) {
      const value = this.getCustomFieldValue(ticket, issueSubtypeFieldId);
      if (value) return String(value);
    }
    // Fallback: use module as issue subtype if no specific field
    return this.getModuleName(ticket);
  }

  // Check if ticket is escalated (via tags or priority)
  private checkEscalation(ticket: Ticket): boolean {
    // Check tags for escalation indicators
    if (ticket.tags) {
      const escalationTags = ["escalated", "escalation", "exec_escalation", "management_escalation", "urgent_escalation"];
      const hasEscalationTag = ticket.tags.some((tag: string) =>
        escalationTags.some((et) => tag.toLowerCase().includes(et))
      );
      if (hasEscalationTag) return true;
    }
    return false;
  }

  // Extract module name from ticket custom fields
  private getModuleName(ticket: Ticket): string {
    const { moduleFieldId } = this.fieldMapping;
    if (moduleFieldId) {
      const value = this.getCustomFieldValue(ticket, moduleFieldId);
      if (value) return String(value);
    }
    return "General";
  }

  // Extract ticket type (bug or feature) from custom fields
  private getTicketType(ticket: Ticket): "bug" | "feature" | "other" {
    const { ticketTypeFieldId } = this.fieldMapping;
    if (ticketTypeFieldId) {
      const value = this.getCustomFieldValue(ticket, ticketTypeFieldId);
      if (value) {
        const valueLower = String(value).toLowerCase();
        if (valueLower.includes("bug") || valueLower.includes("defect") || valueLower.includes("issue")) {
          return "bug";
        }
        if (valueLower.includes("feature") || valueLower.includes("enhancement") || valueLower.includes("request")) {
          return "feature";
        }
      }
    }
    // Fallback to classifyRequestType
    const type = this.classifyRequestType(ticket);
    if (type === "problemReport") return "bug";
    if (type === "featureRequest") return "feature";
    return "other";
  }

  // Extract workflow status from custom fields
  private getWorkflowStatus(ticket: Ticket): string {
    const { workflowStatusFieldId } = this.fieldMapping;
    if (workflowStatusFieldId) {
      const value = this.getCustomFieldValue(ticket, workflowStatusFieldId);
      if (value) return String(value);
    }
    // Fallback to Zendesk status mapping
    switch (ticket.status) {
      case "new": return "New";
      case "open": return "In Progress";
      case "pending": return "Waiting";
      case "hold": return "Backlogged";
      case "solved": return "Resolved";
      case "closed": return "Closed";
      default: return "Unknown";
    }
  }

  // Calculate velocity snapshot for an organization's tickets
  calculateVelocitySnapshot(tickets: Ticket[]): VelocitySnapshot {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Filter tickets solved/closed this month
    const closedThisMonth = tickets.filter((t) => {
      if (t.status !== "solved" && t.status !== "closed") return false;
      const updatedAt = new Date(t.updated_at);
      return updatedAt >= monthStart;
    });

    let bugsFixed = 0;
    let featuresCompleted = 0;

    for (const ticket of closedThisMonth) {
      const type = this.getTicketType(ticket);
      if (type === "bug") bugsFixed++;
      else if (type === "feature") featuresCompleted++;
    }

    return {
      closedThisMonth: closedThisMonth.length,
      bugsFixed,
      featuresCompleted,
      period: monthName,
    };
  }

  // Calculate quarterly summaries (current and previous quarter)
  calculateQuarterlySummaries(tickets: Ticket[]): {
    currentQuarter: QuarterlySummary;
    previousQuarter: QuarterlySummary;
  } {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Determine current quarter
    const currentQuarterNum = Math.floor(currentMonth / 3) + 1;
    const currentQuarterStart = new Date(currentYear, (currentQuarterNum - 1) * 3, 1);
    const currentQuarterEnd = new Date(currentYear, currentQuarterNum * 3, 0, 23, 59, 59);

    // Determine previous quarter
    let prevQuarterNum = currentQuarterNum - 1;
    let prevQuarterYear = currentYear;
    if (prevQuarterNum === 0) {
      prevQuarterNum = 4;
      prevQuarterYear = currentYear - 1;
    }
    const prevQuarterStart = new Date(prevQuarterYear, (prevQuarterNum - 1) * 3, 1);
    const prevQuarterEnd = new Date(prevQuarterYear, prevQuarterNum * 3, 0, 23, 59, 59);

    // Format quarter labels
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formatQuarterPeriod = (startMonth: number, year: number) => {
      const endMonth = startMonth + 2;
      return `${monthNames[startMonth]} - ${monthNames[endMonth]} ${year}`;
    };

    const currentQuarter = this.calculateQuarterStats(
      tickets,
      currentQuarterStart,
      currentQuarterEnd,
      `Q${currentQuarterNum} ${currentYear}`,
      formatQuarterPeriod((currentQuarterNum - 1) * 3, currentYear)
    );

    const previousQuarter = this.calculateQuarterStats(
      tickets,
      prevQuarterStart,
      prevQuarterEnd,
      `Q${prevQuarterNum} ${prevQuarterYear}`,
      formatQuarterPeriod((prevQuarterNum - 1) * 3, prevQuarterYear)
    );

    return { currentQuarter, previousQuarter };
  }

  // Helper: Calculate stats for a specific quarter
  private calculateQuarterStats(
    tickets: Ticket[],
    startDate: Date,
    endDate: Date,
    quarter: string,
    period: string
  ): QuarterlySummary {
    const closedTickets = tickets.filter((t) => {
      if (t.status !== "solved" && t.status !== "closed") return false;
      const updatedAt = new Date(t.updated_at);
      return updatedAt >= startDate && updatedAt <= endDate;
    });

    let bugsFixed = 0;
    let featuresCompleted = 0;
    let otherClosed = 0;

    for (const ticket of closedTickets) {
      const type = this.getTicketType(ticket);
      if (type === "bug") bugsFixed++;
      else if (type === "feature") featuresCompleted++;
      else otherClosed++;
    }

    return {
      quarter,
      period,
      totalClosed: closedTickets.length,
      bugsFixed,
      featuresCompleted,
      otherClosed,
    };
  }

  // Build product backlog grouped by product and module
  buildProductBacklog(tickets: Ticket[]): ProductBacklog[] {
    // Filter to open/active tickets only
    const openTickets = tickets.filter((t) =>
      ["new", "open", "pending", "hold"].includes(t.status)
    );

    // Group by Product -> Module
    const productMap = new Map<string, Map<string, Ticket[]>>();

    for (const ticket of openTickets) {
      const product = this.getProductName(ticket);
      const module = this.getModuleName(ticket);

      if (!productMap.has(product)) {
        productMap.set(product, new Map());
      }
      const moduleMap = productMap.get(product)!;

      if (!moduleMap.has(module)) {
        moduleMap.set(module, []);
      }
      moduleMap.get(module)!.push(ticket);
    }

    // Build ProductBacklog array
    const backlog: ProductBacklog[] = [];

    for (const [productName, moduleMap] of productMap) {
      const modules: ModuleSummary[] = [];
      let totalOpenTickets = 0;

      for (const [moduleName, moduleTickets] of moduleMap) {
        totalOpenTickets += moduleTickets.length;

        // Calculate status - most common workflow status
        const statusCounts = new Map<string, number>();
        for (const t of moduleTickets) {
          const status = this.getWorkflowStatus(t);
          statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
        }
        let mostCommonStatus = "Unknown";
        let maxCount = 0;
        for (const [status, count] of statusCounts) {
          if (count > maxCount) {
            maxCount = count;
            mostCommonStatus = status;
          }
        }

        // Calculate feature progress (completed / total)
        const features = moduleTickets.filter((t) => this.getTicketType(t) === "feature");
        const completedFeatures = features.filter((t) => t.status === "solved" || t.status === "closed").length;

        // Calculate bug statistics
        const bugs = moduleTickets.filter((t) => this.getTicketType(t) === "bug");
        const openBugs = bugs.filter((t) => t.status !== "solved" && t.status !== "closed");
        const fixedBugs = bugs.filter((t) => t.status === "solved" || t.status === "closed");
        const blockers = openBugs.filter((t) =>
          t.tags?.some((tag) => tag.toLowerCase().includes("blocker")) ||
          t.priority === "urgent"
        ).length;

        modules.push({
          moduleName,
          status: mostCommonStatus,
          features: {
            completed: completedFeatures,
            total: features.length,
            tickets: features,
          },
          bugs: {
            total: bugs.length,
            open: openBugs.length,
            fixed: fixedBugs.length,
            blockers,
            tickets: bugs,
          },
          tickets: moduleTickets.sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          ),
        });
      }

      // Sort modules by ticket count
      modules.sort((a, b) => b.tickets.length - a.tickets.length);

      backlog.push({
        productName,
        modules,
        totalOpenTickets,
      });
    }

    // Sort products by total open tickets
    backlog.sort((a, b) => b.totalOpenTickets - a.totalOpenTickets);

    return backlog;
  }

  // Get enhanced customer summary with velocity and product backlog
  async getEnhancedCustomerSummary(orgId: number): Promise<EnhancedCustomerSummary> {
    await this.getTicketFields();

    const [organization, tickets] = await Promise.all([
      this.getOrganization(orgId),
      this.getTicketsByOrganization(orgId),
    ]);

    const velocity = this.calculateVelocitySnapshot(tickets);
    const { currentQuarter, previousQuarter } = this.calculateQuarterlySummaries(tickets);
    const backlog = this.buildProductBacklog(tickets);

    return {
      organization,
      velocity,
      currentQuarter,
      previousQuarter,
      backlog,
    };
  }

  async getTicket(ticketId: number): Promise<Ticket> {
    const data = await this.apiCall<{ ticket: Ticket }>("get", `/api/v2/tickets/${ticketId}.json`);
    return data.ticket;
  }

  async getTickets(page = 1, perPage = 100): Promise<{ tickets: Ticket[]; hasMore: boolean }> {
    const data = await this.apiCall<{ tickets: Ticket[]; next_page: string | null }>(
      "get",
      "/api/v2/tickets.json",
      { params: { page, per_page: perPage } }
    );
    return {
      tickets: data.tickets,
      hasMore: !!data.next_page,
    };
  }

  async searchTickets(query: string, maxPages = 10): Promise<Ticket[]> {
    const allTickets: Ticket[] = [];
    let nextPageUrl: string | null = null;
    let pageCount = 0;

    do {
      try {
        const url: string = nextPageUrl || "/api/v2/search.json";
        const params: Record<string, any> = nextPageUrl ? {} : { query, per_page: 100, sort_by: "updated_at", sort_order: "desc" };

        const data = await this.apiCall<{
          results: Ticket[];
          next_page: string | null;
        }>("get", url, { params });

        const tickets = data.results.filter((result: any) => result.result_type === "ticket");
        allTickets.push(...tickets);

        nextPageUrl = data.next_page;
        pageCount++;

        if (pageCount >= maxPages) break;
      } catch (error) {
        const axiosError = error as AxiosError;
        // Handle Zendesk search limits - return what we have
        if (axiosError.response?.status === 422) {
          console.log(`Search hit Zendesk limits at page ${pageCount}. Returning ${allTickets.length} tickets.`);
          break;
        }
        throw error;
      }
    } while (nextPageUrl);

    return allTickets;
  }

  async getOrganization(orgId: number): Promise<Organization> {
    const data = await this.apiCall<{ organization: Organization }>(
      "get",
      `/api/v2/organizations/${orgId}.json`
    );
    return data.organization;
  }

  async getOrganizations(): Promise<Organization[]> {
    const allOrgs: Organization[] = [];
    let page = 1;

    console.log("Fetching all Zendesk organizations...");

    while (true) {
      const data = await this.apiCall<{ organizations: Organization[]; next_page: string | null }>(
        "get",
        "/api/v2/organizations.json",
        { params: { page, per_page: 100 } }
      );
      allOrgs.push(...data.organizations);

      if (page % 5 === 0) {
        console.log(`  Fetched ${allOrgs.length} organizations (page ${page})...`);
      }

      if (!data.next_page) break;
      page++;
    }

    console.log(`Fetched ${allOrgs.length} total organizations`);
    return allOrgs;
  }

  async getUser(userId: number): Promise<User> {
    const data = await this.apiCall<{ user: User }>("get", `/api/v2/users/${userId}.json`);
    return data.user;
  }

  async getTicketsByOrganization(orgId: number): Promise<Ticket[]> {
    return this.searchTickets(`type:ticket organization_id:${orgId}`);
  }

  async getTicketsByOrganizationAndStatus(orgId: number, status: string): Promise<Ticket[]> {
    return this.searchTickets(`type:ticket organization_id:${orgId} status:${status}`);
  }

  // Incremental Export API - fetches ALL tickets since a given timestamp
  // Much faster than per-org searches for full/delta syncs
  // Returns tickets and the end_time for the next incremental sync
  async getTicketsIncremental(
    startTime?: number, // Unix timestamp (seconds)
    onProgress?: (count: number, endTime: number) => void
  ): Promise<{ tickets: Ticket[]; endTime: number }> {
    const allTickets: Ticket[] = [];

    // Default to 30 days ago if no start time (for initial sync, gets recent tickets)
    // For full initial sync, use startTime = 0 or a very old timestamp
    const effectiveStartTime = startTime ?? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    console.log(`Starting incremental ticket export from ${new Date(effectiveStartTime * 1000).toISOString()}...`);

    let url = `/api/v2/incremental/tickets.json?start_time=${effectiveStartTime}`;
    let endTime = effectiveStartTime;
    let pageCount = 0;

    while (url) {
      try {
        console.log(`  Fetching page ${pageCount + 1}...`);
        const data = await this.apiCall<{
          tickets: Ticket[];
          next_page: string | null;
          end_time: number;
          count: number;
        }>("get", url);

        console.log(`  Got ${data.tickets.length} tickets from API`);
        allTickets.push(...data.tickets);
        endTime = data.end_time;
        pageCount++;

        if (pageCount % 5 === 0 || !data.next_page) {
          console.log(`  Incremental export: ${allTickets.length} tickets (page ${pageCount})...`);
          if (onProgress) {
            onProgress(allTickets.length, endTime);
          }
        }

        // Zendesk returns next_page as full URL, need to extract the path
        if (data.next_page) {
          const nextUrl = new URL(data.next_page);
          url = nextUrl.pathname + nextUrl.search;
        } else {
          url = "";
        }

        // Safety: break if we're getting empty pages (shouldn't happen but prevents infinite loops)
        if (data.tickets.length === 0 && !data.next_page) {
          break;
        }
      } catch (error) {
        console.error(`Incremental export error at page ${pageCount}:`, error);
        throw error;
      }
    }

    console.log(`Incremental export complete: ${allTickets.length} tickets, endTime: ${new Date(endTime * 1000).toISOString()}`);

    return { tickets: allTickets, endTime };
  }

  // Parallel fetch for multiple organizations (with concurrency limit)
  async getTicketsForOrganizationsParallel(
    orgIds: number[],
    concurrency = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<number, Ticket[]>> {
    const results = new Map<number, Ticket[]>();
    let completed = 0;

    // Process in batches with concurrency limit
    for (let i = 0; i < orgIds.length; i += concurrency) {
      const batch = orgIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (orgId) => {
          try {
            const tickets = await this.getTicketsByOrganization(orgId);
            return { orgId, tickets };
          } catch (error) {
            console.error(`Failed to fetch tickets for org ${orgId}:`, error);
            return { orgId, tickets: [] };
          }
        })
      );

      for (const { orgId, tickets } of batchResults) {
        results.set(orgId, tickets);
        completed++;
      }

      if (onProgress) {
        onProgress(completed, orgIds.length);
      }

      console.log(`  Parallel fetch: ${completed}/${orgIds.length} organizations...`);
    }

    return results;
  }

  async getTicketsByOrganizationAndPriority(orgId: number, priority: string): Promise<Ticket[]> {
    return this.searchTickets(`type:ticket organization_id:${orgId} priority:${priority}`);
  }

  private getCustomFieldValue(ticket: Ticket, fieldId: number): any {
    const field = ticket.custom_fields?.find((f) => f.id === fieldId);
    return field?.value ?? null;
  }

  private classifyRequestType(ticket: Ticket): "featureRequest" | "problemReport" | "other" {
    const { requestTypeFieldId } = this.fieldMapping;

    if (requestTypeFieldId) {
      const value = this.getCustomFieldValue(ticket, requestTypeFieldId);
      if (value) {
        const valueLower = String(value).toLowerCase();
        if (
          valueLower.includes("feature") ||
          valueLower.includes("enhancement") ||
          valueLower.includes("request")
        ) {
          return "featureRequest";
        }
        if (
          valueLower.includes("problem") ||
          valueLower.includes("bug") ||
          valueLower.includes("issue") ||
          valueLower.includes("error")
        ) {
          return "problemReport";
        }
      }
    }

    // Fallback: check tags and subject
    const tags = ticket.tags?.map((t) => t.toLowerCase()) || [];
    const subject = (ticket.subject || "").toLowerCase();

    if (
      tags.some((t) => t.includes("feature") || t.includes("enhancement")) ||
      subject.includes("feature request") ||
      subject.includes("enhancement")
    ) {
      return "featureRequest";
    }

    if (
      tags.some((t) => t.includes("bug") || t.includes("problem") || t.includes("issue")) ||
      subject.includes("bug") ||
      subject.includes("problem") ||
      subject.includes("error")
    ) {
      return "problemReport";
    }

    return "other";
  }

  private getProductName(ticket: Ticket): string {
    const { productFieldId } = this.fieldMapping;

    if (productFieldId) {
      const value = this.getCustomFieldValue(ticket, productFieldId);
      if (value) {
        return String(value);
      }
    }

    // Fallback: check tags for product names
    const productTags = ticket.tags?.filter(
      (t) =>
        !["open", "pending", "solved", "closed", "high", "low", "normal", "urgent"].includes(
          t.toLowerCase()
        )
    );
    if (productTags && productTags.length > 0) {
      return productTags[0];
    }

    return "Unknown Product";
  }

  async getCustomerSummary(orgId: number): Promise<CustomerSummary> {
    const [organization, tickets] = await Promise.all([
      this.getOrganization(orgId),
      this.getTicketsByOrganization(orgId),
    ]);

    const ticketStats = {
      total: tickets.length,
      new: tickets.filter((t) => t.status === "new").length,
      open: tickets.filter((t) => t.status === "open").length,
      pending: tickets.filter((t) => t.status === "pending").length,
      hold: tickets.filter((t) => t.status === "hold").length,
      solved: tickets.filter((t) => t.status === "solved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
    };

    const priorityBreakdown = {
      low: tickets.filter((t) => t.priority === "low").length,
      normal: tickets.filter((t) => t.priority === "normal").length,
      high: tickets.filter((t) => t.priority === "high").length,
      urgent: tickets.filter((t) => t.priority === "urgent").length,
    };

    const recentTickets = tickets
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 10);

    // Get escalated tickets (only open/active tickets)
    const escalatedTickets = tickets.filter(
      (t) => t.is_escalated && !["solved", "closed"].includes(t.status)
    );
    const escalations = escalatedTickets.length;

    // Get critical tickets (urgent + high priority, only open/active tickets)
    const criticalTickets = tickets.filter(
      (t) => (t.priority === "urgent" || t.priority === "high") && !["solved", "closed"].includes(t.status)
    );
    const criticalDefects = criticalTickets.length;

    return {
      organization,
      ticketStats,
      priorityBreakdown,
      escalations,
      escalatedTickets,
      criticalDefects,
      criticalTickets,
      recentTickets,
    };
  }

  async getDetailedCustomerSummary(orgId: number): Promise<DetailedCustomerSummary> {
    // Ensure fields are loaded
    await this.getTicketFields();

    const [organization, tickets] = await Promise.all([
      this.getOrganization(orgId),
      this.getTicketsByOrganization(orgId),
    ]);

    const ticketStats = {
      total: tickets.length,
      new: tickets.filter((t) => t.status === "new").length,
      open: tickets.filter((t) => t.status === "open").length,
      pending: tickets.filter((t) => t.status === "pending").length,
      hold: tickets.filter((t) => t.status === "hold").length,
      solved: tickets.filter((t) => t.status === "solved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
    };

    const priorityBreakdown = {
      low: tickets.filter((t) => t.priority === "low").length,
      normal: tickets.filter((t) => t.priority === "normal").length,
      high: tickets.filter((t) => t.priority === "high").length,
      urgent: tickets.filter((t) => t.priority === "urgent").length,
    };

    const recentTickets = tickets
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 10);

    // Get escalated tickets (only open/active tickets)
    const escalatedTickets = tickets.filter(
      (t) => t.is_escalated && !["solved", "closed"].includes(t.status)
    );
    const escalations = escalatedTickets.length;

    // Get critical tickets (urgent + high priority, only open/active tickets)
    const criticalTickets = tickets.filter(
      (t) => (t.priority === "urgent" || t.priority === "high") && !["solved", "closed"].includes(t.status)
    );
    const criticalDefects = criticalTickets.length;

    // Build product breakdown
    const productMap = new Map<string, ProductStats>();

    let featureRequests = 0;
    let problemReports = 0;
    let other = 0;

    for (const ticket of tickets) {
      const product = this.getProductName(ticket);
      const requestType = this.classifyRequestType(ticket);

      if (!productMap.has(product)) {
        productMap.set(product, {
          product,
          total: 0,
          featureRequests: 0,
          problemReports: 0,
          other: 0,
          openTickets: 0,
          tickets: [],
        });
      }

      const stats = productMap.get(product)!;
      stats.total++;
      stats.tickets.push(ticket);

      if (ticket.status === "open" || ticket.status === "pending") {
        stats.openTickets++;
      }

      if (requestType === "featureRequest") {
        stats.featureRequests++;
        featureRequests++;
      } else if (requestType === "problemReport") {
        stats.problemReports++;
        problemReports++;
      } else {
        stats.other++;
        other++;
      }
    }

    const productBreakdown = Array.from(productMap.values()).sort((a, b) => b.total - a.total);

    return {
      organization,
      ticketStats,
      priorityBreakdown,
      escalations,
      escalatedTickets,
      criticalDefects,
      criticalTickets,
      recentTickets,
      productBreakdown,
      requestTypeBreakdown: {
        featureRequests,
        problemReports,
        other,
      },
    };
  }

  async getAllCustomerSummaries(): Promise<CustomerSummary[]> {
    const organizations = await this.getOrganizations();
    const summaries: CustomerSummary[] = [];

    for (const org of organizations) {
      try {
        const summary = await this.getCustomerSummary(org.id);
        summaries.push(summary);
      } catch (error) {
        console.error(`Failed to get summary for org ${org.name}:`, error);
      }
    }

    return summaries.sort((a, b) => b.ticketStats.total - a.ticketStats.total);
  }

  // CSM Portfolio Methods - Optimized to minimize API calls
  private userCache: Map<number, User> = new Map();
  private orgCache: Map<number, Organization> = new Map();

  async getCachedUser(userId: number): Promise<User | null> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }
    try {
      const user = await this.getUser(userId);
      this.userCache.set(userId, user);
      return user;
    } catch (error) {
      console.error(`Failed to fetch user ${userId}:`, error);
      return null;
    }
  }

  async getCachedOrganization(orgId: number): Promise<Organization | null> {
    if (this.orgCache.has(orgId)) {
      return this.orgCache.get(orgId)!;
    }
    try {
      const org = await this.getOrganization(orgId);
      this.orgCache.set(orgId, org);
      return org;
    } catch (error) {
      console.error(`Failed to fetch organization ${orgId}:`, error);
      return null;
    }
  }

  // Pre-load all organizations into cache
  private async preloadOrganizations(): Promise<void> {
    if (this.orgCache.size > 0) return;

    console.log("Preloading organizations...");
    const orgs = await this.getOrganizations();
    for (const org of orgs) {
      this.orgCache.set(org.id, org);
    }
    console.log(`Cached ${orgs.length} organizations`);
  }

  async getCSMPortfolios(): Promise<CSMPortfolio[]> {
    await this.getTicketFields();

    // Pre-load all organizations to avoid individual fetches
    await this.preloadOrganizations();

    console.log("Fetching tickets with Deque requesters to identify CSM-managed orgs...");

    // Get tickets created by Deque employees to identify which orgs have CSM involvement
    const dequeTickets = await this.searchTickets("type:ticket requester:*@deque.com", 5);
    console.log(`Found ${dequeTickets.length} tickets from Deque requesters`);

    if (dequeTickets.length === 0) {
      return [];
    }

    // Get unique requester IDs and fetch user details
    const requesterIds = [...new Set(dequeTickets.map((t) => t.requester_id))];
    const userMap = new Map<number, User>();
    for (const userId of requesterIds) {
      const user = await this.getCachedUser(userId);
      if (user && user.email.toLowerCase().endsWith("@deque.com")) {
        userMap.set(userId, user);
      }
    }

    // Step 1: For each org, find the most recent Deque requester (current CSM)
    // orgId -> { csmId, mostRecentTicketDate }
    const orgToCurrentCSM = new Map<number, { csmId: number; mostRecentDate: Date }>();

    for (const ticket of dequeTickets) {
      const orgId = ticket.organization_id;
      if (!orgId || orgId === 0) continue; // Skip tickets without org

      const requesterId = ticket.requester_id;
      if (!userMap.has(requesterId)) continue; // Skip if not a valid Deque user

      const ticketDate = new Date(ticket.updated_at);
      const current = orgToCurrentCSM.get(orgId);

      if (!current || ticketDate > current.mostRecentDate) {
        orgToCurrentCSM.set(orgId, { csmId: requesterId, mostRecentDate: ticketDate });
      }
    }

    console.log(`Found ${orgToCurrentCSM.size} organizations with CSM involvement`);

    // Step 2: Group orgs by their current CSM
    // csmId -> [orgId, ...]
    const csmToOrgs = new Map<number, number[]>();
    for (const [orgId, { csmId }] of orgToCurrentCSM) {
      if (!csmToOrgs.has(csmId)) {
        csmToOrgs.set(csmId, []);
      }
      csmToOrgs.get(csmId)!.push(orgId);
    }

    console.log(`Assigned orgs to ${csmToOrgs.size} CSMs`);

    // Step 3: For each CSM, fetch ALL tickets for their assigned orgs
    const portfolios: CSMPortfolio[] = [];

    for (const [csmId, orgIds] of csmToOrgs) {
      const csm = userMap.get(csmId);
      if (!csm) continue;

      const customers: CSMCustomerSummary[] = [];
      let totalTickets = 0;
      let openTickets = 0;

      // Fetch all tickets for each org assigned to this CSM
      for (const orgId of orgIds) {
        const org = this.orgCache.get(orgId);
        if (!org) continue;

        // Get ALL tickets for this org (not just CSM-created ones)
        const orgTickets = await this.getTicketsByOrganization(orgId);

        if (orgTickets.length === 0) continue;

        let featureRequests = 0;
        let problemReports = 0;
        let escalations = 0;
        const priorityBreakdown = { urgent: 0, high: 0, normal: 0, low: 0 };

        for (const ticket of orgTickets) {
          const type = this.classifyRequestType(ticket);
          if (type === "featureRequest") featureRequests++;
          else if (type === "problemReport") problemReports++;

          // Count escalations (via tags)
          if (this.checkEscalation(ticket) && ticket.status !== "solved" && ticket.status !== "closed") {
            escalations++;
          }

          const priority = ticket.priority || "normal";
          if (priority === "urgent") priorityBreakdown.urgent++;
          else if (priority === "high") priorityBreakdown.high++;
          else if (priority === "low") priorityBreakdown.low++;
          else priorityBreakdown.normal++;
        }

        totalTickets += orgTickets.length;
        openTickets += orgTickets.filter((t) => t.status === "open" || t.status === "pending" || t.status === "new").length;

        customers.push({
          organization: org,
          tickets: orgTickets.sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          ),
          ticketStats: {
            total: orgTickets.length,
            new: orgTickets.filter((t) => t.status === "new").length,
            open: orgTickets.filter((t) => t.status === "open").length,
            pending: orgTickets.filter((t) => t.status === "pending").length,
            hold: orgTickets.filter((t) => t.status === "hold").length,
            solved: orgTickets.filter((t) => t.status === "solved").length,
            closed: orgTickets.filter((t) => t.status === "closed").length,
          },
          priorityBreakdown,
          featureRequests,
          problemReports,
          escalations,
        });
      }

      customers.sort((a, b) => b.ticketStats.total - a.ticketStats.total);

      if (customers.length > 0) {
        portfolios.push({
          csm,
          customers,
          totalTickets,
          openTickets,
          totalCustomers: customers.length,
        });
      }
    }

    // Sort portfolios by total tickets
    return portfolios.sort((a, b) => b.totalTickets - a.totalTickets);
  }

  async getCSMPortfolio(csmId: number): Promise<CSMPortfolio | null> {
    await this.getTicketFields();
    await this.preloadOrganizations();

    const csm = await this.getCachedUser(csmId);
    if (!csm) return null;

    // Verify it's a Deque user
    if (!csm.email.toLowerCase().endsWith("@deque.com")) {
      throw new Error("User is not a Deque employee");
    }

    const tickets = await this.searchTickets(`type:ticket requester_id:${csmId}`);

    // Group tickets by organization
    const orgTicketMap = new Map<number, Ticket[]>();

    for (const ticket of tickets) {
      const orgId = ticket.organization_id || 0;
      if (!orgTicketMap.has(orgId)) {
        orgTicketMap.set(orgId, []);
      }
      orgTicketMap.get(orgId)!.push(ticket);
    }

    const customers: CSMCustomerSummary[] = [];

    for (const [orgId, orgTickets] of orgTicketMap) {
      if (orgId === 0) continue; // Skip tickets without org

      const org = this.orgCache.get(orgId);
      if (!org) continue;

      let featureRequests = 0;
      let problemReports = 0;
      let escalations = 0;
      const priorityBreakdown = { urgent: 0, high: 0, normal: 0, low: 0 };

      for (const ticket of orgTickets) {
        const type = this.classifyRequestType(ticket);
        if (type === "featureRequest") featureRequests++;
        else if (type === "problemReport") problemReports++;

        // Count escalations
        if (this.checkEscalation(ticket) && ticket.status !== "solved" && ticket.status !== "closed") {
          escalations++;
        }

        const priority = ticket.priority || "normal";
        if (priority === "urgent") priorityBreakdown.urgent++;
        else if (priority === "high") priorityBreakdown.high++;
        else if (priority === "low") priorityBreakdown.low++;
        else priorityBreakdown.normal++;
      }

      customers.push({
        organization: org,
        tickets: orgTickets.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        ),
        ticketStats: {
          total: orgTickets.length,
          new: orgTickets.filter((t) => t.status === "new").length,
          open: orgTickets.filter((t) => t.status === "open").length,
          pending: orgTickets.filter((t) => t.status === "pending").length,
          hold: orgTickets.filter((t) => t.status === "hold").length,
          solved: orgTickets.filter((t) => t.status === "solved").length,
          closed: orgTickets.filter((t) => t.status === "closed").length,
        },
        priorityBreakdown,
        featureRequests,
        problemReports,
        escalations,
      });
    }

    customers.sort((a, b) => b.ticketStats.total - a.ticketStats.total);

    return {
      csm,
      customers,
      totalTickets: tickets.length,
      openTickets: tickets.filter((t) => t.status === "open" || t.status === "pending").length,
      totalCustomers: customers.length,
    };
  }

  // Build CSM portfolios using Salesforce assignments as the source of truth
  async getCSMPortfoliosFromSalesforce(sfAssignments: CSMAssignment[]): Promise<CSMPortfolio[]> {
    await this.getTicketFields();
    await this.preloadOrganizations();

    console.log(`Processing ${sfAssignments.length} Salesforce CSM assignments...`);

    // Create a lookup map of organization names (normalized) to Zendesk org
    const orgNameMap = new Map<string, Organization>();
    for (const org of this.orgCache.values()) {
      // Store both exact name and normalized versions for matching
      orgNameMap.set(org.name.toLowerCase().trim(), org);
      // Also try without common suffixes
      const normalized = org.name
        .toLowerCase()
        .trim()
        .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
        .trim();
      if (normalized !== org.name.toLowerCase().trim()) {
        orgNameMap.set(normalized, org);
      }
    }

    // Group Salesforce assignments by CSM
    const csmToAccounts = new Map<string, { csm: CSMAssignment; accounts: CSMAssignment[] }>();

    for (const assignment of sfAssignments) {
      const csmKey = assignment.csmEmail.toLowerCase();
      if (!csmToAccounts.has(csmKey)) {
        csmToAccounts.set(csmKey, { csm: assignment, accounts: [] });
      }
      csmToAccounts.get(csmKey)!.accounts.push(assignment);
    }

    console.log(`Found ${csmToAccounts.size} unique CSMs from Salesforce`);

    const portfolios: CSMPortfolio[] = [];
    let matchedOrgs = 0;
    let unmatchedOrgs = 0;

    for (const [csmEmail, { csm, accounts }] of csmToAccounts) {
      const customers: CSMCustomerSummary[] = [];
      let totalTickets = 0;
      let openTickets = 0;

      // Create a synthetic CSM user object from Salesforce data
      const csmUser: User = {
        id: parseInt(csm.csmId.replace(/\D/g, "").slice(0, 10)) || 0,
        url: "",
        name: csm.csmName,
        email: csm.csmEmail,
        role: "agent",
        created_at: "",
        updated_at: "",
      };

      for (const account of accounts) {
        // Try to match Salesforce account to Zendesk organization
        const accountNameLower = account.accountName.toLowerCase().trim();
        const accountNameNormalized = accountNameLower
          .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation)$/i, "")
          .trim();

        let zendeskOrg = orgNameMap.get(accountNameLower) || orgNameMap.get(accountNameNormalized);

        // Try partial matching if exact match fails
        if (!zendeskOrg) {
          for (const [orgName, org] of orgNameMap) {
            if (
              orgName.includes(accountNameNormalized) ||
              accountNameNormalized.includes(orgName)
            ) {
              zendeskOrg = org;
              break;
            }
          }
        }

        if (!zendeskOrg) {
          unmatchedOrgs++;
          continue;
        }

        matchedOrgs++;

        // Get ALL tickets for this organization
        const orgTickets = await this.getTicketsByOrganization(zendeskOrg.id);

        if (orgTickets.length === 0) continue;

        let featureRequests = 0;
        let problemReports = 0;
        let escalations = 0;
        const priorityBreakdown = { urgent: 0, high: 0, normal: 0, low: 0 };

        for (const ticket of orgTickets) {
          const type = this.classifyRequestType(ticket);
          if (type === "featureRequest") featureRequests++;
          else if (type === "problemReport") problemReports++;

          // Count escalations
          if (this.checkEscalation(ticket) && ticket.status !== "solved" && ticket.status !== "closed") {
            escalations++;
          }

          const priority = ticket.priority || "normal";
          if (priority === "urgent") priorityBreakdown.urgent++;
          else if (priority === "high") priorityBreakdown.high++;
          else if (priority === "low") priorityBreakdown.low++;
          else priorityBreakdown.normal++;
        }

        totalTickets += orgTickets.length;
        openTickets += orgTickets.filter(
          (t) => t.status === "open" || t.status === "pending" || t.status === "new"
        ).length;

        customers.push({
          organization: zendeskOrg,
          tickets: orgTickets.sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          ),
          ticketStats: {
            total: orgTickets.length,
            new: orgTickets.filter((t) => t.status === "new").length,
            open: orgTickets.filter((t) => t.status === "open").length,
            pending: orgTickets.filter((t) => t.status === "pending").length,
            hold: orgTickets.filter((t) => t.status === "hold").length,
            solved: orgTickets.filter((t) => t.status === "solved").length,
            closed: orgTickets.filter((t) => t.status === "closed").length,
          },
          priorityBreakdown,
          featureRequests,
          problemReports,
          escalations,
        });
      }

      customers.sort((a, b) => b.ticketStats.total - a.ticketStats.total);

      if (customers.length > 0) {
        portfolios.push({
          csm: csmUser,
          customers,
          totalTickets,
          openTickets,
          totalCustomers: customers.length,
        });
      }
    }

    console.log(`Matched ${matchedOrgs} orgs, ${unmatchedOrgs} unmatched`);

    // Sort portfolios by total tickets
    return portfolios.sort((a, b) => b.totalTickets - a.totalTickets);
  }
}
