// Plan detail view (Phase 3b–3c).
//
// 3b: inline edit panel (status / dates / responsibles / notes), per-row +/×.
// 3c: per-row history button + plan-level edit panel + admin
//     "Refresh from template" action.

import { useEffect, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  X,
  Clock,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  getDeploymentPlan,
  updateDeploymentPlan,
  updateDeploymentPlanItem,
  addDeploymentPlanItem,
  deleteDeploymentPlanItem,
  refreshPlanFromTemplate,
  type DeploymentPlan,
  type DeploymentPlanItem,
  type DeploymentPlanItemTree,
  type PlanStatus,
  type ProgressStatus,
} from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Banner,
  LoadingRow,
  EmptyState,
  Button,
} from "../../ui";
import { AuditDrawer } from "./AuditDrawer";

const PLAN_STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  paused: "Paused",
};

const PLAN_STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  not_started: "neutral",
  in_progress: "info",
  completed: "success",
  paused: "warning",
};

const PROGRESS_LABELS: Record<ProgressStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  delayed: "Delayed",
  at_risk: "At Risk",
  blocked: "Blocked",
};

const PROGRESS_TONE: Record<ProgressStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  not_started: "neutral",
  in_progress: "info",
  complete: "success",
  delayed: "warning",
  at_risk: "danger",
  blocked: "danger",
};

const PROGRESS_OPTIONS: ProgressStatus[] = [
  "not_started",
  "in_progress",
  "complete",
  "delayed",
  "at_risk",
  "blocked",
];

const PLAN_STATUS_OPTIONS: PlanStatus[] = ["not_started", "in_progress", "completed", "paused"];

interface PlanEditState {
  status: PlanStatus;
  tsa_email: string;
  ie_email: string;
}

const ACTIVITY_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  milestone: "info",
  epic: "success",
  task: "neutral",
};

type ActivityType = "milestone" | "epic" | "task";

// Snapshot of fields under edit in the inline panel. Stored separately from
// the canonical tree so the user can cancel without re-fetching.
interface EditState {
  itemId: number;
  progress_status: ProgressStatus;
  description: string;
  target_outcome: string;
  notes: string;
  deque_responsible: string;
  customer_responsible: string;
  start_date: string;
  end_date: string;
  estimated_days: string; // string so we can render an <input type="number">
  actual_days: string;
}

interface AddState {
  parentId: number | null;          // null = add at root
  parentLabel: string;
  activity_type: ActivityType;
  item_id: string;
  description: string;
  target_outcome: string;
  notes: string;
  deque_responsible: string;
  customer_responsible: string;
  start_date: string;
  end_date: string;
  estimated_days: string;
}

