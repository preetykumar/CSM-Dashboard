import { Router, Request, Response } from "express";
import { ZendeskService } from "../services/zendesk.js";

export function createTicketRoutes(zendesk: ZendeskService): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const { tickets, hasMore } = await zendesk.getTickets();
      res.json({ tickets, hasMore });
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  router.get("/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }
      const tickets = await zendesk.searchTickets(query);
      res.json({ tickets, count: tickets.length });
    } catch (error) {
      console.error("Error searching tickets:", error);
      res.status(500).json({ error: "Failed to search tickets" });
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      const ticket = await zendesk.getTicket(ticketId);
      res.json(ticket);
    } catch (error) {
      console.error("Error fetching ticket:", error);
      res.status(500).json({ error: "Failed to fetch ticket" });
    }
  });

  return router;
}
