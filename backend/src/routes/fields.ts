import { Router, Request, Response } from "express";
import { ZendeskService } from "../services/zendesk.js";

export function createFieldRoutes(zendesk: ZendeskService): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const fields = await zendesk.getTicketFields();
      res.json({ fields, count: fields.length });
    } catch (error) {
      console.error("Error fetching ticket fields:", error);
      res.status(500).json({ error: "Failed to fetch ticket fields" });
    }
  });

  router.get("/mapping", async (_req: Request, res: Response) => {
    try {
      await zendesk.getTicketFields(); // Ensure fields are loaded
      const mapping = zendesk.getFieldMapping();
      res.json(mapping);
    } catch (error) {
      console.error("Error fetching field mapping:", error);
      res.status(500).json({ error: "Failed to fetch field mapping" });
    }
  });

  router.post("/mapping", async (req: Request, res: Response) => {
    try {
      const { productFieldId, requestTypeFieldId } = req.body;
      zendesk.setFieldMapping({ productFieldId, requestTypeFieldId });
      res.json({ success: true, mapping: zendesk.getFieldMapping() });
    } catch (error) {
      console.error("Error setting field mapping:", error);
      res.status(500).json({ error: "Failed to set field mapping" });
    }
  });

  return router;
}
