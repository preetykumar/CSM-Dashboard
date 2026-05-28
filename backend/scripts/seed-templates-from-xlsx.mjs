// Seed deployment templates from Monitor playbook xlsx files.
//
// Reads two files, normalizes data-quality issues (commas→dots, missing types,
// orphan rows, the OnPrem SSL/TLS row missing an ID), then inserts into the
// deployment_templates + deployment_template_items tables.
//
// Usage:
//   node backend/scripts/seed-templates-from-xlsx.mjs               # SQLite
//   PG_DATABASE=csm_dashboard node backend/scripts/seed-templates-from-xlsx.mjs   # PostgreSQL
//   node backend/scripts/seed-templates-from-xlsx.mjs --dry-run     # parse + print, no DB writes
//   node backend/scripts/seed-templates-from-xlsx.mjs --force       # overwrite existing v1 (deactivate then insert v2)
//
// Idempotency: if (product, deployment_type, version=1) already exists, the script
// skips that template and prints a hint. Use --force to create a new version.

import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const USE_PG = !!(process.env.PG_DATABASE || process.env.INSTANCE_CONNECTION_NAME);

const TEMPLATES = [
  {
    file: "axe-monitor-SaaS-post-sale-implementation-playbook pK edits.xlsx",
    product: "axe-monitor",
    deployment_type: "cloud",
    name: "Axe Monitor SaaS Playbook",
    description: "Post-sale implementation playbook for SaaS / private cloud deployments of Axe Monitor.",
  },
  {
    file: "axe-monitor-onprem-sale-implementation-playbook with pK edits.xlsx",
    product: "axe-monitor",
    deployment_type: "on_prem",
    name: "Axe Monitor On-Prem Playbook",
    description: "Implementation playbook for on-premises deployments of Axe Monitor (including hardware/DB/server install).",
  },
];

// ─── xlsx → cell text helper ─────────────────────────────────────────────

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value.richText) return value.richText.map((r) => r.text).join("");
  if (typeof value === "object" && value.text) return value.text;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// ─── ID normalization & hierarchy ────────────────────────────────────────

// Normalize separators: commas in IDs (e.g. "2,4") were a typo for dots.
// Also collapse whitespace and strip surrounding quotes.
function normalizeId(raw) {
  return raw.replace(/,/g, ".").replace(/\s+/g, "").trim();
}

