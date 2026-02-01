import { Router, Request, Response } from "express";
import { SalesforceService } from "../services/salesforce.js";

export function createSalesforceRoutes(salesforce: SalesforceService): Router {
  const router = Router();

  router.get("/test", async (_req: Request, res: Response) => {
    try {
      const result = await salesforce.testConnection();
      res.json(result);
    } catch (error) {
      console.error("Error testing Salesforce connection:", error);
      res.status(500).json({ error: "Failed to test Salesforce connection" });
    }
  });

  router.get("/csm-assignments", async (_req: Request, res: Response) => {
    try {
      const assignments = await salesforce.getCSMAssignments();
      res.json({ assignments, count: assignments.length });
    } catch (error) {
      console.error("Error fetching CSM assignments:", error);
      res.status(500).json({ error: "Failed to fetch CSM assignments from Salesforce" });
    }
  });

  router.get("/account-fields", async (_req: Request, res: Response) => {
    try {
      const fields = await salesforce.getAccountFields();
      res.json({ fields, count: fields.length });
    } catch (error) {
      console.error("Error fetching Account fields:", error);
      res.status(500).json({ error: "Failed to fetch Account fields" });
    }
  });

  return router;
}
