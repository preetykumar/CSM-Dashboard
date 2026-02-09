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

  router.get("/describe/:objectName", async (req: Request, res: Response) => {
    try {
      const describe = await salesforce.describeObject(req.params.objectName);
      const fields = describe.fields.map((f: any) => `${f.name} (${f.type}): ${f.label}`);
      res.json({ objectName: req.params.objectName, fields, count: fields.length });
    } catch (error) {
      console.error(`Error describing object ${req.params.objectName}:`, error);
      res.status(500).json({ error: `Failed to describe object ${req.params.objectName}` });
    }
  });

  // Get enterprise subscriptions by account name
  router.get("/subscriptions/account/:accountName", async (req: Request, res: Response) => {
    try {
      const accountName = decodeURIComponent(req.params.accountName);
      const subscriptions = await salesforce.getEnterpriseSubscriptionsByAccountName(accountName);
      res.json({ subscriptions, count: subscriptions.length });
    } catch (error) {
      console.error(`Error fetching subscriptions for ${req.params.accountName}:`, error);
      res.status(500).json({ error: "Failed to fetch enterprise subscriptions" });
    }
  });

  // Get enterprise subscriptions by account ID
  router.get("/subscriptions/id/:accountId", async (req: Request, res: Response) => {
    try {
      const subscriptions = await salesforce.getEnterpriseSubscriptionsByAccountId(req.params.accountId);
      res.json({ subscriptions, count: subscriptions.length });
    } catch (error) {
      console.error(`Error fetching subscriptions for account ${req.params.accountId}:`, error);
      res.status(500).json({ error: "Failed to fetch enterprise subscriptions" });
    }
  });

  // Get all account names with active subscriptions
  router.get("/accounts-with-subscriptions", async (_req: Request, res: Response) => {
    try {
      const accountNames = await salesforce.getAccountsWithActiveSubscriptions();
      res.json({ accountNames, count: accountNames.length });
    } catch (error) {
      console.error("Error fetching accounts with subscriptions:", error);
      res.status(500).json({ error: "Failed to fetch accounts with subscriptions" });
    }
  });

  // Get renewal opportunities for the next N days (default 180)
  router.get("/renewals", async (req: Request, res: Response) => {
    try {
      const daysAhead = parseInt(req.query.days as string) || 180;
      const opportunities = await salesforce.getRenewalOpportunities(daysAhead);
      res.json({ opportunities, count: opportunities.length });
    } catch (error) {
      console.error("Error fetching renewal opportunities:", error);
      res.status(500).json({ error: "Failed to fetch renewal opportunities" });
    }
  });

  // Find PRS-related fields on Account and Opportunity objects
  router.get("/find-prs-fields", async (_req: Request, res: Response) => {
    try {
      const result = await salesforce.findPRSFields();
      res.json(result);
    } catch (error) {
      console.error("Error finding PRS fields:", error);
      res.status(500).json({ error: "Failed to find PRS fields" });
    }
  });

  return router;
}
