// Admin detail view for one deployment template. Shows the tree of
// milestones / epics / tasks with inline editing — click a row to edit,
// click + to add a sibling/child, click × to delete.
//
// Edits POST to the backend immediately (no batched save) so the audit log
// captures intent at each step.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  getAdminTemplate,
  updateAdminTemplate,
  addAdminTemplateItem,
  updateAdminTemplateItem,
  deleteAdminTemplateItem,
  type AdminTemplate,
  type AdminTemplateItem,
  type AdminTemplateItemTree,
  type AdminActivityType,
} from "../../services/api";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Button,
  EmptyState,
  LoadingRow,
  Banner,
} from "../ui";
import { Plus, Trash2, ChevronDown, ChevronRight, Save, X } from "lucide-react";

const DEPLOYMENT_LABELS: Record<string, string> = {
  cloud: "SaaS / Cloud",
  on_prem: "On-Premises",
};

const TYPE_TONE: Record<AdminActivityType, "neutral" | "info" | "success"> = {
  milestone: "info",
  epic: "success",
  task: "neutral",
};

interface EditState {
  itemId: number;
  item_id: string;
  activity_type: AdminActivityType;
  description: string;
  target_outcome: string;
  notes: string;
}

export function DeploymentTemplateDetailView() {
  const { id } = useParams<{ id: string }>();
  const templateId = id ? parseInt(id, 10) : NaN;
  const { isAdmin } = useAuth();

  const [template, setTemplate] = useState<AdminTemplate | null>(null);
  const [items, setItems] = useState<AdminTemplateItem[]>([]);
  const [tree, setTree] = useState<AdminTemplateItemTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<EditState | null>(null);
  const [addingChildOf, setAddingChildOf] = useState<number | "root" | null>(null);
  const [busy, setBusy] = useState(false);

  // Header edit
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerName, setHeaderName] = useState("");
  const [headerDesc, setHeaderDesc] = useState("");

  const reload = async () => {
    if (isNaN(templateId)) return;
    try {
      const data = await getAdminTemplate(templateId);
      setTemplate(data.template);
      setItems(data.items);
      setTree(data.tree);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load template");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, isAdmin]);

  const stats = useMemo(() => {
    const counts: Record<AdminActivityType, number> = { milestone: 0, epic: 0, task: 0 };
    for (const it of items) counts[it.activity_type]++;
    return counts;
  }, [items]);

  if (!isAdmin) {
    return (
      <Page>
        <PageHeader title="Deployment Template" />
        <Card>
          <EmptyState title="Admin access required" detail="This page is only available to portal admins." />
        </Card>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <PageHeader title="Deployment Template" />
        <Card><LoadingRow>Loading template…</LoadingRow></Card>
      </Page>
    );
  }

  if (error || !template) {
    return (
      <Page>
        <PageHeader title="Deployment Template" />
        <Banner tone="danger">{error || "Template not found"}</Banner>
        <p style={{ marginTop: 16 }}>
          <Link to="/admin/deployment-templates">← Back to all templates</Link>
        </p>
      </Page>
    );
  }

  // ─── Edit handlers ──────────────────────────────────────────────────────

  const beginEdit = (it: AdminTemplateItem) => {
    setEditing({
      itemId: it.id,
      item_id: it.item_id,
      activity_type: it.activity_type,
      description: it.description,
      target_outcome: it.target_outcome || "",
      notes: it.notes || "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await updateAdminTemplateItem(templateId, editing.itemId, {
        item_id: editing.item_id,
        activity_type: editing.activity_type,
        description: editing.description,
        target_outcome: editing.target_outcome || null,
        notes: editing.notes || null,
      });
      setEditing(null);
      await reload();
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (it: AdminTemplateItem) => {
    if (!confirm(`Delete "${it.description}" and all of its children?`)) return;
    setBusy(true);
    try {
      await deleteAdminTemplateItem(templateId, it.id);
      await reload();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const beginAddChild = (parentId: number | "root") => {
    setAddingChildOf(parentId);
  };

  const saveHeader = async () => {
    setBusy(true);
    try {
      const updated = await updateAdminTemplate(templateId, {
        name: headerName,
        description: headerDesc || null,
      });
      setTemplate(updated);
      setEditingHeader(false);
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link to="/admin/deployment-templates" className="admin-tpl-back">
            ← Admin · Deployment Templates
          </Link>
        }
        title={
          editingHeader ? (
            <input
              className="admin-tpl-title-input"
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              autoFocus
            />
          ) : (
            template.name
          )
        }
        subtitle={
          <span>
            <Badge tone="info">{DEPLOYMENT_LABELS[template.deployment_type] || template.deployment_type}</Badge>{" "}
            <Badge tone={template.is_active ? "success" : "neutral"}>v{template.version} · {template.is_active ? "active" : "inactive"}</Badge>{" "}
            <span className="admin-tpl-summary">
              {stats.milestone} milestones · {stats.epic} epics · {stats.task} tasks
            </span>
          </span>
        }
        actions={
          editingHeader ? (
            <>
              <Button size="sm" onClick={saveHeader} disabled={busy}>Save header</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingHeader(false)}>Cancel</Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHeaderName(template.name);
                setHeaderDesc(template.description || "");
                setEditingHeader(true);
              }}
            >
              Edit header
            </Button>
          )
        }
      />

      {editingHeader && (
        <Card className="admin-tpl-header-edit">
          <label>
            Description
            <textarea
              value={headerDesc}
              onChange={(e) => setHeaderDesc(e.target.value)}
              rows={2}
              style={{ width: "100%" }}
            />
          </label>
        </Card>
      )}

      {template.description && !editingHeader && (
        <p className="admin-tpl-description">{template.description}</p>
      )}

      <Card>
        <div className="admin-tpl-tree">
          {tree.length === 0 ? (
            <EmptyState
              title="No items yet"
              detail="Add a milestone to get started."
              action={
                <Button size="sm" onClick={() => beginAddChild("root")}>
                  <Plus size={14} /> Add milestone
                </Button>
              }
            />
          ) : (
            <>
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  collapsed={collapsed}
                  toggleCollapse={toggleCollapse}
                  onEdit={beginEdit}
                  onDelete={deleteItem}
                  onAddChild={beginAddChild}
                  editingId={editing?.itemId ?? null}
                  busy={busy}
                />
              ))}
              <div className="admin-tpl-add-root">
                <Button size="sm" variant="ghost" onClick={() => beginAddChild("root")}>
                  <Plus size={14} /> Add top-level item
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Edit modal — simple inline panel, not a true modal */}
      {editing && (
        <EditPanel
          state={editing}
          setState={setEditing}
          onSave={saveEdit}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      )}

      {/* Add child / sibling modal */}
      {addingChildOf !== null && (
        <AddItemPanel
          parentId={addingChildOf === "root" ? null : addingChildOf}
          parentLabel={
            addingChildOf === "root"
              ? "(top level)"
              : items.find((i) => i.id === addingChildOf)?.description.slice(0, 40) || "?"
          }
          onCancel={() => setAddingChildOf(null)}
          onSave={async (payload) => {
            setBusy(true);
            try {
              await addAdminTemplateItem(templateId, {
                ...payload,
                parent_id: addingChildOf === "root" ? null : addingChildOf,
              });
              setAddingChildOf(null);
              await reload();
            } catch (e) {
              alert(`Add failed: ${e instanceof Error ? e.message : "unknown"}`);
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}
    </Page>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: AdminTemplateItemTree;
  depth: number;
  collapsed: Set<number>;
  toggleCollapse: (id: number) => void;
  onEdit: (it: AdminTemplateItem) => void;
  onDelete: (it: AdminTemplateItem) => void;
  onAddChild: (parentId: number) => void;
  editingId: number | null;
  busy: boolean;
}

function TreeNode({
  node,
  depth,
  collapsed,
  toggleCollapse,
  onEdit,
  onDelete,
  onAddChild,
  editingId,
  busy,
}: TreeNodeProps) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const indent: CSSProperties = { paddingLeft: 16 + depth * 24 };

  return (
    <>
      <div className={`admin-tpl-row ${editingId === node.id ? "editing" : ""}`} style={indent}>
        {hasChildren ? (
          <button
            className="admin-tpl-chev"
            onClick={() => toggleCollapse(node.id)}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="admin-tpl-chev-spacer" />
        )}
        <span className="admin-tpl-id">{node.item_id}</span>
        <Badge tone={TYPE_TONE[node.activity_type]}>{node.activity_type}</Badge>
        <span className="admin-tpl-desc-cell" onClick={() => onEdit(node)}>
          {node.description}
          {node.target_outcome && <em className="admin-tpl-outcome"> — {node.target_outcome}</em>}
        </span>
        <span className="admin-tpl-actions">
          <Button size="sm" variant="ghost" onClick={() => onAddChild(node.id)} disabled={busy} aria-label="Add child">
            <Plus size={12} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(node)} disabled={busy} aria-label="Delete">
            <Trash2 size={12} />
          </Button>
        </span>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            toggleCollapse={toggleCollapse}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddChild={onAddChild}
            editingId={editingId}
            busy={busy}
          />
        ))}
    </>
  );
}

