// Admin routes for deployment templates (Phase 2).
//
// Admin-only — see ADMIN_EMAILS list. Returns 403 for non-admin sessions.
//
// Endpoints (all under /api/admin/deployment-templates):
//   GET    /                     → list templates (filter ?product&deployment_type&is_active)
//   GET    /:id                  → get template header + items as a tree
//   POST   /                     → create template + items (body: { template, items })
//   PATCH  /:id                  → update header (name, description, is_active)
//   POST   /:id/items            → add a new item
//   PATCH  /:id/items/:itemId    → edit an item
//   DELETE /:id/items/:itemId    → delete an item (cascade deletes children)
//
// Every mutating call writes an entry to deployment_audit with the actor's email.

import { Router, Request, Response, NextFunction } from "express";
import type {
  IDatabaseService,
  DeploymentTemplate,
  DeploymentTemplateItem,
  DeploymentTemplateItemTree,
  DeploymentType,
  ActivityType,
} from "../services/database-interface.js";

// Admin allow-list (mirrored from auth.ts — keep in sync if that list changes).
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

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as { email?: string } | undefined;
  if (!isAdmin(user?.email)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function actorEmail(req: Request): string {
  const user = req.user as { email?: string } | undefined;
  return user?.email || "unknown";
}

// Build a tree of items from a flat list (items already sorted by position).
function buildTree(items: DeploymentTemplateItem[]): DeploymentTemplateItemTree[] {
  const byId = new Map<number, DeploymentTemplateItemTree>();
  const roots: DeploymentTemplateItemTree[] = [];
  for (const item of items) {
    byId.set(item.id, { ...item, children: [] });
  }
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

// ─── Input validation (minimal but enough to catch malformed POSTs) ──────

const VALID_DEPLOYMENT_TYPES: DeploymentType[] = ["cloud", "on_prem"];
const VALID_ACTIVITY_TYPES: ActivityType[] = ["milestone", "epic", "task"];

function validateTemplatePayload(body: any): { ok: true; data: any } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body required" };
  const t = body.template;
  if (!t || typeof t !== "object") return { ok: false, error: "template object required" };
  if (typeof t.product !== "string" || !t.product) return { ok: false, error: "template.product required" };
  if (!VALID_DEPLOYMENT_TYPES.includes(t.deployment_type)) {
    return { ok: false, error: `template.deployment_type must be one of ${VALID_DEPLOYMENT_TYPES.join("|")}` };
  }
  if (typeof t.name !== "string" || !t.name) return { ok: false, error: "template.name required" };
  if (!Array.isArray(body.items)) return { ok: false, error: "items array required" };
  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    if (typeof it.item_id !== "string" || !it.item_id) return { ok: false, error: `items[${i}].item_id required` };
    if (!VALID_ACTIVITY_TYPES.includes(it.activity_type)) {
      return { ok: false, error: `items[${i}].activity_type invalid` };
    }
    if (typeof it.description !== "string" || !it.description) return { ok: false, error: `items[${i}].description required` };
    if (it.parent_index !== null && (typeof it.parent_index !== "number" || it.parent_index >= i)) {
      return { ok: false, error: `items[${i}].parent_index must be null or a smaller index` };
    }
  }
  return { ok: true, data: body };
}

function validateItemPayload(body: any): { ok: true } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "body required" };
  if (typeof body.item_id !== "string" || !body.item_id) return { ok: false, error: "item_id required" };
  if (!VALID_ACTIVITY_TYPES.includes(body.activity_type)) return { ok: false, error: "activity_type invalid" };
  if (typeof body.description !== "string" || !body.description) return { ok: false, error: "description required" };
  return { ok: true };
}

