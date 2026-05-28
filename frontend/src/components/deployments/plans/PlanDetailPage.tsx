// Read-only plan detail view (Phase 3a). Shows the plan's header info +
// the full task tree (Milestone → Epic → Task) cloned from the template.
// Editing arrives in Phase 3b.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronDown, ChevronRight, AlertTriangle, ArrowLeft } from "lucide-react";
import {
  getDeploymentPlan,
  type DeploymentPlan,
  type DeploymentPlanItemTree,
} from "../../../services/api";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Banner,
  LoadingRow,
  EmptyState,
} from "../../ui";

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

const PROGRESS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  delayed: "Delayed",
  at_risk: "At Risk",
  blocked: "Blocked",
};

const PROGRESS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  not_started: "neutral",
  in_progress: "info",
  complete: "success",
  delayed: "warning",
  at_risk: "danger",
  blocked: "danger",
};

const ACTIVITY_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  milestone: "info",
  epic: "success",
  task: "neutral",
};

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

  useEffect(() => {
    if (isNaN(id)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDeploymentPlan(id)
      .then((res) => {
        if (cancelled) return;
        setData({ plan: res.plan, tree: res.tree, canEdit: res.canEdit });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load plan");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleCollapse = (itemId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
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
          !canEdit ? (
            <span title="You can view this plan but cannot edit it. Editing is restricted to the assigned TSA / IE and admins.">
              <Badge tone="neutral">Read-only</Badge>
            </span>
          ) : null
        }
      />

      <Card>
        <div className="plan-header-meta">
          <div><strong>TSA:</strong> {plan.tsa_email || "—"}</div>
          <div><strong>IE:</strong> {plan.ie_email || "—"}</div>
          <div><strong>Created by:</strong> {plan.created_by || "—"} on {plan.created_at?.slice(0, 10)}</div>
        </div>
      </Card>

      <section style={{ marginTop: 16 }}>
        <Card>
          {totalItems === 0 ? (
            <EmptyState
              title="No tasks in this plan"
              detail="The plan was created from a template with zero items. Add tasks manually (coming in Phase 3b)."
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
                />
              ))}
            </div>
          )}
        </Card>
      </section>
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

interface RowProps {
  node: DeploymentPlanItemTree;
  depth: number;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
}

function PlanItemRow({ node, depth, collapsed, onToggleCollapse }: RowProps) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  const indent: React.CSSProperties = { paddingLeft: 16 + depth * 24 };

  return (
    <>
      <div className="plan-tree-row" style={indent}>
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
        <span className="plan-tree-desc">
          {node.description}
          {node.target_outcome && <em className="plan-tree-outcome"> — {node.target_outcome}</em>}
        </span>
        <Badge tone={PROGRESS_TONE[node.progress_status]}>
          {PROGRESS_LABELS[node.progress_status] || node.progress_status}
        </Badge>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <PlanItemRow
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </>
  );
}
