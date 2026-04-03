import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";

export function createUserRoutes(db: IDatabaseService): Router {
  const router = Router();

  // GET /api/user/preferences
  router.get("/preferences", async (req: Request, res: Response) => {
    const userEmail = (req.user as any)?.email;
    if (!userEmail) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const prefs = await db.getUserPreferences(userEmail);
    res.json(prefs || { email: userEmail, role: null, calendly_url: null, calendly_token: null });
  });

  // POST /api/user/preferences
  router.post("/preferences", async (req: Request, res: Response) => {
    const userEmail = (req.user as any)?.email;
    if (!userEmail) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const { role, calendly_url, calendly_token } = req.body;
    await db.upsertUserPreferences({ email: userEmail, role: role || null, calendly_url: calendly_url || null, calendly_token: calendly_token || null });
    res.json({ success: true });
  });

  // GET /api/user/calendly/events — proxy Calendly scheduled events
  router.get("/calendly/events", async (req: Request, res: Response) => {
    const userEmail = (req.user as any)?.email;
    if (!userEmail) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const prefs = await db.getUserPreferences(userEmail);
    if (!prefs?.calendly_token) {
      return res.json({ events: [], requiresToken: true });
    }

    try {
      // Get current user URI from Calendly
      const meResponse = await fetch("https://api.calendly.com/users/me", {
        headers: { Authorization: `Bearer ${prefs.calendly_token}`, "Content-Type": "application/json" },
      });
      if (!meResponse.ok) {
        return res.status(400).json({ error: "Invalid Calendly token", requiresToken: true });
      }
      const meData = await meResponse.json() as any;
      const userUri = meData.resource?.uri;
      if (!userUri) {
        return res.status(400).json({ error: "Could not get Calendly user URI" });
      }

      // Get upcoming scheduled events for next 30 days
      const now = new Date().toISOString();
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const eventsResponse = await fetch(
        `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${now}&max_start_time=${nextMonth}&status=active&count=20&sort=start_time:asc`,
        { headers: { Authorization: `Bearer ${prefs.calendly_token}`, "Content-Type": "application/json" } }
      );
      if (!eventsResponse.ok) {
        return res.status(500).json({ error: "Failed to fetch Calendly events" });
      }
      const eventsData = await eventsResponse.json() as any;
      res.json({ events: eventsData.collection || [] });
    } catch (err) {
      console.error("Calendly proxy error:", err);
      res.status(500).json({ error: "Failed to fetch Calendly events" });
    }
  });

  return router;
}
