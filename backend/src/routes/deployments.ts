// Deployments view backend routes.
//
// Phase 1: GET /api/deployments?role=tsa&email=<email>
//   Returns the per-TSA hierarchical tree (customer → opp → product) with
//   Kantata budget at the opp level and DEP-* dollars at the product level.
//
// Future phases add:
//   GET    /api/deployments/instances/:id
//   POST   /api/deployments/instances
//   PUT    /api/deployments/instances/:id/tasks/:taskId
//   POST   /api/deployments/instances/:id/tasks
//   DELETE /api/deployments/instances/:id/tasks/:taskId
//   + admin template CRUD under /api/deployment-templates

import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";
import type { SalesforceService } from "../services/salesforce.js";
import type { KantataService, KantataProject } from "../services/kantata.js";
import { getDeploymentTreeForTSA } from "../services/deployment-tree.js";
import { MemoryCache } from "../services/cache.js";

// Response-level cache (90s) keyed by (role, email). Mirrors the
// portfolioCache pattern in routes/portfolio.ts so repeat tab switches are
// instant. Tree assembly hits Kantata + SF caches under the hood; this just
// avoids redoing the merge/sort/derive.
const deploymentsCache = new MemoryCache(90);

export function createDeploymentsRoutes(
  db: IDatabaseService,
  salesforce: SalesforceService | null,
  kantata: KantataService | null = null
): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const queryRole = (req.query.role as string | undefined)?.toLowerCase();
      const queryEmail = req.query.email as string | undefined;

      const sessionUser = (req as any).user as { email?: string; role?: string } | undefined;
      const role = queryRole || sessionUser?.role || "tsa";
      const email = queryEmail || sessionUser?.email || "";

      if (role !== "tsa") {
        return res.status(400).json({
          error: `Only role=tsa supported in v1 (got role=${role}). Other roles ship in v1.5.`,
        });
      }
      if (!email) {
        return res.status(400).json({ error: "email required for role=tsa" });
      }
      if (!salesforce) {
        return res.status(503).json({ error: "Salesforce unavailable" });
      }

      const cacheKey = `deployments:tsa:${email.toLowerCase()}`;
      const cached = deploymentsCache.get<{ tree: any; resolvedMs: number }>(cacheKey);

      const t0 = Date.now();
      let tree: any;
      let resolvedMs: number;
      let cacheHit = false;

      if (cached) {
        tree = cached.tree;
        resolvedMs = cached.resolvedMs;
        cacheHit = true;
      } else {
        tree = await getDeploymentTreeForTSA(email, salesforce, kantata, db);
        resolvedMs = Date.now() - t0;
        deploymentsCache.set(cacheKey, { tree, resolvedMs });
      }

      const tookMs = Date.now() - t0;
      res.set("Cache-Control", "public, max-age=60");
      res.json({ ...tree, tookMs, resolvedMs, cacheHit });
    } catch (error) {
      console.error("Deployments tree failed:", error);
      res.status(500).json({
        error: "Failed to build deployments tree",
        details: error instanceof Error ? error.message : "Unknown",
      });
    }
  });

  // GET /api/deployments/account/:accountId
  // Single-account deployment summary: SF deploy opps + line items with the
  // matching Kantata workspace per opp. Used by the Customer view's
  // "Active Deployments" drill-down tab.
  router.get("/account/:accountId", async (req: Request, res: Response) => {
    try {
      const accountId = req.params.accountId;
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      if (!salesforce) return res.status(503).json({ error: "Salesforce unavailable" });

      const cacheKey = `deployments:account:${accountId}`;
      const cached = deploymentsCache.get<any>(cacheKey);
      if (cached) {
        res.set("Cache-Control", "public, max-age=60");
        return res.json({ ...cached, cacheHit: true });
      }

      const t0 = Date.now();
      const [oppsByAccount, allWorkspaces] = await Promise.all([
        salesforce.getDeploymentOppDetailsByAccount([accountId]),
        kantata ? kantata.getAllActiveProjects() : Promise.resolve([] as KantataProject[]),
      ]);
      const opps = oppsByAccount.get(accountId) || [];

      // Index Kantata workspaces by Opportunity ID (1:1 per spike).
      const wsByOppId = new Map<string, KantataProject>();
      for (const ws of allWorkspaces) {
        if (ws.sfRef?.objectType === "Opportunity" && ws.sfRef.sfId) {
          if (!wsByOppId.has(ws.sfRef.sfId)) wsByOppId.set(ws.sfRef.sfId, ws);
        }
      }

      // Shape into the response. Mirrors DeploymentOppNode but without the
      // product-bucket grouping — the Customer detail tab cares about raw
      // line items grouped under their opportunity.
      const responseOpps = opps.map((opp) => {
        const ws = wsByOppId.get(opp.oppId);
        const kantata = ws
          ? {
              workspaceId: ws.id,
              title: ws.title,
              budget: ws.priceInCents != null ? ws.priceInCents / 100 : null,
              budgetUsed: ws.budgetUsedInCents / 100,
              budgetRemaining: ws.budgetRemaining,
              overBudget: ws.overBudget,
              status: ws.status?.message ?? null,
              effectiveDueDate: ws.effectiveDueDate || ws.dueDate,
              url: ws.url,
            }
          : null;
        return {
          oppId: opp.oppId,
          oppName: opp.oppName,
          closeDate: opp.closeDate,
          lineItems: opp.lineItems,
          kantata,
        };
      });

      // Sort opps by closeDate desc so most recent/active is at the top.
      responseOpps.sort((a, b) => (b.closeDate || "").localeCompare(a.closeDate || ""));

      const payload = {
        accountId,
        opps: responseOpps,
        oppCount: responseOpps.length,
        tookMs: Date.now() - t0,
      };
      deploymentsCache.set(cacheKey, payload);
      res.set("Cache-Control", "public, max-age=60");
      res.json({ ...payload, cacheHit: false });
    } catch (error) {
      console.error("Deployments account detail failed:", error);
      res.status(500).json({
        error: "Failed to load account deployments",
        details: error instanceof Error ? error.message : "Unknown",
      });
    }
  });

  return router;
}
