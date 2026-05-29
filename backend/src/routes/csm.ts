import { Router, Request, Response } from "express";
import { ZendeskService } from "../services/zendesk.js";
import { SalesforceService } from "../services/salesforce.js";
import { MemoryCache } from "../services/cache.js";

// 90s TTL — CSM assignments rarely change mid-session; this endpoint was the
// largest unmitigated cost on home + admin view-as flows because it fanned
// out a Salesforce SOQL fetch + Zendesk rollup for every page load.
const csmPortfoliosCache = new MemoryCache(90);

export function createCSMRoutes(zendesk: ZendeskService, salesforce: SalesforceService | null): Router {
  const router = Router();

  // Get all CSM portfolios (using Salesforce for assignments if available)
  router.get("/portfolios", async (_req: Request, res: Response) => {
    try {
      const cacheKey = salesforce ? "csm-portfolios:sf" : "csm-portfolios:zd";
      const cached = csmPortfoliosCache.get<{ portfolios: unknown[]; count: number }>(cacheKey);
      if (cached) {
        res.set("Cache-Control", "public, max-age=60");
        return res.json({ ...cached, cacheHit: true });
      }

      let portfolios;
      if (salesforce) {
        console.log("Fetching CSM portfolios using Salesforce assignments...");
        const csmAssignments = await salesforce.getCSMAssignments();
        portfolios = await zendesk.getCSMPortfoliosFromSalesforce(csmAssignments);
      } else {
        console.log("Salesforce not configured, using ticket-based CSM detection...");
        portfolios = await zendesk.getCSMPortfolios();
      }

      const payload = { portfolios, count: portfolios.length };
      csmPortfoliosCache.set(cacheKey, payload);
      res.set("Cache-Control", "public, max-age=60");
      res.json({ ...payload, cacheHit: false });
    } catch (error) {
      console.error("Error fetching CSM portfolios:", error);
      res.status(500).json({ error: "Failed to fetch CSM portfolios" });
    }
  });

  // Get a specific CSM's portfolio
  router.get("/portfolios/:csmId", async (req: Request, res: Response) => {
    try {
      const csmId = parseInt(req.params.csmId, 10);
      const portfolio = await zendesk.getCSMPortfolio(csmId);
      if (!portfolio) {
        res.status(404).json({ error: "CSM not found" });
        return;
      }
      res.json(portfolio);
    } catch (error) {
      console.error("Error fetching CSM portfolio:", error);
      res.status(500).json({ error: "Failed to fetch CSM portfolio" });
    }
  });

  // Get enhanced customer summary with velocity and product backlog
  router.get("/customers/:orgId/summary", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId, 10);
      const summary = await zendesk.getEnhancedCustomerSummary(orgId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching enhanced customer summary:", error);
      res.status(500).json({ error: "Failed to fetch customer summary" });
    }
  });

  // Get tickets filtered by product and optionally module (for drill-down)
  router.get("/customers/:orgId/tickets", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId, 10);
      const { product, module } = req.query;

      const tickets = await zendesk.getTicketsByOrganization(orgId);

      // Filter by product/module if specified
      let filteredTickets = tickets;
      if (product) {
        await zendesk.getTicketFields(); // Ensure fields are loaded
        filteredTickets = tickets.filter((t) => {
          const fields = zendesk.extractTicketCustomFields(t);
          return fields.product === product && (!module || fields.module === module);
        });
      }

      res.json({
        tickets: filteredTickets.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          created_at: t.created_at,
          updated_at: t.updated_at,
          ...zendesk.extractTicketCustomFields(t),
        })),
        count: filteredTickets.length,
      });
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  return router;
}