// ─── Edit panel ───────────────────────────────────────────────────────────

interface EditPanelProps {
  state: EditState;
  setState: (s: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function EditPanel({ state, setState, onSave, onCancel, busy }: EditPanelProps) {
  return (
    <div className="admin-tpl-edit-panel">
      <Card>
        <div className="admin-tpl-edit-grid">
          <label>
            ID
            <input
              value={state.item_id}
              onChange={(e) => setState({ ...state, item_id: e.target.value })}
            />
          </label>
          <label>
            Type
            <select
              value={state.activity_type}
              onChange={(e) => setState({ ...state, activity_type: e.target.value as AdminActivityType })}
            >
              <option value="milestone">Milestone</option>
              <option value="epic">Epic</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label className="admin-tpl-full">
            Description
            <textarea
              rows={2}
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
              autoFocus
            />
          </label>
          <label className="admin-tpl-full">
            Target outcome
            <input
              value={state.target_outcome}
              onChange={(e) => setState({ ...state, target_outcome: e.target.value })}
            />
          </label>
          <label className="admin-tpl-full">
            Notes
            <textarea
              rows={2}
              value={state.notes}
              onChange={(e) => setState({ ...state, notes: e.target.value })}
            />
          </label>
        </div>
        <div className="admin-tpl-edit-actions">
          <Button onClick={onSave} disabled={busy || !state.description.trim() || !state.item_id.trim()}>
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

// ─── Add item panel ───────────────────────────────────────────────────────

interface AddItemPanelProps {
  parentId: number | null;
  parentLabel: string;
  onCancel: () => void;
  onSave: (payload: {
    item_id: string;
    activity_type: AdminActivityType;
    description: string;
    target_outcome?: string | null;
    notes?: string | null;
  }) => Promise<void>;
  busy: boolean;
}

function AddItemPanel({ parentId, parentLabel, onCancel, onSave, busy }: AddItemPanelProps) {
  const [item_id, setItemId] = useState("");
  const [activity_type, setActivityType] = useState<AdminActivityType>(parentId === null ? "milestone" : "task");
  const [description, setDescription] = useState("");
  const [target_outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="admin-tpl-edit-panel">
      <Card>
        <div className="admin-tpl-edit-header">
          Adding under: <strong>{parentLabel}</strong>
        </div>
        <div className="admin-tpl-edit-grid">
          <label>
            ID
            <input
              value={item_id}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="e.g. 4.8"
              autoFocus
            />
          </label>
          <label>
            Type
            <select value={activity_type} onChange={(e) => setActivityType(e.target.value as AdminActivityType)}>
              <option value="milestone">Milestone</option>
              <option value="epic">Epic</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label className="admin-tpl-full">
            Description
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="admin-tpl-full">
            Target outcome
            <input value={target_outcome} onChange={(e) => setOutcome(e.target.value)} />
          </label>
          <label className="admin-tpl-full">
            Notes
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="admin-tpl-edit-actions">
          <Button
            onClick={() =>
              onSave({
                item_id,
                activity_type,
                description,
                target_outcome: target_outcome || null,
                notes: notes || null,
              })
            }
            disabled={busy || !item_id.trim() || !description.trim()}
          >
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
