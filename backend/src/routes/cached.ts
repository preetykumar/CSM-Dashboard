import { Router, Request, Response } from "express";
import { DatabaseService, CachedTicket } from "../services/database.js";
import type { CustomerSummary, CSMPortfolio, CSMCustomerSummary, Ticket, Organization, EnhancedCustomerSummary, VelocitySnapshot, ProductBacklog, ModuleSummary, QuarterlySummary } from "../types/index.js";

// Admin users who can see all CSM portfolios
const ADMIN_EMAILS = [
  "michelle.viguerie@deque.com",
  "katile.olsen@deque.com",
  "neel.sinha@deque.com",
  "preety.kumar@deque.com",
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
          const priorityBreakdown = { urgent: 0, high: 0, normal: 0, low: 0 };

          for (const t of tickets) {
            if (t.ticket_type === "feature") featureRequests++;
            else if (t.ticket_type === "bug") problemReports++;

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
            tickets: tickets.map((t) => mapCachedTicketToDetailed(t)),
            ticketStats,
            priorityBreakdown,
            featureRequests,
            problemReports,
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

      // Calculate bug health
      const bugs = moduleTickets.filter((t) => t.ticket_type === "bug");
      const criticalBugs = bugs.filter((t) => t.priority === "urgent" || t.priority === "high");
      const minorBugs = bugs.filter((t) => t.priority === "normal" || t.priority === "low" || !t.priority);

      const criticalFixed = criticalBugs.filter((t) => t.status === "solved" || t.status === "closed").length;
      const minorPending = minorBugs.filter((t) => t.status !== "solved" && t.status !== "closed").length;

      // Check for blockers in tags
      const blockers = bugs.filter((t) => {
        const tags = JSON.parse(t.tags || "[]") as string[];
        return (
          tags.some((tag: string) => tag.toLowerCase().includes("blocker")) ||
          t.priority === "urgent"
        ) && t.status !== "solved" && t.status !== "closed";
      }).length;

      modules.push({
        moduleName,
        status: mostCommonStatus,
        features: {
          completed: completedFeatures,
          total: features.length,
        },
        bugHealth: {
          criticalFixed,
          minorPending,
          blockers,
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

// Helper: Map cached ticket to detailed ticket object with all fields
function mapCachedTicketToDetailed(t: CachedTicket): any {
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
    module: t.module,
    ticket_type: t.ticket_type,
    workflow_status: t.workflow_status || getDefaultStatus(t.status),
  };
}
