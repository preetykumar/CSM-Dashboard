import { Router, Request, Response } from "express";
import { SalesforceService } from "../services/salesforce.js";
import { renewalsCache, salesforceCache } from "../services/cache.js";

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

  // List all Salesforce objects, optionally filtered by name
  router.get("/objects", async (req: Request, res: Response) => {
    try {
      const filter = req.query.filter as string | undefined;
      const objects = await salesforce.listObjects(filter);
      res.json({ objects, count: objects.length });
    } catch (error) {
      console.error("Error listing Salesforce objects:", error);
      res.status(500).json({ error: "Failed to list Salesforce objects" });
    }
  });

  // Get enterprise subscriptions by account name (cached 10 min)
  router.get("/subscriptions/account/:accountName", async (req: Request, res: Response) => {
    try {
      const accountName = decodeURIComponent(req.params.accountName);
      const cacheKey = `subs:name:${accountName.toLowerCase()}`;
      const cached = salesforceCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const subscriptions = await salesforce.getEnterpriseSubscriptionsByAccountName(accountName);
      const result = { subscriptions, count: subscriptions.length };
      salesforceCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error(`Error fetching subscriptions for ${req.params.accountName}:`, error);
      res.status(500).json({ error: "Failed to fetch enterprise subscriptions" });
    }
  });

  // Get enterprise subscriptions by account ID (cached 10 min)
  router.get("/subscriptions/id/:accountId", async (req: Request, res: Response) => {
    try {
      const cacheKey = `subs:id:${req.params.accountId}`;
      const cached = salesforceCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const subscriptions = await salesforce.getEnterpriseSubscriptionsByAccountId(req.params.accountId);
      const result = { subscriptions, count: subscriptions.length };
      salesforceCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error(`Error fetching subscriptions for account ${req.params.accountId}:`, error);
      res.status(500).json({ error: "Failed to fetch enterprise subscriptions" });
    }
  });

  // Get all account names with active subscriptions (cached 10 min)
  router.get("/accounts-with-subscriptions", async (_req: Request, res: Response) => {
    try {
      const cacheKey = "accounts-with-subs";
      const cached = salesforceCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const accountNames = await salesforce.getAccountsWithActiveSubscriptions();
      const result = { accountNames, count: accountNames.length };
      salesforceCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching accounts with subscriptions:", error);
      res.status(500).json({ error: "Failed to fetch accounts with subscriptions" });
    }
  });

  // Get renewal opportunities for the next N days (default 180, cached 5 min)
  router.get("/renewals", async (req: Request, res: Response) => {
    try {
      const daysAhead = parseInt(req.query.days as string) || 180;
      const cacheKey = `renewals:${daysAhead}`;
      const cached = renewalsCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const opportunities = await salesforce.getRenewalOpportunities(daysAhead);
      const result = { opportunities, count: opportunities.length };
      renewalsCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching renewal opportunities:", error);
      res.status(500).json({ error: "Failed to fetch renewal opportunities" });
    }
  });

  // Temporary: ad-hoc SOQL query for schema investigation
  router.get("/query", async (req: Request, res: Response) => {
    try {
      const soql = req.query.q as string;
      if (!soql) return res.status(400).json({ error: "Missing q parameter" });
      const records = await salesforce.query(soql);
      res.json({ records, count: records.length });
    } catch (error: any) {
      console.error("SOQL query error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Query failed" });
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
