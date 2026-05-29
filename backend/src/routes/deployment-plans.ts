// Deployment Plans routes (Phase 3a — read + create from template).
//
// All routes return the canonical plan + tree shape. Mutations check
// permissions: the plan's tsa_email or ie_email matches req.user.email,
// or the user is in ADMIN_EMAILS. Otherwise 403.
//
// Write operations log to deployment_audit so we have a full record of
// what changed when and by whom.

import { Router, Request, Response, NextFunction } from "express";
import type {
  IDatabaseService,
  DeploymentPlan,
  DeploymentPlanItem,
  ActivityType,
} from "../services/database-interface.js";
import { MemoryCache } from "../services/cache.js";

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

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.some((a) => a.toLowerCase() === email.toLowerCase());
}

function actorEmail(req: Request): string {
  const user = req.user as { email?: string } | undefined;
  return user?.email || "unknown";
}

// Lazy permission check that runs after we've loaded the plan. Used inline
// by handlers rather than as middleware because we need the plan in scope.
function canEditPlan(actor: string, plan: DeploymentPlan): boolean {
  if (isAdmin(actor)) return true;
  if (plan.tsa_email && plan.tsa_email.toLowerCase() === actor.toLowerCase()) return true;
  if (plan.ie_email && plan.ie_email.toLowerCase() === actor.toLowerCase()) return true;
  return false;
}

// Cached list responses (90s) per filter combination. Same TTL as the rest
// of the Deployments cache surface so refresh feels consistent.
const plansCache = new MemoryCache(90);

interface PlanItemTree extends DeploymentPlanItem {
  children: PlanItemTree[];
}

