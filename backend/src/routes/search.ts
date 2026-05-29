// Global search route. GET /api/search?q=<query>[&types=a,b][&limit=n]
//
// Scoped to the caller's portfolio. Admins see every entity in the system;
// every other authenticated user sees only what they own (per
// resolvePortfolio). No anonymous access — searchable surface includes plans
// + opps that we don't want to leak.

import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";
import type { SalesforceService } from "../services/salesforce.js";
import type { KantataService } from "../services/kantata.js";
import { search, type SearchResultType } from "../services/search.js";
import type { Role } from "../services/portfolio-resolver.js";

const ADMIN_EMAILS = [
  "katile.olsen@deque.com",
  "neel.sinha@deque.com",
  "preety.kumar@deque.com",
  "sujasree.kurapati@deque.com",
  "anik.ganguly@deque.com",
  "dylan.barrell@deque.com",
  "mike.farrell@deque.com",
  "eric.padron@deque.com",
  "ian.flanagan@deque.com",
];

function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.some((a) => a.toLowerCase() === email.toLowerCase());
}

const VALID_TYPES = new Set<SearchResultType>(["account", "opportunity", "plan", "template", "org"]);

export function createSearchRoutes(
  db: IDatabaseService,
  salesforce: SalesforceService | null,
  kantata: KantataService | null,
): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const user = req.user as { email?: string; role?: string } | undefined;
      if (!user?.email) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (q.length === 0) {
        return res.json({ results: [], count: 0 });
      }

      // Parse types filter. Allow comma OR semicolon (legacy convention from
      // GITHUB_PROJECT_NUMBERS handling). Whitespace tolerated.
      const typesParam = typeof req.query.types === "string" ? req.query.types : "";
      let types: SearchResultType[] | undefined;
      if (typesParam) {
        types = typesParam
          .split(/[,;]/)
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is SearchResultType => VALID_TYPES.has(s as SearchResultType));
        if (types.length === 0) types = undefined;
      }

      const limit = (() => {
        const raw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
        return isNaN(raw) ? 20 : Math.min(Math.max(raw, 1), 100);
      })();

      const isAdmin = isAdminEmail(user.email);
      const role: Role = (user.role as Role) || "csm";

      const t0 = Date.now();
      const { results, indexHit } = await search({
        q,
        types,
        limit,
        role,
        email: user.email,
        isAdmin,
        db,
        salesforce,
        kantata,
      });
      const took = Date.now() - t0;

      // Cache headers — let the browser short-circuit duplicate keystrokes
      // (e.g. user backspaces then re-types the same string).
      res.set("Cache-Control", "private, max-age=30");
      res.json({ results, count: results.length, indexHit, tookMs: took });
    } catch (e) {
      console.error("[search] failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Search failed" });
    }
  });

  return router;
}