export function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const id = planId ? parseInt(planId, 10) : NaN;

  const [data, setData] = useState<{
    plan: DeploymentPlan;
    tree: DeploymentPlanItemTree[];
    canEdit: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adding, setAdding] = useState<AddState | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Phase 3c additions
  const { isAdmin } = useAuth();
  const [planEditing, setPlanEditing] = useState<PlanEditState | null>(null);
  const [auditFor, setAuditFor] = useState<{ itemId?: number; itemLabel?: string } | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const reload = async () => {
    if (isNaN(id)) return;
    try {
      const res = await getDeploymentPlan(id);
      setData({ plan: res.plan, tree: res.tree, canEdit: res.canEdit });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleCollapse = (itemId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const beginEdit = (it: DeploymentPlanItem) => {
    setActionError(null);
    setEditing({
      itemId: it.id,
      progress_status: it.progress_status,
      description: it.description,
      target_outcome: it.target_outcome || "",
      notes: it.notes || "",
      deque_responsible: it.deque_responsible || "",
      customer_responsible: it.customer_responsible || "",
      start_date: it.start_date || "",
      end_date: it.end_date || "",
      estimated_days: it.estimated_days?.toString() || "",
      actual_days: it.actual_days?.toString() || "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setActionError(null);
    try {
      await updateDeploymentPlanItem(id, editing.itemId, {
        progress_status: editing.progress_status,
        description: editing.description,
        target_outcome: editing.target_outcome || null,
        notes: editing.notes || null,
        deque_responsible: editing.deque_responsible || null,
        customer_responsible: editing.customer_responsible || null,
        start_date: editing.start_date || null,
        end_date: editing.end_date || null,
        estimated_days: editing.estimated_days === "" ? null : Number(editing.estimated_days),
        actual_days: editing.actual_days === "" ? null : Number(editing.actual_days),
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const beginAdd = (parent: DeploymentPlanItem | null) => {
    setActionError(null);
    setAdding({
      parentId: parent ? parent.id : null,
      parentLabel: parent ? parent.description.slice(0, 60) : "(top level)",
      activity_type: parent ? (parent.activity_type === "milestone" ? "epic" : "task") : "milestone",
      item_id: "",
      description: "",
      target_outcome: "",
      notes: "",
      deque_responsible: "",
      customer_responsible: "",
      start_date: "",
      end_date: "",
      estimated_days: "",
    });
  };

  const saveAdd = async () => {
    if (!adding) return;
    setBusy(true);
    setActionError(null);
    try {
      await addDeploymentPlanItem(id, {
        parent_id: adding.parentId,
        activity_type: adding.activity_type,
        description: adding.description,
        item_id: adding.item_id || null,
        target_outcome: adding.target_outcome || null,
        notes: adding.notes || null,
        deque_responsible: adding.deque_responsible || null,
        customer_responsible: adding.customer_responsible || null,
        start_date: adding.start_date || null,
        end_date: adding.end_date || null,
        estimated_days: adding.estimated_days === "" ? null : Number(adding.estimated_days),
      });
      setAdding(null);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const beginPlanEdit = () => {
    if (!data) return;
    setActionError(null);
    setPlanEditing({
      status: data.plan.status,
      tsa_email: data.plan.tsa_email || "",
      ie_email: data.plan.ie_email || "",
    });
  };

  const savePlanEdit = async () => {
    if (!planEditing) return;
    setBusy(true);
    setActionError(null);
    try {
      await updateDeploymentPlan(id, {
        status: planEditing.status,
        tsa_email: planEditing.tsa_email || null,
        ie_email: planEditing.ie_email || null,
      });
      setPlanEditing(null);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Plan save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshFromTemplate = async () => {
    if (!confirm("Pull any new items from the source template into this plan? Existing items are untouched.")) return;
    setBusy(true);
    setActionError(null);
    setRefreshMsg(null);
    try {
      const result = await refreshPlanFromTemplate(id);
      setRefreshMsg(
        result.added_count === 0
          ? "Plan is already in sync with the template."
          : `${result.added_count} item${result.added_count === 1 ? "" : "s"} added from the template.`
      );
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (it: DeploymentPlanItem) => {
    if (!confirm(`Delete "${it.description}" and all of its children?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteDeploymentPlanItem(id, it.id);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <PageHeader title="Plan" eyebrow={<Link to="/deployments/plans">← Plans</Link>} />
        <Card><LoadingRow>Loading plan…</LoadingRow></Card>
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page>
        <PageHeader title="Plan" eyebrow={<Link to="/deployments/plans">← Plans</Link>} />
        <Banner tone="danger" icon={<AlertTriangle size={16} />}>
          {error || "Plan not found"}
        </Banner>
      </Page>
    );
  }

  const { plan, tree, canEdit } = data;
  const totalItems = countItems(tree);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link to="/deployments/plans" className="plans-back-link">
            <ArrowLeft size={14} /> Plans
          </Link>
        }
        title={plan.opportunity_name || `Plan ${plan.id}`}
        subtitle={
          <span>
            {plan.account_name || plan.account_id} · {plan.product}{" "}
            <Badge tone={PLAN_STATUS_TONE[plan.status]}>
              {PLAN_STATUS_LABELS[plan.status] || plan.status}
            </Badge>
          </span>
        }
        actions={
          <span className="plan-header-actions">
            <Button size="sm" variant="ghost" onClick={() => setAuditFor({})}>
              <Clock size={14} /> History
            </Button>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={beginPlanEdit}>
                <Settings size={14} /> Edit plan
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={handleRefreshFromTemplate} disabled={busy}>
                <RefreshCw size={14} /> Refresh from template
              </Button>
            )}
            {!canEdit && (
              <span title="You can view this plan but cannot edit it. Editing is restricted to the assigned TSA / IE and admins.">
                <Badge tone="neutral">Read-only</Badge>
              </span>
            )}
          </span>
        }
      />

      <Card>
        <div className="plan-header-meta">
          <div><strong>TSA:</strong> {plan.tsa_email || "—"}</div>
          <div><strong>IE:</strong> {plan.ie_email || "—"}</div>
          <div><strong>Created by:</strong> {plan.created_by || "—"} on {plan.created_at?.slice(0, 10)}</div>
        </div>
      </Card>

      {actionError && (
        <Banner tone="danger" icon={<AlertTriangle size={16} />}>
          {actionError}
        </Banner>
      )}

      {refreshMsg && (
        <Banner tone="success">
          {refreshMsg}
        </Banner>
      )}

      <section style={{ marginTop: 16 }}>
        <Card>
          {totalItems === 0 ? (
            <EmptyState
              title="No tasks in this plan"
              detail={canEdit ? "Add a milestone to get started." : "Ask an editor to add tasks."}
              action={
                canEdit ? (
                  <Button size="sm" onClick={() => beginAdd(null)}>
                    <Plus size={14} /> Add milestone
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="plan-tree">
              {tree.map((node) => (
                <PlanItemRow
                  key={node.id}
                  node={node}
                  depth={0}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  canEdit={canEdit}
                  editingId={editing?.itemId ?? null}
                  busy={busy}
                  onEdit={beginEdit}
                  onAddChild={(parent) => beginAdd(parent)}
                  onDelete={deleteItem}
                  onShowHistory={(it) =>
                    setAuditFor({ itemId: it.id, itemLabel: `${it.item_id || ""} ${it.description}`.trim() })
                  }
                />
              ))}
              {canEdit && (
                <div className="plan-tree-add-root">
                  <Button size="sm" variant="ghost" onClick={() => beginAdd(null)}>
                    <Plus size={14} /> Add top-level item
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {editing && (
        <EditPanel state={editing} setState={setEditing} onSave={saveEdit} onCancel={() => setEditing(null)} busy={busy} />
      )}

      {adding && (
        <AddPanel state={adding} setState={setAdding} onSave={saveAdd} onCancel={() => setAdding(null)} busy={busy} />
      )}

      {planEditing && (
        <PlanEditPanel
          state={planEditing}
          setState={setPlanEditing}
          onSave={savePlanEdit}
          onCancel={() => setPlanEditing(null)}
          busy={busy}
        />
      )}

      {auditFor && (
        <AuditDrawer
          planId={id}
          itemId={auditFor.itemId}
          itemLabel={auditFor.itemLabel}
          onClose={() => setAuditFor(null)}
        />
      )}
    </Page>
  );
}

function countItems(tree: DeploymentPlanItemTree[]): number {
  let count = 0;
  const walk = (nodes: DeploymentPlanItemTree[]) => {
    for (const n of nodes) {
      count++;
      walk(n.children);
    }
  };
  walk(tree);
  return count;
}

// ─── Tree row ───────────────────────────────────────────────────────────────

interface RowProps {
  node: DeploymentPlanItemTree;
  depth: number;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
  canEdit: boolean;
  editingId: number | null;
  busy: boolean;
  onEdit: (it: DeploymentPlanItem) => void;
  onAddChild: (parent: DeploymentPlanItem) => void;
  onDelete: (it: DeploymentPlanItem) => void;
  onShowHistory: (it: DeploymentPlanItem) => void;
}

function PlanItemRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  canEdit,
  editingId,
  busy,
  onEdit,
  onAddChild,
  onDelete,
  onShowHistory,
}: RowProps) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const indent: CSSProperties = { paddingLeft: 16 + depth * 24 };
  const isEditing = editingId === node.id;

  return (
    <>
      <div className={`plan-tree-row${isEditing ? " editing" : ""}`} style={indent}>
        {hasChildren ? (
          <button
            type="button"
            className="plan-tree-chev"
            onClick={() => onToggleCollapse(node.id)}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="plan-tree-chev-spacer" />
        )}
        <span className="plan-tree-id">{node.item_id || "—"}</span>
        <Badge tone={ACTIVITY_TONE[node.activity_type]}>{node.activity_type}</Badge>
        <button
          type="button"
          className="plan-tree-desc plan-tree-desc-btn"
          onClick={() => canEdit && onEdit(node)}
          disabled={!canEdit}
          title={canEdit ? "Click to edit" : "Read-only"}
        >
          {node.description}
          {node.target_outcome && <em className="plan-tree-outcome"> — {node.target_outcome}</em>}
        </button>
        <Badge tone={PROGRESS_TONE[node.progress_status]}>
          {PROGRESS_LABELS[node.progress_status] || node.progress_status}
        </Badge>
        <span className="plan-tree-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onShowHistory(node)}
            aria-label="History"
            title="Show change history"
          >
            <Clock size={12} />
          </Button>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onAddChild(node)}
                disabled={busy}
                aria-label="Add child"
                title="Add child task"
              >
                <Plus size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(node)}
                disabled={busy}
                aria-label="Delete"
                title="Delete this item and its children"
              >
                <Trash2 size={12} />
              </Button>
            </>
          )}
        </span>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <PlanItemRow
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            canEdit={canEdit}
            editingId={editingId}
            busy={busy}
            onEdit={onEdit}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onShowHistory={onShowHistory}
          />
        ))}
    </>
  );
}

// ─── Edit panel ─────────────────────────────────────────────────────────────

interface EditPanelProps {
  state: EditState;
  setState: (s: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function EditPanel({ state, setState, onSave, onCancel, busy }: EditPanelProps) {
  return (
    <div className="plan-edit-panel">
      <Card>
        <div className="plan-edit-grid">
          <label>
            Status
            <select
              value={state.progress_status}
              onChange={(e) => setState({ ...state, progress_status: e.target.value as ProgressStatus })}
            >
              {PROGRESS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PROGRESS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label>
            Estimated days
            <input
              type="number"
              min="0"
              value={state.estimated_days}
              onChange={(e) => setState({ ...state, estimated_days: e.target.value })}
            />
          </label>
          <label>
            Actual days
            <input
              type="number"
              min="0"
              value={state.actual_days}
              onChange={(e) => setState({ ...state, actual_days: e.target.value })}
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={state.start_date}
              onChange={(e) => setState({ ...state, start_date: e.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={state.end_date}
              onChange={(e) => setState({ ...state, end_date: e.target.value })}
            />
          </label>
          <label>
            Deque responsible
            <input
              value={state.deque_responsible}
              onChange={(e) => setState({ ...state, deque_responsible: e.target.value })}
              placeholder="TSA / IE / PM / CSM"
            />
          </label>
          <label>
            Customer responsible
            <input
              value={state.customer_responsible}
              onChange={(e) => setState({ ...state, customer_responsible: e.target.value })}
              placeholder="Customer role or name"
            />
          </label>
          <label className="plan-edit-full">
            Description
            <textarea
              rows={2}
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
              autoFocus
            />
          </label>
          <label className="plan-edit-full">
            Target outcome
            <input
              value={state.target_outcome}
              onChange={(e) => setState({ ...state, target_outcome: e.target.value })}
            />
          </label>
          <label className="plan-edit-full">
            Notes
            <textarea
              rows={3}
              value={state.notes}
              onChange={(e) => setState({ ...state, notes: e.target.value })}
            />
          </label>
        </div>
        <div className="plan-edit-actions">
          <Button onClick={onSave} disabled={busy || !state.description.trim()}>
            <Save size={14} /> Save
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            <X size={14} /> Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Add panel ──────────────────────────────────────────────────────────────

interface AddPanelProps {
  state: AddState;
  setState: (s: AddState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function AddPanel({ state, setState, onSave, onCancel, busy }: AddPanelProps) {
  return (
    <div className="plan-edit-panel">
      <Card>
        <div className="plan-edit-header">
          Adding under: <strong>{state.parentLabel}</strong>
        </div>
        <div className="plan-edit-grid">
          <label>
            ID
            <input
              value={state.item_id}
              onChange={(e) => setState({ ...state, item_id: e.target.value })}
              placeholder="e.g. 4.8"
            />
          </label>
          <label>
            Type
            <select
              value={state.activity_type}
              onChange={(e) => setState({ ...state, activity_type: e.target.value as ActivityType })}
            >
              <option value="milestone">Milestone</option>
              <option value="epic">Epic</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label>
            Estimated days
            <input
              type="number"
              min="0"
              value={state.estimated_days}
              onChange={(e) => setState({ ...state, estimated_days: e.target.value })}
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={state.start_date}
              onChange={(e) => setState({ ...state, start_date: e.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={state.end_date}
              onChange={(e) => setState({ ...state, end_date: e.target.value })}
            />
          </label>
          <label>
            Deque responsible
            <input
              value={state.deque_responsible}
              onChange={(e) => setState({ ...state, deque_responsible: e.target.value })}
            />
          </label>
          <label>
            Customer responsible
            <input
              value={state.customer_responsible}
              onChange={(e) => setState({ ...state, customer_responsible: e.target.value })}
            />
          </label>
          <label className="plan-edit-full">
            Description
            <textarea
              rows={2}
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
              autoFocus
            />
          </label>
          <label className="plan-edit-full">
            Target outcome
            <input
              value={state.target_outcome}
              onChange={(e) => setState({ ...state, target_outcome: e.target.value })}
            />
          </label>
          <label className="plan-edit-full">
            Notes
            <textarea
              rows={2}
              value={state.notes}
              onChange={(e) => setState({ ...state, notes: e.target.value })}
            />
          </label>
        </div>
        <div className="plan-edit-actions">
          <Button onClick={onSave} disabled={busy || !state.description.trim()}>
            <Save size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            <X size={14} /> Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Plan-level edit panel (Phase 3c) ───────────────────────────────────────

const PLAN_STATUS_LABEL_MAP: Record<PlanStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  paused: "Paused",
};

interface PlanEditPanelProps {
  state: PlanEditState;
  setState: (s: PlanEditState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function PlanEditPanel({ state, setState, onSave, onCancel, busy }: PlanEditPanelProps) {
  return (
    <div className="plan-edit-panel">
      <Card>
        <div className="plan-edit-header">
          <strong>Edit plan</strong> — change status or reassign owners. Non-admins must keep themselves as TSA or IE.
        </div>
        <div className="plan-edit-grid">
          <label>
            Status
            <select
              value={state.status}
              onChange={(e) => setState({ ...state, status: e.target.value as PlanStatus })}
              autoFocus
            >
              {PLAN_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PLAN_STATUS_LABEL_MAP[s]}</option>
              ))}
            </select>
          </label>
          <label>
            TSA email
            <input
              type="email"
              value={state.tsa_email}
              onChange={(e) => setState({ ...state, tsa_email: e.target.value })}
              placeholder="tsa@deque.com"
            />
          </label>
          <label>
            IE email
            <input
              type="email"
              value={state.ie_email}
              onChange={(e) => setState({ ...state, ie_email: e.target.value })}
              placeholder="ie@deque.com"
            />
          </label>
        </div>
        <div className="plan-edit-actions">
          <Button onClick={onSave} disabled={busy}>
            <Save size={14} /> Save
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            <X size={14} /> Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