// Build the parent → children tree from a flat list. Items are already
// sorted by position; we just rewire parent_id pointers into children[].
function buildItemTree(items: DeploymentPlanItem[]): PlanItemTree[] {
  const byId = new Map<number, PlanItemTree>();
  for (const item of items) byId.set(item.id, { ...item, children: [] });
  const roots: PlanItemTree[] = [];
  for (const item of items) {
    const node = byId.get(item.id)!;
    if (item.parent_id !== null && byId.has(item.parent_id)) {
      byId.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Auth must run before any of these. We don't enforce auth here — the
// route mount point should handle that — but for write operations we want a
// real authenticated session, not a session cookie that's expired.
function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  const user = req.user as { email?: string } | undefined;
  if (!user?.email) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export function createDeploymentPlansRoutes(db: IDatabaseService): Router {
  const router = Router();

  // ─── GET /api/deployments/plans ───────────────────────────────────────────
  // Filters: tsa_email, ie_email, account_id, opportunity_id, status.
  // Non-admins see only plans where they are TSA or IE unless they pass a
  // matching email filter.
  router.get("/", async (req: Request, res: Response) => {
    try {
      const actor = (req.user as { email?: string } | undefined)?.email;
      const actorIsAdmin = isAdmin(actor);
      const tsaEmail = typeof req.query.tsa_email === "string" ? req.query.tsa_email : undefined;
      const ieEmail = typeof req.query.ie_email === "string" ? req.query.ie_email : undefined;
      const accountId = typeof req.query.account_id === "string" ? req.query.account_id : undefined;
      const opportunityId = typeof req.query.opportunity_id === "string" ? req.query.opportunity_id : undefined;

      // Default scoping: non-admins without an email filter only see their own plans.
      const effectiveTsa = !actorIsAdmin && !tsaEmail && !ieEmail ? actor : tsaEmail;

      const cacheKey = `plans:${actorIsAdmin ? "admin" : effectiveTsa || actor}:${ieEmail || ""}:${accountId || ""}:${opportunityId || ""}`;
      const cached = plansCache.get<DeploymentPlan[]>(cacheKey);
      if (cached) {
        res.set("Cache-Control", "public, max-age=60");
        return res.json({ plans: cached, count: cached.length, cacheHit: true });
      }

      const plans = await db.listDeploymentPlans({
        tsa_email: effectiveTsa,
        ie_email: ieEmail,
        account_id: accountId,
        opportunity_id: opportunityId,
      });
      plansCache.set(cacheKey, plans);
      res.set("Cache-Control", "public, max-age=60");
      res.json({ plans, count: plans.length, cacheHit: false });
    } catch (e) {
      console.error("listDeploymentPlans failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "List failed" });
    }
  });

  // ─── GET /api/deployments/plans/:id ──────────────────────────────────────
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const plan = await db.getDeploymentPlan(id);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      const items = await db.listDeploymentPlanItems(id);

      const actor = (req.user as { email?: string } | undefined)?.email;
      const canEdit = canEditPlan(actor || "", plan);

      res.json({
        plan,
        items,
        tree: buildItemTree(items),
        canEdit,
      });
    } catch (e) {
      console.error("getDeploymentPlan failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Get failed" });
    }
  });

  // ─── POST /api/deployments/plans ─────────────────────────────────────────
  // Create a plan from a template. Body:
  //   {
  //     template_id, opportunity_id, opportunity_name, product,
  //     account_id, account_name, tsa_email, ie_email
  //   }
  // The actor must either be the named tsa_email/ie_email or an admin.
  // Items are cloned from the template into deployment_plan_items in one tx.
  router.post("/", requireAuthenticated, async (req: Request, res: Response) => {
    try {
      const actor = actorEmail(req);
      const b = req.body || {};

      // Required fields
      const required = ["template_id", "opportunity_id", "product", "account_id"];
      for (const k of required) {
        if (!b[k]) return res.status(400).json({ error: `${k} is required` });
      }

      const tsaEmail = b.tsa_email || null;
      const ieEmail = b.ie_email || null;

      // Permission: actor must be TSA, IE, or admin.
      const wouldBeAllowedAfterCreate =
        isAdmin(actor) ||
        (tsaEmail && tsaEmail.toLowerCase() === actor.toLowerCase()) ||
        (ieEmail && ieEmail.toLowerCase() === actor.toLowerCase());
      if (!wouldBeAllowedAfterCreate) {
        return res.status(403).json({
          error:
            "You can only create a plan where you are the TSA or IE (or be an admin). Set tsa_email or ie_email to your own email.",
        });
      }

      // Template must exist + items snapshotted at this moment.
      const template = await db.getDeploymentTemplate(b.template_id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      const templateItems = await db.listDeploymentTemplateItems(b.template_id);

      // Block duplicate plan for the same (opp, product) combo.
      const existing = await db.listDeploymentPlans({
        opportunity_id: b.opportunity_id,
      });
      const dupe = existing.find((p) => p.product === b.product);
      if (dupe) {
        return res.status(409).json({
          error: `A plan already exists for opportunity ${b.opportunity_id} + product ${b.product} (plan ${dupe.id}). Use that plan or delete it first.`,
        });
      }

      const planId = await db.createDeploymentPlanFromTemplate(
        {
          template_id: b.template_id,
          opportunity_id: b.opportunity_id,
          opportunity_name: b.opportunity_name || null,
          product: b.product,
          account_id: b.account_id,
          account_name: b.account_name || null,
          tsa_email: tsaEmail,
          ie_email: ieEmail,
          status: "not_started",
          created_by: actor,
        },
        templateItems
      );

      await db.logDeploymentAudit({
        plan_id: planId,
        plan_item_id: null,
        template_id: b.template_id,
        template_item_id: null,
        actor_email: actor,
        action: "plan_create",
        details_json: JSON.stringify({
          template_id: b.template_id,
          template_name: template.name,
          template_version: template.version,
          item_count: templateItems.length,
        }),
      });

      plansCache.clear(); // any cached list view is now stale
      const created = await db.getDeploymentPlan(planId);
      res.status(201).json({ plan: created });
    } catch (e) {
      console.error("createDeploymentPlan failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Create failed" });
    }
  });

  return router;
}

// Keep ActivityType import live (used by future PATCH/POST item routes).
void (null as ActivityType | null);