export function createAdminTemplatesRoutes(db: IDatabaseService): Router {
  const router = Router();

  router.use(requireAdmin);

  // ─── List templates ─────────────────────────────────────────────────────
  router.get("/", async (req: Request, res: Response) => {
    try {
      const product = typeof req.query.product === "string" ? req.query.product : undefined;
      const deployment_type =
        typeof req.query.deployment_type === "string" &&
        VALID_DEPLOYMENT_TYPES.includes(req.query.deployment_type as DeploymentType)
          ? (req.query.deployment_type as DeploymentType)
          : undefined;
      const is_active =
        req.query.is_active === "true"
          ? true
          : req.query.is_active === "false"
          ? false
          : undefined;

      const templates = await db.listDeploymentTemplates({ product, deployment_type, is_active });
      // Attach item counts for the list view (cheap aggregation).
      const withCounts = await Promise.all(
        templates.map(async (t) => {
          const items = await db.listDeploymentTemplateItems(t.id);
          return { ...t, item_count: items.length };
        })
      );
      res.json({ templates: withCounts });
    } catch (e) {
      console.error("listDeploymentTemplates failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "List failed" });
    }
  });

  // ─── Get template + items as tree ───────────────────────────────────────
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const template = await db.getDeploymentTemplate(id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      const items = await db.listDeploymentTemplateItems(id);
      res.json({ template, items, tree: buildTree(items) });
    } catch (e) {
      console.error("getDeploymentTemplate failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Get failed" });
    }
  });

  // ─── Create template + items ────────────────────────────────────────────
  router.post("/", async (req: Request, res: Response) => {
    try {
      const validation = validateTemplatePayload(req.body);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const { template: t, items } = validation.data;

      // Auto-increment version: if (product, deployment_type) already has rows, pick max(version) + 1.
      const existing = await db.listDeploymentTemplates({
        product: t.product,
        deployment_type: t.deployment_type,
      });
      const nextVersion = existing.length > 0 ? Math.max(...existing.map((e: DeploymentTemplate) => e.version)) + 1 : 1;
      // Deactivate previous active version(s) — only one active per (product, deployment_type).
      for (const prev of existing) {
        if (prev.is_active) {
          await db.updateDeploymentTemplate(prev.id, { is_active: false });
        }
      }

      const newId = await db.createDeploymentTemplate(
        {
          product: t.product,
          deployment_type: t.deployment_type,
          name: t.name,
          version: nextVersion,
          is_active: t.is_active !== false,
          description: t.description || null,
          source_file: t.source_file || null,
          created_by: actorEmail(req),
        },
        items.map((it: any, idx: number) => ({
          item_id: it.item_id,
          position: typeof it.position === "number" ? it.position : idx,
          activity_type: it.activity_type,
          description: it.description,
          target_outcome: it.target_outcome || null,
          default_deque_role: it.default_deque_role || null,
          default_estimated_days: it.default_estimated_days ?? null,
          notes: it.notes || null,
          parent_index: it.parent_index ?? null,
        }))
      );

      await db.logDeploymentAudit({
        template_id: newId,
        template_item_id: null,
        plan_id: null,
        plan_item_id: null,
        actor_email: actorEmail(req),
        action: "template_create",
        details_json: JSON.stringify({
          version: nextVersion,
          item_count: items.length,
          source_file: t.source_file || null,
        }),
      });

      const created = await db.getDeploymentTemplate(newId);
      res.status(201).json({ template: created });
    } catch (e) {
      console.error("createDeploymentTemplate failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Create failed" });
    }
  });

  // ─── Update template header ─────────────────────────────────────────────
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const existing = await db.getDeploymentTemplate(id);
      if (!existing) return res.status(404).json({ error: "Template not found" });

      const updates: { name?: string; description?: string | null; is_active?: boolean } = {};
      if (typeof req.body.name === "string") updates.name = req.body.name;
      if (typeof req.body.description === "string" || req.body.description === null) updates.description = req.body.description;
      if (typeof req.body.is_active === "boolean") updates.is_active = req.body.is_active;

      await db.updateDeploymentTemplate(id, updates);

      await db.logDeploymentAudit({
        template_id: id,
        template_item_id: null,
        plan_id: null,
        plan_item_id: null,
        actor_email: actorEmail(req),
        action:
          updates.is_active !== undefined && updates.is_active !== existing.is_active
            ? updates.is_active
              ? "template_activate"
              : "template_deactivate"
            : "template_edit",
        details_json: JSON.stringify({ before: existing, after: updates }),
      });

      const updated = await db.getDeploymentTemplate(id);
      res.json({ template: updated });
    } catch (e) {
      console.error("updateDeploymentTemplate failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" });
    }
  });

  // ─── Add item ───────────────────────────────────────────────────────────
  router.post("/:id/items", async (req: Request, res: Response) => {
    try {
      const templateId = parseInt(req.params.id, 10);
      if (isNaN(templateId)) return res.status(400).json({ error: "Invalid template id" });
      const tpl = await db.getDeploymentTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: "Template not found" });

      const v = validateItemPayload(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });

      // Determine position: append to end of siblings (max position + 1 among items with same parent_id).
      const allItems = await db.listDeploymentTemplateItems(templateId);
      const parentId = req.body.parent_id === undefined ? null : req.body.parent_id;
      const siblingPositions = allItems
        .filter((i) => i.parent_id === parentId)
        .map((i) => i.position);
      const nextPosition = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : allItems.length;

      const itemId = await db.addDeploymentTemplateItem({
        template_id: templateId,
        parent_id: parentId,
        item_id: req.body.item_id,
        position: nextPosition,
        activity_type: req.body.activity_type,
        description: req.body.description,
        target_outcome: req.body.target_outcome || null,
        default_deque_role: req.body.default_deque_role || null,
        default_estimated_days: req.body.default_estimated_days ?? null,
        notes: req.body.notes || null,
      });

      await db.logDeploymentAudit({
        template_id: templateId,
        template_item_id: itemId,
        plan_id: null,
        plan_item_id: null,
        actor_email: actorEmail(req),
        action: "item_create",
        details_json: JSON.stringify({ item_id: req.body.item_id, description: req.body.description }),
      });

      res.status(201).json({ id: itemId });
    } catch (e) {
      console.error("addDeploymentTemplateItem failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Add item failed" });
    }
  });

  // ─── Edit item ──────────────────────────────────────────────────────────
  router.patch("/:id/items/:itemId", async (req: Request, res: Response) => {
    try {
      const templateId = parseInt(req.params.id, 10);
      const itemId = parseInt(req.params.itemId, 10);
      if (isNaN(templateId) || isNaN(itemId)) return res.status(400).json({ error: "Invalid id" });

      const items = await db.listDeploymentTemplateItems(templateId);
      const existing = items.find((i) => i.id === itemId);
      if (!existing) return res.status(404).json({ error: "Item not found in this template" });

      const updates: any = {};
      const editable = [
        "item_id",
        "position",
        "activity_type",
        "description",
        "target_outcome",
        "default_deque_role",
        "default_estimated_days",
        "notes",
        "parent_id",
      ];
      for (const key of editable) {
        if (req.body[key] !== undefined) {
          if (key === "activity_type" && !VALID_ACTIVITY_TYPES.includes(req.body[key])) {
            return res.status(400).json({ error: "activity_type invalid" });
          }
          updates[key] = req.body[key];
        }
      }

      await db.updateDeploymentTemplateItem(itemId, updates);

      await db.logDeploymentAudit({
        template_id: templateId,
        template_item_id: itemId,
        plan_id: null,
        plan_item_id: null,
        actor_email: actorEmail(req),
        action: "item_edit",
        details_json: JSON.stringify({ before: existing, after: updates }),
      });

      res.json({ ok: true });
    } catch (e) {
      console.error("updateDeploymentTemplateItem failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Update item failed" });
    }
  });

  // ─── Delete item (cascades to children via FK ON DELETE CASCADE) ────────
  router.delete("/:id/items/:itemId", async (req: Request, res: Response) => {
    try {
      const templateId = parseInt(req.params.id, 10);
      const itemId = parseInt(req.params.itemId, 10);
      if (isNaN(templateId) || isNaN(itemId)) return res.status(400).json({ error: "Invalid id" });

      const items = await db.listDeploymentTemplateItems(templateId);
      const existing = items.find((i) => i.id === itemId);
      if (!existing) return res.status(404).json({ error: "Item not found in this template" });

      await db.deleteDeploymentTemplateItem(itemId);

      await db.logDeploymentAudit({
        template_id: templateId,
        template_item_id: null,
        plan_id: null,
        plan_item_id: null,
        actor_email: actorEmail(req),
        action: "item_delete",
        details_json: JSON.stringify({ deleted: existing }),
      });

      res.json({ ok: true });
    } catch (e) {
      console.error("deleteDeploymentTemplateItem failed:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Delete item failed" });
    }
  });

  return router;
}
