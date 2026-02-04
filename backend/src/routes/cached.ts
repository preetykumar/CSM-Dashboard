import { Router, Request, Response } from "express";
import { DatabaseService, CachedTicket } from "../services/database.js";
import type { CustomerSummary, CSMPortfolio, CSMCustomerSummary, Ticket, Organization, EnhancedCustomerSummary, VelocitySnapshot, ProductBacklog, ModuleSummary, QuarterlySummary } from "../types/index.js";

// Admin users who can see all CSM portfolios
const ADMIN_EMAILS = [
  "michelle.viguerie@deque.com",
  "katile.olsen@deque.com",
  "neel.sinha@deque.com",
  "preety.kumar@deque.com",
  "sujasree.kurapati@deque.com",
  "anik.ganguly@deque.com",
  "dylan.barrell@deque.com",
  "mike.farrell@deque.com",
];

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.some((admin) => admin.toLowerCase() === email.toLowerCase());
}

export function createCachedRoutes(db: DatabaseService): Router {
  const router = Router();

  // Get all organizations with summaries
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const orgs = db.getOrganizations();
      res.json({
        organizations: orgs.map((org) => ({
          id: org.id,
          name: org.name,
          domain_names: JSON.parse(org.domain_names || "[]"),
          salesforce_account_name: org.salesforce_account_name,
          created_at: org.created_at,
          updated_at: org.updated_at,
        })),
        count: orgs.length,
        cached: true,
      });
    } catch (error) {
      console.error("Error fetching cached organizations:", error);
      res.status(500).json({ error: "Failed to fetch organizations" });
    }
  });

  // Get organization summary
  router.get("/:id/summary", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const org = db.getOrganization(orgId);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const ticketStats = db.getTicketStats(orgId);
      const priorityBreakdown = db.getPriorityBreakdown(orgId);
      const recentTickets = db.getTicketsByOrganization(orgId).slice(0, 10);

      const summary: CustomerSummary = {
        organization: {
          id: org.id,
          url: "",
          name: org.name,
          domain_names: JSON.parse(org.domain_names || "[]"),
          salesforce_account_name: org.salesforce_account_name || undefined,
          created_at: org.created_at,
          updated_at: org.updated_at,
        },
        ticketStats,
        priorityBreakdown,
        recentTickets: recentTickets.map((t) => ({
          id: t.id,
          url: "",
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          requester_id: t.requester_id,
          submitter_id: t.requester_id,
          assignee_id: t.assignee_id || undefined,
          organization_id: t.organization_id,
          tags: JSON.parse(t.tags || "[]"),
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
      };

      res.json(summary);
    } catch (error) {
      console.error("Error fetching cached summary:", error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  // Get detailed customer summary with product breakdown
  router.get("/:id/detailed", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const org = db.getOrganization(orgId);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const tickets = db.getTicketsByOrganization(orgId);
      const ticketStats = db.getTicketStats(orgId);
      const priorityBreakdown = db.getPriorityBreakdown(orgId);
      const recentTickets = tickets
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 10);

      // Build product breakdown
      const productMap = new Map<string, {
        product: string;
        total: number;
        featureRequests: number;
        problemReports: number;
        other: number;
        openTickets: number;
        tickets: CachedTicket[];
      }>();

      let totalFeatureRequests = 0;
      let totalProblemReports = 0;
      let totalOther = 0;

      for (const ticket of tickets) {
        const product = ticket.product || "Unknown Product";
        const ticketType = ticket.ticket_type || "other";

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

        const productStats = productMap.get(product)!;
        productStats.total++;
        productStats.tickets.push(ticket);

        // Count by type
        if (ticketType === "feature") {
          productStats.featureRequests++;
          totalFeatureRequests++;
        } else if (ticketType === "bug") {
          productStats.problemReports++;
          totalProblemReports++;
        } else {
          productStats.other++;
          totalOther++;
        }

        // Count open tickets
        if (["new", "open", "pending", "hold"].includes(ticket.status)) {
          productStats.openTickets++;
        }
      }

      // Convert to array and sort by total tickets
      const productBreakdown = Array.from(productMap.values())
        .map((p) => ({
          product: p.product,
          total: p.total,
          featureRequests: p.featureRequests,
          problemReports: p.problemReports,
          other: p.other,
          openTickets: p.openTickets,
          tickets: p.tickets.map((t) => mapCachedTicketToDetailed(t)),
        }))
        .sort((a, b) => b.total - a.total);

      res.json({
        organization: {
          id: org.id,
          name: org.name,
          domain_names: JSON.parse(org.domain_names || "[]"),
          salesforce_account_name: org.salesforce_account_name || undefined,
          created_at: org.created_at,
          updated_at: org.updated_at,
        },
        ticketStats,
        priorityBreakdown,
        recentTickets: recentTickets.map((t) => mapCachedTicketToDetailed(t)),
        productBreakdown,
        requestTypeBreakdown: {
          featureRequests: totalFeatureRequests,
          problemReports: totalProblemReports,
          other: totalOther,
        },
      });
    } catch (error) {
      console.error("Error fetching detailed customer summary:", error);
      res.status(500).json({ error: "Failed to fetch detailed customer summary" });
    }
  });

  // Get tickets by status
  router.get("/:id/tickets/status/:status", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const status = req.params.status;
      const tickets = db.getTicketsByStatus(orgId, status);

      res.json({
        tickets: tickets.map((t) => ({
          id: t.id,
          url: "",
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          requester_id: t.requester_id,
          submitter_id: t.requester_id,
          assignee_id: t.assignee_id || undefined,
          organization_id: t.organization_id,
          tags: JSON.parse(t.tags || "[]"),
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
        count: tickets.length,
        cached: true,
      });
    } catch (error) {
      console.error("Error fetching cached tickets by status:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get tickets by priority
  router.get("/:id/tickets/priority/:priority", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const priority = req.params.priority;
      const tickets = db.getTicketsByPriority(orgId, priority);

      res.json({
        tickets: tickets.map((t) => ({
          id: t.id,
          url: "",
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          requester_id: t.requester_id,
          submitter_id: t.requester_id,
          assignee_id: t.assignee_id || undefined,
          organization_id: t.organization_id,
          tags: JSON.parse(t.tags || "[]"),
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
        count: tickets.length,
        cached: true,
      });
    } catch (error) {
      console.error("Error fetching cached tickets by priority:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get enhanced customer summary with velocity and product backlog (for CSM view)
  router.get("/customers/:orgId/summary", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId, 10);
      const org = db.getOrganization(orgId);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const tickets = db.getTicketsByOrganization(orgId);

      // Calculate velocity snapshot
      const velocity = calculateVelocitySnapshot(tickets);

      // Calculate quarterly summaries
      const { currentQuarter, previousQuarter } = calculateQuarterlySummaries(tickets);

      // Build product backlog
      const backlog = buildProductBacklog(tickets);

      const summary: EnhancedCustomerSummary = {
        organization: {
          id: org.id,
          url: "",
          name: org.name,
          domain_names: JSON.parse(org.domain_names || "[]"),
          salesforce_account_name: org.salesforce_account_name || undefined,
          created_at: org.created_at,
          updated_at: org.updated_at,
        },
        velocity,
        currentQuarter,
        previousQuarter,
        backlog,
      };

      res.json(summary);
    } catch (error) {
      console.error("Error fetching enhanced customer summary:", error);
      res.status(500).json({ error: "Failed to fetch customer summary" });
    }
  });

  // Map granular product names to top-level product categories
  function getTopLevelProduct(rawProduct: string | null | undefined): string {
    if (!rawProduct) return "Other";
    const product = rawProduct.toLowerCase().trim();

    // axe Monitor
    if (product.includes("monitor") || product.includes("comply") || product === "30minwarning" ||
        product.includes("auto_upgrade") || product.includes("auto-upgrade")) {
      return "axe Monitor";
    }

    // axe Auditor
    if (product.includes("auditor") || product.includes("assure") || product === "audit") {
      return "axe Auditor";
    }

    // axe DevTools (includes all variations)
    if (product.includes("devtools") || product.includes("axepro") || product.includes("axe_pro") ||
        product.includes("axe-pro") || product.includes("watcher") || product.includes("linter") ||
        product.includes("attest") || product.includes("agt") || product === "html" ||
        product.includes("axe_beta")) {
      return "axe DevTools";
    }

    // axe Reports
    if (product.includes("report")) {
      return "axe Reports";
    }

    // Deque University
    if (product.includes("university") || product === "dequers") {
      return "Deque University";
    }

    // axe Core / Open Source
    if (product.includes("axe_core") || product.includes("axe-core") || product.includes("open_source") ||
        product.includes("ruleset")) {
      return "axe Core";
    }

    // axe Account Portal
    if (product.includes("account-portal") || product.includes("account_portal")) {
      return "axe Account Portal";
    }

    // axe Expert / Consulting
    if (product.includes("expert") || product.includes("consult") || product.includes("assessment")) {
      return "axe Expert Services";
    }

    // axe Mobile (standalone)
    if (product === "mobile" || product === "ios" || product === "android") {
      return "axe DevTools";
    }

    // Jira Integration
    if (product.includes("jira")) {
      return "Jira Integration";
    }

    // axe-con
    if (product.includes("axe-con") || product.includes("axecon")) {
      return "axe-con";
    }

    // Access requests / Account support
    if (product.includes("access_request") || product.includes("access_removal") ||
        product.includes("account_support") || product.includes("license") ||
        product.includes("make_a_request")) {
      return "Account & Access";
    }

    // General/Other
    if (product === "other" || product === "deque" || product === "helpdesk" ||
        product === "help_desk" || product === "internal" || product.startsWith("content_cue") ||
        product.includes("email") || product.includes("documentation")) {
      return "Other";
    }

    // Fallback - keep original if no match but capitalize
    return "Other";
  }

  // Get all tickets grouped by product, then by request type, then by issue subtype
  router.get("/products", async (_req: Request, res: Response) => {
    try {
      const allTickets = db.getAllTickets();
      const orgs = db.getOrganizations();
      const orgMap = new Map(orgs.map((o) => [o.id, o]));

      // Group tickets: Product -> Request Type -> Issue Subtype
      const productMap = new Map<string, {
        product: string;
        totalTickets: number;
        openTickets: number;
        types: Map<string, {
          type: string;
          totalTickets: number;
          openTickets: number;
          subtypes: Map<string, {
            subtype: string;
            tickets: CachedTicket[];
          }>;
        }>;
      }>();

      for (const ticket of allTickets) {
        const product = getTopLevelProduct(ticket.product);
        const ticketType = ticket.ticket_type === "bug" ? "Bug" :
                           ticket.ticket_type === "feature" ? "Feature" : "Other";
        // Clean up legacy "Helpdesk Status (Zendesk)" values
        const cleanedSubtype = cleanModuleValue(ticket.issue_subtype);
        const cleanedModule = cleanModuleValue(ticket.module);
        const subtype = cleanedSubtype || cleanedModule || "General";
        const isOpen = ["new", "open", "pending", "hold"].includes(ticket.status);

        // Initialize product if not exists
        if (!productMap.has(product)) {
          productMap.set(product, {
            product,
            totalTickets: 0,
            openTickets: 0,
            types: new Map(),
          });
        }
        const productData = productMap.get(product)!;
        productData.totalTickets++;
        if (isOpen) productData.openTickets++;

        // Initialize type if not exists
        if (!productData.types.has(ticketType)) {
          productData.types.set(ticketType, {
            type: ticketType,
            totalTickets: 0,
            openTickets: 0,
            subtypes: new Map(),
          });
        }
        const typeData = productData.types.get(ticketType)!;
        typeData.totalTickets++;
        if (isOpen) typeData.openTickets++;

        // Initialize subtype if not exists
        if (!typeData.subtypes.has(subtype)) {
          typeData.subtypes.set(subtype, {
            subtype,
            tickets: [],
          });
        }
        typeData.subtypes.get(subtype)!.tickets.push(ticket);
      }

      // Convert to array format with tickets mapped to detailed format
      const products = Array.from(productMap.values())
        .map((p) => ({
          product: p.product,
          totalTickets: p.totalTickets,
          openTickets: p.openTickets,
          types: Array.from(p.types.values())
            .map((t) => ({
              type: t.type,
              totalTickets: t.totalTickets,
              openTickets: t.openTickets,
              subtypes: Array.from(t.subtypes.values())
                .map((s) => ({
                  subtype: s.subtype,
                  tickets: s.tickets.map((ticket) => {
                    const org = orgMap.get(ticket.organization_id);
                    return {
                      id: ticket.id,
                      url: `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`,
                      subject: ticket.subject,
                      status: ticket.status,
                      priority: ticket.priority,
                      ticket_type: ticket.ticket_type,
                      is_escalated: ticket.is_escalated === 1,
                      product: ticket.product,
                      module: ticket.module,
                      issue_subtype: ticket.issue_subtype,
                      workflow_status: ticket.workflow_status || getDefaultStatus(ticket.status),
                      updated_at: ticket.updated_at,
                      created_at: ticket.created_at,
                      organization_id: ticket.organization_id,
                      organization_name: org?.salesforce_account_name || org?.name || "Unknown",
                    };
                  }),
                }))
                .sort((a, b) => b.tickets.length - a.tickets.length),
            }))
            .sort((a, b) => {
              // Sort Bug > Feature > Other
              const order = { Bug: 0, Feature: 1, Other: 2 };
              return (order[a.type as keyof typeof order] ?? 3) - (order[b.type as keyof typeof order] ?? 3);
            }),
        }))
        .sort((a, b) => b.totalTickets - a.totalTickets);

      res.json({
        products,
        totalProducts: products.length,
        totalTickets: allTickets.length,
        cached: true,
      });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  // Get CSM portfolios from cache - filtered by logged-in user unless admin
  router.get("/portfolios", async (req: Request, res: Response) => {
    try {
      const userEmail = req.user?.email;
      const userIsAdmin = isAdmin(userEmail);
      let csmPortfolios;

      if (userIsAdmin) {
        // Admin users can see all CSM portfolios
        csmPortfolios = db.getCSMPortfolios();
        console.log(`Admin ${userEmail}: viewing all ${csmPortfolios.length} CSM portfolios`);
      } else if (userEmail) {
        // Regular users only see their own portfolio
        const myPortfolio = db.getCSMPortfolioByEmail(userEmail);
        csmPortfolios = myPortfolio ? [myPortfolio] : [];
        console.log(`CSM portfolio for ${userEmail}: ${myPortfolio ? myPortfolio.org_ids.length : 0} customers`);
      } else {
        // No authentication - return all portfolios (for backwards compatibility)
        csmPortfolios = db.getCSMPortfolios();
      }

      const portfolios: CSMPortfolio[] = [];

      for (const portfolio of csmPortfolios) {
        const customers: CSMCustomerSummary[] = [];
        let totalTickets = 0;
        let openTickets = 0;

        for (const orgId of portfolio.org_ids) {
          const org = db.getOrganization(orgId);
          if (!org) continue;

          const tickets = db.getTicketsByOrganization(orgId);
          const ticketStats = db.getTicketStats(orgId);

          // Count feature requests, problem reports, and priority breakdown
          let featureRequests = 0;
          let problemReports = 0;
          let escalations = 0;
          const priorityBreakdown = { urgent: 0, high: 0, normal: 0, low: 0 };

          for (const t of tickets) {
            if (t.ticket_type === "feature") featureRequests++;
            else if (t.ticket_type === "bug") problemReports++;

            // Count escalations (only open/active tickets)
            if (t.is_escalated && !["solved", "closed"].includes(t.status)) {
              escalations++;
            }

            // Count by priority
            const priority = t.priority || "normal";
            if (priority === "urgent") priorityBreakdown.urgent++;
            else if (priority === "high") priorityBreakdown.high++;
            else if (priority === "low") priorityBreakdown.low++;
            else priorityBreakdown.normal++;
          }

          totalTickets += ticketStats.total;
          openTickets += ticketStats.new + ticketStats.open + ticketStats.pending;

          customers.push({
            organization: {
              id: org.id,
              url: "",
              name: org.name,
              domain_names: JSON.parse(org.domain_names || "[]"),
              salesforce_account_name: org.salesforce_account_name || undefined,
              created_at: org.created_at,
              updated_at: org.updated_at,
            },
            // Send minimal ticket data for filtering - full details fetched on demand
            tickets: tickets.map((t) => ({
              id: t.id,
              subject: t.subject,
              status: t.status,
              priority: t.priority,
              ticket_type: t.ticket_type || undefined,
              is_escalated: t.is_escalated === 1,
              product: t.product || undefined,
              module: t.module || undefined,
              issue_subtype: t.issue_subtype || undefined,
              updated_at: t.updated_at,
              url: `https://dequehelp.zendesk.com/agent/tickets/${t.id}`,
            })),
            ticketStats,
            priorityBreakdown,
            featureRequests,
            problemReports,
            escalations,
          });
        }

        customers.sort((a, b) => b.ticketStats.total - a.ticketStats.total);

        if (customers.length > 0) {
          portfolios.push({
            csm: {
              id: 0,
              url: "",
              name: portfolio.csm_name,
              email: portfolio.csm_email,
              role: "agent",
              created_at: "",
              updated_at: "",
            },
            customers,
            totalTickets,
            openTickets,
            totalCustomers: customers.length,
          });
        }
      }

      portfolios.sort((a, b) => b.totalTickets - a.totalTickets);

      res.json({
        portfolios,
        count: portfolios.length,
        cached: true,
        isAdmin: userIsAdmin,
        filteredByUser: !!userEmail,
      });
    } catch (error) {
      console.error("Error fetching cached CSM portfolios:", error);
      res.status(500).json({ error: "Failed to fetch CSM portfolios" });
    }
  });

  return router;
}

// Helper: Calculate velocity snapshot from cached tickets
function calculateVelocitySnapshot(tickets: CachedTicket[]): VelocitySnapshot {
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
    if (ticket.ticket_type === "bug") bugsFixed++;
    else if (ticket.ticket_type === "feature") featuresCompleted++;
  }

  return {
    closedThisMonth: closedThisMonth.length,
    bugsFixed,
    featuresCompleted,
    period: monthName,
  };
}

// Helper: Calculate quarterly summaries (current and previous quarter)
function calculateQuarterlySummaries(tickets: CachedTicket[]): {
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

  const currentQuarter = calculateQuarterStats(
    tickets,
    currentQuarterStart,
    currentQuarterEnd,
    `Q${currentQuarterNum} ${currentYear}`,
    formatQuarterPeriod((currentQuarterNum - 1) * 3, currentYear)
  );

  const previousQuarter = calculateQuarterStats(
    tickets,
    prevQuarterStart,
    prevQuarterEnd,
    `Q${prevQuarterNum} ${prevQuarterYear}`,
    formatQuarterPeriod((prevQuarterNum - 1) * 3, prevQuarterYear)
  );

  return { currentQuarter, previousQuarter };
}

// Helper: Calculate stats for a specific quarter
function calculateQuarterStats(
  tickets: CachedTicket[],
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
    if (ticket.ticket_type === "bug") bugsFixed++;
    else if (ticket.ticket_type === "feature") featuresCompleted++;
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

// Helper: Build product backlog from cached tickets
function buildProductBacklog(tickets: CachedTicket[]): ProductBacklog[] {
  // Filter to open/active tickets only
  const openTickets = tickets.filter((t) =>
    ["new", "open", "pending", "hold"].includes(t.status)
  );

  // Group by Product -> Module
  const productMap = new Map<string, Map<string, CachedTicket[]>>();

  for (const ticket of openTickets) {
    const product = ticket.product || "Unknown Product";
    const module = ticket.module || "General";

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
        const status = t.workflow_status || getDefaultStatus(t.status);
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
      const features = moduleTickets.filter((t) => t.ticket_type === "feature");
      const completedFeatures = features.filter((t) => t.status === "solved" || t.status === "closed").length;

      // Calculate bug statistics
      const bugs = moduleTickets.filter((t) => t.ticket_type === "bug");
      const openBugs = bugs.filter((t) => t.status !== "solved" && t.status !== "closed");
      const fixedBugs = bugs.filter((t) => t.status === "solved" || t.status === "closed");

      // Check for blockers in tags or urgent priority
      const blockers = openBugs.filter((t) => {
        const tags = JSON.parse(t.tags || "[]") as string[];
        return (
          tags.some((tag: string) => tag.toLowerCase().includes("blocker")) ||
          t.priority === "urgent"
        );
      }).length;

      modules.push({
        moduleName,
        status: mostCommonStatus,
        features: {
          completed: completedFeatures,
          total: features.length,
          tickets: features.map((t) => mapCachedTicketToDetailed(t)),
        },
        bugs: {
          total: bugs.length,
          open: openBugs.length,
          fixed: fixedBugs.length,
          blockers,
          tickets: bugs.map((t) => mapCachedTicketToDetailed(t)),
        },
        tickets: moduleTickets.map((t) => mapCachedTicketToDetailed(t)),
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

// Helper: Get default workflow status from Zendesk status
function getDefaultStatus(status: string): string {
  switch (status) {
    case "new": return "New";
    case "open": return "In Progress";
    case "pending": return "Waiting";
    case "hold": return "Backlogged";
    case "solved": return "Resolved";
    case "closed": return "Closed";
    default: return "Unknown";
  }
}

// Helper: Clean up module/subtype values - remove legacy placeholder
function cleanModuleValue(value: string | null | undefined): string | undefined {
  if (!value || value === "Helpdesk Status (Zendesk)") {
    return undefined;
  }
  return value;
}

// Helper: Map cached ticket to detailed ticket object with all fields
function mapCachedTicketToDetailed(t: CachedTicket): any {
  const cleanedModule = cleanModuleValue(t.module);
  const cleanedSubtype = cleanModuleValue(t.issue_subtype);

  return {
    id: t.id,
    url: `https://dequehelp.zendesk.com/agent/tickets/${t.id}`,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    requester_id: t.requester_id,
    submitter_id: t.requester_id,
    assignee_id: t.assignee_id || undefined,
    organization_id: t.organization_id,
    tags: JSON.parse(t.tags || "[]"),
    created_at: t.created_at,
    updated_at: t.updated_at,
    // Enhanced fields
    product: t.product,
    module: cleanedModule,
    ticket_type: t.ticket_type,
    workflow_status: t.workflow_status || getDefaultStatus(t.status),
    issue_subtype: cleanedSubtype || cleanedModule || "General",
    is_escalated: t.is_escalated === 1,
  };
}
