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
import type { KantataService } from "../services/kantata.js";
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

  return router;
}