// "2.14.1" → ["2", "2.14", "2.14.1"] (ancestor chain).
// Used to figure out parent_index for the seeder.
function parentKey(id) {
  const parts = id.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

// ─── Activity type normalization ─────────────────────────────────────────

function normalizeActivityType(raw, ctx) {
  const v = raw.trim().toLowerCase();
  if (v === "milestone") return "milestone";
  if (v === "epic") return "epic";
  if (v === "task") return "task";
  // Empty Activity Type → default to Task. This handles SaaS [2.10] and
  // OnPrem [2.12]/[2.13]/[2.15] which were left blank in the xlsx.
  return "task";
}

// ─── Parse one xlsx into normalized rows ─────────────────────────────────

async function parseTemplateFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];

  // Track ID auto-assignment for missing-ID rows (e.g. OnPrem SSL/TLS row).
  // Strategy: if a row has no ID but the previous row's ID matches the pattern
  // "X.Y.N", assign next sibling "X.Y.(N+1)". Otherwise skip with a warning.
  let lastSeenId = null;

  const rawRows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const id = cellText(row.getCell(1).value).trim();
    const desc = cellText(row.getCell(2).value).replace(/\s+/g, " ").trim();
    const type = cellText(row.getCell(3).value).trim();
    const outcome = cellText(row.getCell(4).value).trim();
    const notes = cellText(row.getCell(6).value).trim();
    const estDays = cellText(row.getCell(11).value).trim();

    // Skip rows with no ID AND no description (truly empty).
    if (!id && !desc) continue;
    // Skip orphan rows: has ID but no description (e.g. SaaS [2.2.6]).
    if (id && !desc) {
      console.log(`  ⏭  Skipping orphan row [id=${id}] with empty description`);
      continue;
    }

    rawRows.push({ raw_id: id, desc, type, outcome, notes, estDays });
  }

  // First pass: normalize IDs and infer missing ones.
  const rows = [];
  for (const r of rawRows) {
    let id = r.raw_id ? normalizeId(r.raw_id) : "";
    if (!id) {
      // Try to infer from previous row's ID (next sibling).
      if (lastSeenId) {
        const parts = lastSeenId.split(".");
        const last = parts[parts.length - 1];
        const n = parseInt(last, 10);
        if (!isNaN(n)) {
          parts[parts.length - 1] = String(n + 1);
          id = parts.join(".");
          console.log(`  🔧 Inferred ID ${id} for row "${r.desc.slice(0, 50)}…"`);
        }
      }
      if (!id) {
        console.log(`  ⚠  Could not infer ID for row "${r.desc.slice(0, 50)}…", skipping`);
        continue;
      }
    }
    lastSeenId = id;

    let activity_type = normalizeActivityType(r.type, { id, desc: r.desc });
    // Targeted fixes documented in the proposal:
    // OnPrem [2.5] "Customer Prep Completed" was mis-typed as Task → should be Epic.
    if (r.desc.toLowerCase().includes("customer prep completed") && activity_type === "task") {
      console.log(`  🔧 Forcing [${id}] "${r.desc.slice(0, 40)}…" Task → Epic`);
      activity_type = "epic";
    }

    rows.push({
      item_id: id,
      activity_type,
      description: r.desc,
      target_outcome: r.outcome || null,
      default_estimated_days: r.estDays ? parseInt(r.estDays, 10) || null : null,
      notes: r.notes || null,
    });
  }

  // Second pass: assign position (sort) by source-file order; compute parent_index.
  // Items are emitted in original sheet order; parent must come before child.
  const itemsById = new Map();
  for (let i = 0; i < rows.length; i++) {
    itemsById.set(rows[i].item_id, i);
  }

  const finalItems = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const parentKeyStr = parentKey(row.item_id);
    let parent_index = null;
    if (parentKeyStr) {
      const idx = itemsById.get(parentKeyStr);
      if (idx === undefined) {
        // Parent doesn't exist in the file — leave as top-level. Could happen
        // if intermediate level (e.g. "2.14") was skipped while children exist.
        console.log(`  ⚠  [${row.item_id}] parent "${parentKeyStr}" not found, treating as top-level`);
      } else if (idx >= i) {
        console.log(`  ⚠  [${row.item_id}] parent appears AFTER child in file, treating as top-level`);
      } else {
        parent_index = idx;
      }
    }
    finalItems.push({
      ...row,
      position: i,
      parent_index,
    });
  }

  return finalItems;
}

// ─── DB insertion (SQLite or PG) ─────────────────────────────────────────

async function insertTemplate(db, meta, items, sourceFile) {
  // Check existing version
  const existing = await db.findTemplate(meta.product, meta.deployment_type);
  let version = 1;
  if (existing) {
    if (!FORCE) {
      console.log(`  ⏭  Template ${meta.product}/${meta.deployment_type} v${existing.version} already exists. Use --force to create v${existing.version + 1}.`);
      return null;
    }
    version = existing.version + 1;
    console.log(`  🔁 --force: creating v${version} (existing v${existing.version} will remain but be deactivated)`);
    await db.deactivateTemplate(existing.id);
  }

  const templateId = await db.createTemplate({
    product: meta.product,
    deployment_type: meta.deployment_type,
    name: meta.name + (version > 1 ? ` v${version}` : ""),
    version,
    is_active: true,
    description: meta.description,
    source_file: sourceFile,
    created_by: "seed-script",
  }, items);

  await db.logAudit({
    template_id: templateId,
    template_item_id: null,
    plan_id: null,
    plan_item_id: null,
    actor_email: "seed-script",
    action: "template_create",
    details_json: JSON.stringify({ source_file: sourceFile, item_count: items.length, version }),
  });

  return templateId;
}

// ─── SQLite adapter ──────────────────────────────────────────────────────

