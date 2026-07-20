import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";
import type { SalesforceService } from "../services/salesforce.js";
import type { KantataService } from "../services/kantata.js";
import { enrichAccountsBatch } from "../services/portfolio-enrichment.js";
import { resolvePortfolio, type Role } from "../services/portfolio-resolver.js";
import { portfolioCache } from "../services/cache.js";

/**
 * POST /api/portfolio/enrich
 * Body: { accountIds: string[] }
 *
 * For each SF account ID, returns the joined downstream data shape used by
 * the portfolio view (Zendesk org/ticket counts, SF contact count, plus
 * stubbed Amplitude/Kantata/Health fields filled in later iterations).
 *
 * Used as a building block by the Phase-1 /api/portfolio endpoint: that
 * endpoint will compute the user's assigned account IDs from SF and then
 * call this enrichment step.
 */
export function createPortfolioRoutes(
  db: IDatabaseService,
  salesforce: SalesforceService | null,
  kantata: KantataService | null = null
): Router {
  const router = Router();

  /**
   * GET /api/portfolio?role=csm&email=mark.washburn@deque.com
   *
   * Returns the role-scoped portfolio as a hierarchical MockPortfolioAccount-shaped
   * tree, with downstream data joined in via Track B enrichment. In production
   * role + email come from the authenticated session; query params are accepted
   * for testing during the wireframe phase.
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      // Phase 1 stub: derive role + email from session in production. For the
      // wireframe we accept them as query params (and fall back to session if missing).
      const queryRole = (req.query.role as string | undefined)?.toLowerCase() as Role | undefined;
      const queryEmail = req.query.email as string | undefined;

      const sessionUser = (req as any).user as { email?: string; role?: string } | undefined;
      const role: Role = queryRole || (sessionUser?.role as Role) || "csm";
      const email = queryEmail || sessionUser?.email || "";

      if (!["csm", "pm", "prs", "tsa", "ie", "admin"].includes(role)) {
        return res.status(400).json({ error: `Invalid role: ${role}` });
      }
      if (role !== "admin" && !email) {
        return res.status(400).json({ error: "email required for non-admin roles" });
      }

      const cacheKey = `portfolio:${role}:${email.toLowerCase()}`;
      const cached = portfolioCache.get<{ portfolio: any; resolvedMs: number }>(cacheKey);

      const t0 = Date.now();
      let portfolio: any;
      let resolvedMs: number;
      let cacheHit = false;

      if (cached) {
        portfolio = cached.portfolio;
        resolvedMs = cached.resolvedMs;
        cacheHit = true;
      } else {
        portfolio = await resolvePortfolio(role, email, db, salesforce, kantata);
        resolvedMs = Date.now() - t0;
        portfolioCache.set(cacheKey, { portfolio, resolvedMs });
      }

      const tookMs = Date.now() - t0;
      res.set("Cache-Control", "public, max-age=60");
      res.json({ ...portfolio, tookMs, resolvedMs, cacheHit });
    } catch (error) {
      console.error("Portfolio resolve failed:", error);
      res.status(500).json({
        error: "Failed to resolve portfolio",
        details: error instanceof Error ? error.message : "Unknown",
      });
    }
  });

  router.post("/enrich", async (req: Request, res: Response) => {
    try {
      const accountIds: unknown = req.body?.accountIds;
      if (!Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: "accountIds (string[]) required" });
      }
      const cleanIds = accountIds.filter(
        (x): x is string => typeof x === "string" && x.length > 0
      );

      const t0 = Date.now();
      const enrichments = await enrichAccountsBatch(cleanIds, db);
      const tookMs = Date.now() - t0;

      // Return as a plain object for JSON serialization (Maps don't serialize).
      const accounts: Record<string, unknown> = {};
      for (const [id, data] of enrichments.entries()) {
        accounts[id] = data;
      }

      res.set("Cache-Control", "public, max-age=120");
      res.json({ accounts, count: enrichments.size, tookMs });
    } catch (error) {
      console.error("Portfolio enrichment failed:", error);
      res.status(500).json({
        error: "Failed to enrich portfolio",
        details: error instanceof Error ? error.message : "Unknown",
      });
    }
  });

  return router;
}
