// Right-side slide-in drawer listing audit entries for a plan, optionally
// scoped to one task. Renders each entry as actor + action + parsed details.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { listDeploymentAudit, type DeploymentAuditEntry } from "../../../services/api";
import { Button, LoadingRow, EmptyState, Badge } from "../../ui";

interface Props {
  planId: number;
  // When set, the drawer filters to entries for that one task (plus the
  // plan_create event for context).
  itemId?: number;
  itemLabel?: string; // human label for the title
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  plan_create: "Plan created",
  plan_status_change: "Plan status changed",
  plan_assign: "Plan reassigned",
  plan_item_status_change: "Task status changed",
  plan_item_edit: "Task edited",
  plan_item_create: "Task added",
  plan_item_delete: "Task deleted",
  template_create: "Template created",
  template_edit: "Template edited",
  template_activate: "Template activated",
  template_deactivate: "Template deactivated",
  item_create: "Template item added",
  item_edit: "Template item edited",
  item_delete: "Template item deleted",
};

const ACTION_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  plan_create: "success",
  plan_status_change: "info",
  plan_assign: "info",
  plan_item_status_change: "info",
  plan_item_edit: "info",
  plan_item_create: "success",
  plan_item_delete: "danger",
  template_create: "success",
  template_edit: "info",
  template_activate: "success",
  template_deactivate: "warning",
  item_create: "success",
  item_edit: "info",
  item_delete: "danger",
};

export function AuditDrawer({ planId, itemId, itemLabel, onClose }: Props) {
  const [entries, setEntries] = useState<DeploymentAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDeploymentAudit(planId, itemId !== undefined ? { item_id: itemId } : undefined)
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load history");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planId, itemId]);

  return (
    <div className="audit-drawer-overlay" onClick={onClose}>
      <aside
        className="audit-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="audit-drawer-title"
      >
        <header className="audit-drawer-header">
          <div>
            <h2 id="audit-drawer-title">History</h2>
            {itemLabel && <div className="audit-drawer-subtitle">{itemLabel}</div>}
            {!itemId && <div className="audit-drawer-subtitle">All changes on this plan</div>}
          </div>
          <button
            type="button"
            className="audit-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="audit-drawer-body">
          {loading ? (
            <LoadingRow>Loading history…</LoadingRow>
          ) : error ? (
            <div className="audit-drawer-error">{error}</div>
          ) : !entries || entries.length === 0 ? (
            <EmptyState
              title="No history yet"
              detail="Edits to this plan will appear here."
            />
          ) : (
            <ul className="audit-drawer-list">
              {entries.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </div>

        <footer className="audit-drawer-footer">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </footer>
      </aside>
    </div>
  );
}

function AuditRow({ entry }: { entry: DeploymentAuditEntry }) {
  const tone = ACTION_TONE[entry.action] || "neutral";
  const label = ACTION_LABELS[entry.action] || entry.action;

  let details: any = null;
  if (entry.details_json) {
    try {
      details = JSON.parse(entry.details_json);
    } catch {
      details = entry.details_json;
    }
  }

  return (
    <li className="audit-drawer-row">
      <div className="audit-drawer-row-head">
        <Badge tone={tone}>{label}</Badge>
        <span className="audit-drawer-actor">{entry.actor_email}</span>
        <span className="audit-drawer-time">{formatWhen(entry.created_at)}</span>
      </div>
      {details && <AuditDetails details={details} />}
    </li>
  );
}

function AuditDetails({ details }: { details: any }) {
  if (typeof details === "string") {
    return <div className="audit-drawer-row-body">{details}</div>;
  }

  // The "changed" key is the per-field diff written by PATCH routes — render
  // it as a tiny table so the UI surfaces what specifically changed.
  if (details && typeof details.changed === "object") {
    const keys = Object.keys(details.changed);
    return (
      <div className="audit-drawer-row-body">
        {details.description && (
          <div className="audit-drawer-context">{details.description}</div>
        )}
        {keys.length > 0 ? (
          <table className="audit-drawer-diff">
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td className="audit-drawer-from">{renderVal(details.changed[k].from)}</td>
                  <td>→</td>
                  <td className="audit-drawer-to">{renderVal(details.changed[k].to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    );
  }

  // Fallback — describe a few common payload shapes.
  if (details && typeof details === "object") {
    const lines: string[] = [];
    if (details.template_name) lines.push(`Template: ${details.template_name} (v${details.template_version})`);
    if (details.item_count !== undefined) lines.push(`${details.item_count} items copied`);
    if (details.added_count !== undefined) lines.push(`${details.added_count} items added from template refresh`);
    if (details.item_id) lines.push(`Item id: ${details.item_id}`);
    if (details.description && !details.changed) lines.push(details.description);
    if (lines.length === 0) {
      return (
        <pre className="audit-drawer-raw">{JSON.stringify(details, null, 2)}</pre>
      );
    }
    return (
      <div className="audit-drawer-row-body">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    );
  }

  return null;
}

function renderVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  return String(v);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
