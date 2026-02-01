import { Router, Request, Response } from "express";
import { ZendeskService } from "../services/zendesk.js";

export function createOrganizationRoutes(zendesk: ZendeskService): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const organizations = await zendesk.getOrganizations();
      res.json({ organizations, count: organizations.length });
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ error: "Failed to fetch organizations" });
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const organization = await zendesk.getOrganization(orgId);
      res.json(organization);
    } catch (error) {
      console.error("Error fetching organization:", error);
      res.status(500).json({ error: "Failed to fetch organization" });
    }
  });

  router.get("/:id/summary", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const summary = await zendesk.getCustomerSummary(orgId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching customer summary:", error);
      res.status(500).json({ error: "Failed to fetch customer summary" });
    }
  });

  router.get("/:id/detailed", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const summary = await zendesk.getDetailedCustomerSummary(orgId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching detailed customer summary:", error);
      res.status(500).json({ error: "Failed to fetch detailed customer summary" });
    }
  });

  router.get("/:id/tickets/status/:status", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const status = req.params.status;
      const validStatuses = ["new", "open", "pending", "hold", "solved", "closed"];

      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
        return;
      }

      const tickets = await zendesk.getTicketsByOrganizationAndStatus(orgId, status);
      res.json({ tickets, count: tickets.length });
    } catch (error) {
      console.error("Error fetching tickets by status:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  router.get("/:id/tickets/priority/:priority", async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      const priority = req.params.priority;
      const validPriorities = ["low", "normal", "high", "urgent"];

      if (!validPriorities.includes(priority)) {
        res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` });
        return;
      }

      const tickets = await zendesk.getTicketsByOrganizationAndPriority(orgId, priority);
      res.json({ tickets, count: tickets.length });
    } catch (error) {
      console.error("Error fetching tickets by priority:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  router.get("/summaries/all", async (_req: Request, res: Response) => {
    try {
      const summaries = await zendesk.getAllCustomerSummaries();
      res.json({ summaries, count: summaries.length });
    } catch (error) {
      console.error("Error fetching all summaries:", error);
      res.status(500).json({ error: "Failed to fetch customer summaries" });
    }
  });

  return router;
}
