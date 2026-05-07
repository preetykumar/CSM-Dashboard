import { Router, Request, Response } from "express";
import { KantataService, KantataProject } from "../services/kantata.js";
import { SalesforceService, AccountTeamRoles, AccountTeamUser } from "../services/salesforce.js";
import { kantataCache } from "../services/cache.js";

export interface ActiveProject {
  // identity
  id: string;
  title: string;
  url: string;
  // account linkage
  accountId: string | null;
  accountName: string | null;
  // type/budget classification
  budgetType: string | null;
  budgetTypeId: string | null;
  // financials (dollars)
  budget: number | null;
  budgetUsed: number;
  budgetUnused: number | null;
  percentOfBudgetUsed: number;
  // schedule
  startDate: string | null;
  dueDate: string | null;
  daysSinceStart: number | null;
  // contact
  lastCustomerContact: string | null;
  // team
  team: {
    csm: AccountTeamUser | null;
    tsa: AccountTeamUser | null;
    ies: AccountTeamUser[];
    ae: AccountTeamUser | null;
    sdl: AccountTeamUser | null;
  };
  // health
  budgetHealth: "red" | "green";
  scheduleHealth: "red" | "green";
  overallHealth: "red" | "green";
  healthReasons: string[];
  // raw status passthrough (Kantata's own indicator)
  kantataStatus: { color: string; key: number; message: string } | null;
}

export interface ActiveProjectsResponse {
  projects: ActiveProject[];
  count: number;
  redCount: number;
  generatedAt: string;
}

const CACHE_KEY = "active-projects:v1";

function daysBetween(fromIso: string, toMs: number): number {
  const fromMs = new Date(fromIso + (fromIso.length === 10 ? "T00:00:00Z" : "")).getTime();
  if (isNaN(fromMs)) return 0;
  return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

export function buildActiveProjects(
  kantataProjects: KantataProject[],
  teamRoles: Map<string, AccountTeamRoles>,
  oppToAccount: Map<string, string>,
  now: number = Date.now(),
): ActiveProject[] {
  return kantataProjects.map((kp) => {
    // Resolve SF Account ID from the Kantata "SF Salesforce ID" field, which
    // may hold either an Account ID, an Opportunity ID, or a Lightning URL.
    let accountId: string | null = null;
    if (kp.sfRef?.sfId) {
      if (kp.sfRef.objectType === "Account") {
        accountId = kp.sfRef.sfId;
      } else if (kp.sfRef.objectType === "Opportunity") {
        accountId = oppToAccount.get(kp.sfRef.sfId) || null;
      }
    }
    const team = accountId ? teamRoles.get(accountId) : undefined;

    const budgetUsed = (kp.budgetUsedInCents || 0) / 100;
    const budget = kp.priceInCents != null ? kp.priceInCents / 100 : null;
    const budgetUnused = budget != null ? budget - budgetUsed : null;

    const reasons: string[] = [];
    const budgetHealth: "red" | "green" = kp.overBudget ? "red" : "green";
    if (kp.overBudget) {
      reasons.push(`Over budget (${kp.percentOfBudgetUsed.toFixed(0)}% used)`);
    }

    let scheduleHealth: "red" | "green" = "green";
    let daysSinceStart: number | null = null;
    if (kp.startDate) {
      daysSinceStart = daysBetween(kp.startDate, now);
      if (daysSinceStart > 90 && !kp.dueDate) {
        scheduleHealth = "red";
        reasons.push(`Started ${daysSinceStart} days ago, no end date`);
      }
    }

    const overallHealth: "red" | "green" =
      budgetHealth === "red" || scheduleHealth === "red" ? "red" : "green";

    return {
      id: kp.id,
      title: kp.title,
      url: kp.url,
      accountId,
      accountName: team?.accountName || null,
      budgetType: kp.budgetTypeLabel,
      budgetTypeId: kp.budgetTypeId,
      budget,
      budgetUsed,
      budgetUnused,
      percentOfBudgetUsed: kp.percentOfBudgetUsed,
      startDate: kp.startDate,
      dueDate: kp.dueDate,
      daysSinceStart,
      lastCustomerContact: team?.lastActivityDate || null,
      team: {
        csm: team?.csm || null,
        tsa: team?.tsa || null,
        ies: team?.ies || [],
        ae: team?.ae || null,
        sdl: team?.sdl || null,
      },
      budgetHealth,
      scheduleHealth,
      overallHealth,
      healthReasons: reasons,
      kantataStatus: kp.status,
    };
  });
}

export function createProjectsRoutes(kantata: KantataService, salesforce: SalesforceService): Router {
  const router = Router();

  router.get("/active", async (req: Request, res: Response) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true";
      if (!force) {
        const cached = kantataCache.get<ActiveProjectsResponse>(CACHE_KEY);
        if (cached) {
          res.setHeader("Cache-Control", "private, max-age=60");
          res.setHeader("X-Cache", "HIT");
          return res.json(cached);
        }
      }

      console.log("[/api/projects/active] fetching fresh data...");
      const t0 = Date.now();
      const kantataProjects = await kantata.getActiveImplementationProjects();
      const t1 = Date.now();
      console.log(`[/api/projects/active] kantata: ${kantataProjects.length} projects in ${t1 - t0}ms`);

      // Step 1: split SF refs by object type (Account vs Opportunity).
      const directAccountIds = new Set<string>();
      const opportunityIds = new Set<string>();
      for (const p of kantataProjects) {
        if (!p.sfRef?.sfId) continue;
        if (p.sfRef.objectType === "Account") directAccountIds.add(p.sfRef.sfId);
        else if (p.sfRef.objectType === "Opportunity") opportunityIds.add(p.sfRef.sfId);
      }

      // Step 2: resolve Opportunity → AccountId in bulk.
      const oppToAccount = await salesforce.resolveOpportunityAccountIds(Array.from(opportunityIds));
      for (const accId of oppToAccount.values()) directAccountIds.add(accId);
      const t2 = Date.now();
      console.log(`[/api/projects/active] resolved ${oppToAccount.size}/${opportunityIds.size} opps → accounts in ${t2 - t1}ms`);

      // Step 3: fetch team roles for the union of all account IDs.
      const teamRoles = await salesforce.getAccountTeamRoles(Array.from(directAccountIds));
      const t3 = Date.now();
      console.log(`[/api/projects/active] sf team roles for ${directAccountIds.size} accounts in ${t3 - t2}ms`);

      const projects = buildActiveProjects(kantataProjects, teamRoles, oppToAccount).sort((a, b) => {
        // RED first, then by accountName, then by title
        if (a.overallHealth !== b.overallHealth) return a.overallHealth === "red" ? -1 : 1;
        const an = a.accountName || "";
        const bn = b.accountName || "";
        const c = an.localeCompare(bn);
        return c !== 0 ? c : a.title.localeCompare(b.title);
      });

      const response: ActiveProjectsResponse = {
        projects,
        count: projects.length,
        redCount: projects.filter((p) => p.overallHealth === "red").length,
        generatedAt: new Date().toISOString(),
      };

      kantataCache.set(CACHE_KEY, response);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("X-Cache", "MISS");
      return res.json(response);
    } catch (error: any) {
      console.error("Error fetching active projects:", error);
      return res.status(500).json({
        error: "Failed to fetch active projects",
        detail: error.message,
      });
    }
  });

  // Health-check / quick auth probe
  router.get("/kantata-test", async (_req: Request, res: Response) => {
    const result = await kantata.testConnection();
    res.json(result);
  });

  return router;
}
