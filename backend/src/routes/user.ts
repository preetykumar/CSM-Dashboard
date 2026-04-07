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

  return router;
}