function makeSqliteAdapter() {
  const dbPath = path.join(REPO_ROOT, "backend/data/zendesk-cache.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  return {
    label: `SQLite at ${dbPath}`,
    findTemplate(product, deployment_type) {
      const row = db.prepare(
        "SELECT id, version FROM deployment_templates WHERE product = ? AND deployment_type = ? AND is_active = 1 ORDER BY version DESC LIMIT 1"
      ).get(product, deployment_type);
      return row || null;
    },
    deactivateTemplate(id) {
      db.prepare("UPDATE deployment_templates SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    },
    createTemplate(tpl, items) {
      const txn = db.transaction(() => {
        const r = db.prepare(
          `INSERT INTO deployment_templates
            (product, deployment_type, name, version, is_active, description, source_file, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(tpl.product, tpl.deployment_type, tpl.name, tpl.version, tpl.is_active ? 1 : 0, tpl.description, tpl.source_file, tpl.created_by);
        const templateId = r.lastInsertRowid;
        const insertItem = db.prepare(
          `INSERT INTO deployment_template_items
            (template_id, parent_id, item_id, position, activity_type, description,
             target_outcome, default_deque_role, default_estimated_days, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const dbIds = [];
        for (const it of items) {
          const parentId = it.parent_index !== null ? dbIds[it.parent_index] : null;
          const ir = insertItem.run(
            templateId, parentId, it.item_id, it.position, it.activity_type,
            it.description, it.target_outcome, null, it.default_estimated_days, it.notes
          );
          dbIds.push(ir.lastInsertRowid);
        }
        return templateId;
      });
      return txn();
    },
    logAudit(entry) {
      db.prepare(
        `INSERT INTO deployment_audit
          (plan_id, plan_item_id, template_id, template_item_id, actor_email, action, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(entry.plan_id, entry.plan_item_id, entry.template_id, entry.template_item_id, entry.actor_email, entry.action, entry.details_json);
    },
    close() {
      db.close();
    },
  };
}

// ─── Postgres adapter ────────────────────────────────────────────────────

async function makePgAdapter() {
  const { Pool } = pg;
  const pool = new Pool({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DATABASE || "csm_dashboard",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
  });

  return {
    label: `PostgreSQL ${process.env.PG_HOST || "localhost"}/${process.env.PG_DATABASE || "csm_dashboard"}`,
    async findTemplate(product, deployment_type) {
      const r = await pool.query(
        "SELECT id, version FROM deployment_templates WHERE product = $1 AND deployment_type = $2 AND is_active = TRUE ORDER BY version DESC LIMIT 1",
        [product, deployment_type]
      );
      return r.rows[0] || null;
    },
    async deactivateTemplate(id) {
      await pool.query("UPDATE deployment_templates SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    },
    async createTemplate(tpl, items) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          `INSERT INTO deployment_templates
            (product, deployment_type, name, version, is_active, description, source_file, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [tpl.product, tpl.deployment_type, tpl.name, tpl.version, tpl.is_active, tpl.description, tpl.source_file, tpl.created_by]
        );
        const templateId = parseInt(r.rows[0].id, 10);
        const dbIds = [];
        for (const it of items) {
          const parentId = it.parent_index !== null ? dbIds[it.parent_index] : null;
          const ir = await client.query(
            `INSERT INTO deployment_template_items
              (template_id, parent_id, item_id, position, activity_type, description,
               target_outcome, default_deque_role, default_estimated_days, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [templateId, parentId, it.item_id, it.position, it.activity_type,
             it.description, it.target_outcome, null, it.default_estimated_days, it.notes]
          );
          dbIds.push(parseInt(ir.rows[0].id, 10));
        }
        await client.query("COMMIT");
        return templateId;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async logAudit(entry) {
      await pool.query(
        `INSERT INTO deployment_audit
          (plan_id, plan_item_id, template_id, template_item_id, actor_email, action, details_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.plan_id, entry.plan_item_id, entry.template_id, entry.template_item_id, entry.actor_email, entry.action, entry.details_json]
      );
    },
    async close() {
      await pool.end();
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────

console.log(`\nSeeding Monitor templates ${DRY_RUN ? "(DRY RUN)" : ""}`);
console.log(`Backend: ${USE_PG ? "PostgreSQL" : "SQLite"}\n`);

const db = DRY_RUN ? null : (USE_PG ? await makePgAdapter() : makeSqliteAdapter());
if (db) console.log(`Connected: ${db.label}\n`);

for (const tpl of TEMPLATES) {
  const filePath = path.join(REPO_ROOT, "templates", tpl.file);
  console.log(`─── ${tpl.name} (${tpl.deployment_type}) ──────────────────────`);
  console.log(`File: ${tpl.file}`);

  const items = await parseTemplateFile(filePath);
  console.log(`Parsed ${items.length} items`);

  if (DRY_RUN) {
    console.log(`\nFirst 5 normalized items:`);
    for (const it of items.slice(0, 5)) {
      const parent = it.parent_index !== null ? ` (under #${it.parent_index})` : "";
      console.log(`  [${it.item_id.padEnd(8)}] ${it.activity_type.padEnd(10)} ${it.description.slice(0, 50)}${parent}`);
    }
    console.log();
    continue;
  }

  const templateId = await insertTemplate(db, tpl, items, tpl.file);
  if (templateId) {
    console.log(`  ✓ Created template id=${templateId} with ${items.length} items\n`);
  }
}

if (db) await db.close();
console.log("Done.");
