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
  ProgressStatus,
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

  // ─── Helper: load plan + check edit perms ────────────────────────────────
  async function loadPlanWithPerm(
    planId: number,
    actor: string
  ): Promise<{ plan: DeploymentPlan } | { error: string; status: number }> {
    if (isNaN(planId)) return { error: "Invalid plan id", status: 400 };
    const plan = await db.getDeploymentPlan(planId);
    if (!plan) return { error: "Plan not found", status: 404 };
    if (!canEditPlan(actor, plan)) {
      return {
        error: "You don't have permission to edit this plan (must be TSA, IE, or admin).",
        status: 403,
      };
    }
    return { plan };
  }

  // Recompute the parent's progress_status from its children. Walks bottom-up
  // so deeper ancestors settle before their parents are evaluated.
  // Roll-up rule:
  //   - 0 children → leave as-is
  //   - all children "complete" → "complete"
  //   - any child blocked/at_risk/delayed → bubble that worst signal up
  //   - any child in_progress → "in_progress"
  //   - all children "not_started" → "not_started"
  async function recomputeAncestors(planId: number, startFromParentId: number | null) {
    if (startFromParentId === null) return;
    const all = await db.listDeploymentPlanItems(planId);
    const byId = new Map<number, DeploymentPlanItem>();
    const childrenOf = new Map<number, DeploymentPlanItem[]>();
    for (const it of all) {
      byId.set(it.id, it);
      if (it.parent_id !== null) {
        const arr = childrenOf.get(it.parent_id) || [];
        arr.push(it);
        childrenOf.set(it.parent_id, arr);
      }
    }
    const rollup = (children: DeploymentPlanItem[]): ProgressStatus | null => {
      if (children.length === 0) return null;
      const statuses = children.map((c) => c.progress_status);
      if (statuses.includes("blocked")) return "blocked";
      if (statuses.includes("at_risk")) return "at_risk";
      if (statuses.includes("delayed")) return "delayed";
      if (statuses.every((s) => s === "complete")) return "complete";
      if (statuses.some((s) => s === "in_progress" || s === "complete")) return "in_progress";
      return "not_started";
    };
    let cursor: number | null = startFromParentId;
    while (cursor !== null) {
      const parent = byId.get(cursor);
      if (!parent) break;
      const kids = childrenOf.get(cursor) || [];
      const next = rollup(kids);
      if (next && next !== parent.progress_status) {
        await db.updateDeploymentPlanItem(cursor, { progress_status: next });
        parent.progress_status = next;
      }
      cursor = parent.parent_id;
    }
  }

  // ─── PATCH /api/deployments/plans/:planId/items/:itemId ──────────────────
  // Edit task fields. Body may include any subset of:
  //   progress_status, description, target_outcome, notes,
  //   deque_responsible, customer_responsible,
  //   start_date, end_date, estimated_days, actual_days
  // Empty strings are coerced to null. Status changes also propagate up.
  router.patch(
    "/:planId/items/:itemId",
    requireAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const planId = parseInt(req.params.planId, 10);
        const itemId = parseInt(req.params.itemId, 10);
        if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item id" });
        const actor = actorEmail(req);
        const guard = await loadPlanWithPerm(planId, actor);
        if ("error" in guard) return res.status(guard.status).json({ error: guard.error });

        const before = await db.getDeploymentPlanItem(itemId);
        if (!before || before.plan_id !== planId) {
          return res.status(404).json({ error: "Item not found in this plan" });
        }

        const b = req.body || {};
        const norm = (v: any) => (v === "" ? null : v);
        const updates: Parameters<typeof db.updateDeploymentPlanItem>[1] = {};
        if (b.progress_status !== undefined) updates.progress_status = b.progress_status;
        if (b.description !== undefined) updates.description = b.description;
        if (b.target_outcome !== undefined) updates.target_outcome = norm(b.target_outcome);
        if (b.notes !== undefined) updates.notes = norm(b.notes);
        if (b.deque_responsible !== undefined) updates.deque_responsible = norm(b.deque_responsible);
        if (b.customer_responsible !== undefined) updates.customer_responsible = norm(b.customer_responsible);
        if (b.start_date !== undefined) updates.start_date = norm(b.start_date);
        if (b.end_date !== undefined) updates.end_date = norm(b.end_date);
        if (b.estimated_days !== undefined)
          updates.estimated_days = b.estimated_days === "" || b.estimated_days === null ? null : Number(b.estimated_days);
        if (b.actual_days !== undefined)
          updates.actual_days = b.actual_days === "" || b.actual_days === null ? null : Number(b.actual_days);

        const updated = await db.updateDeploymentPlanItem(itemId, updates);
        if (!updated) return res.status(404).json({ error: "Item disappeared during update" });

        // Build a diff for the audit log. Only record fields that actually changed.
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const k of Object.keys(updates) as Array<keyof typeof updates>) {
          if ((before as any)[k] !== (updated as any)[k]) {
            changed[k] = { from: (before as any)[k], to: (updated as any)[k] };
          }
        }
        const statusChanged = "progress_status" in changed;

        if (Object.keys(changed).length > 0) {
          await db.logDeploymentAudit({
            plan_id: planId,
            plan_item_id: itemId,
            template_id: null,
            template_item_id: null,
            actor_email: actor,
            action: statusChanged ? "plan_item_status_change" : "plan_item_edit",
            details_json: JSON.stringify({
              item_id: updated.item_id,
              description: updated.description,
              changed,
            }),
          });
        }

        if (statusChanged) {
          await recomputeAncestors(planId, updated.parent_id);
        }

        plansCache.clear();
        res.json({ item: updated, changed });
      } catch (e) {
        console.error("updateDeploymentPlanItem failed:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" });
      }
    }
  );

  // ─── POST /api/deployments/plans/:planId/items ───────────────────────────
  // Add a new task to a plan. Body:
  //   {
  //     parent_id: number | null,  // null = top-level item
  //     activity_type: 'milestone' | 'epic' | 'task',
  //     description: string,        // required
  //     item_id?: string,           // optional display id like "4.2"
  //     target_outcome?, notes?, deque_responsible?, customer_responsible?,
  //     start_date?, end_date?, estimated_days?
  //   }
  router.post(
    "/:planId/items",
    requireAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const planId = parseInt(req.params.planId, 10);
        const actor = actorEmail(req);
        const guard = await loadPlanWithPerm(planId, actor);
        if ("error" in guard) return res.status(guard.status).json({ error: guard.error });

        const b = req.body || {};
        if (!b.description || typeof b.description !== "string") {
          return res.status(400).json({ error: "description is required" });
        }
        const activity_type: ActivityType =
          b.activity_type === "milestone" || b.activity_type === "epic" || b.activity_type === "task"
            ? b.activity_type
            : "task";

        const parent_id = b.parent_id === null || b.parent_id === undefined ? null : Number(b.parent_id);
        if (parent_id !== null) {
          const parent = await db.getDeploymentPlanItem(parent_id);
          if (!parent || parent.plan_id !== planId) {
            return res.status(400).json({ error: "parent_id does not belong to this plan" });
          }
        }

        const norm = (v: any) => (v === undefined || v === "" ? null : v);
        const newId = await db.addDeploymentPlanItem({
          plan_id: planId,
          template_item_id: null,
          parent_id,
          item_id: norm(b.item_id),
          activity_type,
          description: b.description,
          target_outcome: norm(b.target_outcome),
          progress_status: "not_started",
          notes: norm(b.notes),
          deque_responsible: norm(b.deque_responsible),
          customer_responsible: norm(b.customer_responsible),
          start_date: norm(b.start_date),
          end_date: norm(b.end_date),
          estimated_days:
            b.estimated_days === undefined || b.estimated_days === null || b.estimated_days === ""
              ? null
              : Number(b.estimated_days),
          actual_days: null,
        });

        const created = await db.getDeploymentPlanItem(newId);
        await db.logDeploymentAudit({
          plan_id: planId,
          plan_item_id: newId,
          template_id: null,
          template_item_id: null,
          actor_email: actor,
          action: "plan_item_create",
          details_json: JSON.stringify({
            parent_id,
            item_id: created?.item_id,
            activity_type,
            description: b.description,
          }),
        });

        // Adding a not_started leaf can only lower parent progress, never raise it.
        // Recompute anyway so a previously "complete" parent gets downgraded.
        await recomputeAncestors(planId, parent_id);

        plansCache.clear();
        res.status(201).json({ item: created });
      } catch (e) {
        console.error("addDeploymentPlanItem failed:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "Add failed" });
      }
    }
  );

  // ─── DELETE /api/deployments/plans/:planId/items/:itemId ─────────────────
  // Deletes the item and all descendants (CASCADE in schema). The parent's
  // progress_status is recomputed after removal.
  router.delete(
    "/:planId/items/:itemId",
    requireAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const planId = parseInt(req.params.planId, 10);
        const itemId = parseInt(req.params.itemId, 10);
        if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item id" });
        const actor = actorEmail(req);
        const guard = await loadPlanWithPerm(planId, actor);
        if ("error" in guard) return res.status(guard.status).json({ error: guard.error });

        const before = await db.getDeploymentPlanItem(itemId);
        if (!before || before.plan_id !== planId) {
          return res.status(404).json({ error: "Item not found in this plan" });
        }

        await db.deleteDeploymentPlanItem(itemId);
        await db.logDeploymentAudit({
          plan_id: planId,
          plan_item_id: null, // row is gone — store the id in details_json instead
          template_id: null,
          template_item_id: null,
          actor_email: actor,
          action: "plan_item_delete",
          details_json: JSON.stringify({
            deleted_item_id: itemId,
            item_id: before.item_id,
            description: before.description,
            activity_type: before.activity_type,
          }),
        });

        await recomputeAncestors(planId, before.parent_id);
        plansCache.clear();
        res.json({ deleted: true, id: itemId });
      } catch (e) {
        console.error("deleteDeploymentPlanItem failed:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "Delete failed" });
      }
    }
  );

  return router;
}
