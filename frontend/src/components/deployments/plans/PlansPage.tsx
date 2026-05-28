// Deployments → Plans sub-tab. Lists every deployment plan the user can
// see (TSA's own by default; admins see all) grouped by customer with the
// same parent → child SF hierarchy nesting used everywhere else.
//
// Phase 3a: read-only. Click a plan → drills into PlanDetailPage where the
// task tree is shown.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, FileText, AlertTriangle } from "lucide-react";
import {
  listDeploymentPlans,
  fetchDeploymentTree,
  type DeploymentPlan,
  type DeploymentTreeResponse,
  type DeploymentCustomerNode,
} from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import { useAccountHierarchy } from "../../../hooks/useAccountHierarchy";
import { useStickyState } from "../../../hooks/useStickyState";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Banner,
  LoadingRow,
  EmptyState,
  SectionHeader,
  Button,
} from "../../ui";
import { TemplatePickerModal } from "./TemplatePickerModal";

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  paused: "Paused",
};

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  not_started: "neutral",
  in_progress: "info",
  completed: "success",
  paused: "warning",
};

// Convert axe-* product slug to display label.
const PRODUCT_LABEL: Record<string, string> = {
  "axe-monitor": "axe Monitor",
  "axe-devtools": "axe DevTools",
  "axe-reports": "axe Reports",
  "axe-account-portal": "axe Accounts",
  "axe-assistant": "axe Assistant",
  "deque-university": "Deque University",
};
function productLabel(slug: string): string {
  return PRODUCT_LABEL[slug] || slug;
}

export function PlansPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { hierarchy } = useAccountHierarchy();
  const [expandedCustomers, setExpandedCustomers] = useStickyState<Record<string, boolean>>("deployments-plans:expanded", {});

  // The tree gives us per-customer Kantata + opps; we look up plans against it
  // so each plan row can show its customer name and any context we want.
  const [tree, setTree] = useState<DeploymentTreeResponse | null>(null);
  const [plans, setPlans] = useState<DeploymentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Template-picker modal state. When set, the modal opens for that (opp, product).
  const [picker, setPicker] = useState<{
    opportunityId: string;
    opportunityName: string;
    product: string;
    accountId: string;
    accountName: string;
  } | null>(null);

  // Load plans + tree in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const tsaEmail = isAdmin ? undefined : user?.email;
    Promise.all([
      listDeploymentPlans({ tsa_email: tsaEmail }),
      // Only TSA-scoped tree fetch — admins still need a TSA email to
      // pull the deployment tree, so for admins we skip tree and rely on
      // plan rows alone.
      isAdmin
        ? Promise.resolve(null as DeploymentTreeResponse | null)
        : user?.email
        ? fetchDeploymentTree("tsa", user.email).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([loadedPlans, loadedTree]) => {
        if (cancelled) return;
        setPlans(loadedPlans);
        setTree(loadedTree);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load plans");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email, isAdmin]);

  // Group plans by account. Each customer node holds the plans for that
  // account + a flat list of (opp, product) combos that don't yet have a plan
  // — the picker uses those to show "Create plan" affordances.
  const byCustomer = useMemo(() => {
    const map = new Map<
      string,
      { accountId: string; accountName: string; plans: DeploymentPlan[] }
    >();
    for (const p of plans) {
      const key = p.account_id;
      const existing = map.get(key);
      if (existing) {
        existing.plans.push(p);
      } else {
        map.set(key, {
          accountId: p.account_id,
          accountName: p.account_name || p.account_id,
          plans: [p],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.accountName.localeCompare(b.accountName)
    );
  }, [plans]);

  // Opps without a plan, grouped by customer — sourced from the tree.
  // (account_id, opp_id, product) tuples that have a DeploymentProductNode
  // but no matching plan row.
  const missingByCustomer = useMemo(() => {
    const result = new Map<
      string,
      Array<{ opportunityId: string; opportunityName: string; product: string }>
    >();
    if (!tree) return result;
    for (const customer of tree.customers) {
      const visit = (c: DeploymentCustomerNode) => {
        for (const opp of c.opps) {
          for (const prod of opp.products) {
            const hasPlan = plans.some(
              (p) => p.opportunity_id === opp.oppId && p.product === prod.productLabel
            );
            if (!hasPlan) {
              const arr = result.get(c.accountId) || [];
              arr.push({
                opportunityId: opp.oppId,
                opportunityName: opp.oppName,
                product: prod.productLabel,
              });
              result.set(c.accountId, arr);
            }
          }
        }
        for (const child of c.children) visit(child);
      };
      visit(customer);
    }
    return result;
  }, [tree, plans]);

  // Nest customers by SF hierarchy so a parent's plans are above a child's.
  // For admins (no tree fetched) we just render the alphabetical list flat.
  // We use the local byCustomer map as the source so accounts that have a
  // plan but aren't in the tree still appear.
  const nestedCustomers = useMemo(() => {
    if (!hierarchy) return byCustomer.map((c) => ({ ...c, depth: 0, children: [] as typeof byCustomer }));
    const nodesById = new Map<string, typeof byCustomer[number] & { depth: number; children: typeof byCustomer }>();
    for (const c of byCustomer) nodesById.set(c.accountId, { ...c, depth: 0, children: [] });
    const roots: Array<typeof byCustomer[number] & { depth: number; children: typeof byCustomer }> = [];
    for (const node of nodesById.values()) {
      const parentId = hierarchy.parentIdById.get(node.accountId);
      if (parentId && nodesById.has(parentId)) {
        nodesById.get(parentId)!.children.push(node as any);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }, [byCustomer, hierarchy]);

  const toggle = (accountId: string) =>
    setExpandedCustomers({ ...expandedCustomers, [accountId]: !expandedCustomers[accountId] });

  return (
    <Page>
      <PageHeader
        eyebrow="Deployments"
        title="Plans"
        subtitle={
          loading
            ? "Loading…"
            : isAdmin
            ? `${plans.length} ${plans.length === 1 ? "plan" : "plans"} across all TSAs`
            : `${plans.length} ${plans.length === 1 ? "plan" : "plans"} for ${user?.email || "you"}`
        }
      />

      {error && (
        <Banner tone="danger" icon={<AlertTriangle size={16} />}>
          {error}
        </Banner>
      )}

      <section>
        <SectionHeader title="Customers" />

        {loading ? (
          <Card><LoadingRow>Loading plans…</LoadingRow></Card>
        ) : nestedCustomers.length === 0 && missingByCustomer.size === 0 ? (
          <Card>
            <EmptyState
              title="No deployment plans yet"
              detail={
                isAdmin
                  ? "No plans have been created in the database."
                  : "You don't own any plans yet. Go to the Tree tab to find a deployment project, then create a plan from a template."
              }
            />
          </Card>
        ) : (
          renderCustomerList(nestedCustomers, expandedCustomers, toggle, missingByCustomer, navigate, setPicker)
        )}
      </section>

      {picker && (
        <TemplatePickerModal
          opportunityId={picker.opportunityId}
          opportunityName={picker.opportunityName}
          product={picker.product}
          accountId={picker.accountId}
          accountName={picker.accountName}
          onClose={() => setPicker(null)}
          onCreated={(plan) => {
            setPicker(null);
            setPlans((prev) => [plan, ...prev]);
            // Navigate straight into the new plan.
            navigate(`/deployments/plans/${plan.id}`);
          }}
        />
      )}
    </Page>
  );
}

// Render the recursive customer nesting. Each customer row collapses to
// show plan rows + (optionally) "Create plan" buttons for opps that don't
// yet have a plan.
function renderCustomerList(
  customers: Array<{
    accountId: string;
    accountName: string;
    plans: DeploymentPlan[];
    depth: number;
    children: any[];
  }>,
  expanded: Record<string, boolean>,
  toggle: (id: string) => void,
  missingByCustomer: Map<string, Array<{ opportunityId: string; opportunityName: string; product: string }>>,
  navigate: (path: string) => void,
  setPicker: (p: any) => void
): JSX.Element {
  return (
    <>
      {customers.map((c) => {
        const isOpen = !!expanded[c.accountId];
        const isChild = c.depth > 0;
        const missing = missingByCustomer.get(c.accountId) || [];
        return (
          <div
            key={c.accountId}
            className={`plans-customer-wrapper${isChild ? " is-child" : ""}`}
            style={{ marginLeft: c.depth * 24 }}
          >
            <Card className="plans-customer-card">
              <button
                type="button"
                className="plans-customer-header"
                onClick={() => toggle(c.accountId)}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="plans-customer-name">{c.accountName}</span>
                {isChild && <span className="child-account-pill">child</span>}
                <span className="plans-customer-counts">
                  <Badge tone="info">{c.plans.length} {c.plans.length === 1 ? "plan" : "plans"}</Badge>
                  {missing.length > 0 && (
                    <Badge tone="neutral">{missing.length} ready to plan</Badge>
                  )}
                </span>
              </button>

              {isOpen && (
                <div className="plans-customer-body">
                  {c.plans.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="plans-plan-row"
                      onClick={() => navigate(`/deployments/plans/${p.id}`)}
                    >
                      <div className="plans-plan-row-left">
                        <FileText size={14} aria-hidden />
                        <span className="plans-plan-row-opp">{p.opportunity_name || p.opportunity_id}</span>
                        <Badge tone="neutral">{productLabel(p.product)}</Badge>
                      </div>
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status] || p.status}</Badge>
                    </button>
                  ))}

                  {missing.map((m) => (
                    <div key={`${m.opportunityId}::${m.product}`} className="plans-create-row">
                      <div className="plans-create-row-left">
                        <FileText size={14} aria-hidden />
                        <span className="plans-create-row-opp">{m.opportunityName}</span>
                        <Badge tone="neutral">{productLabel(m.product)}</Badge>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          setPicker({
                            opportunityId: m.opportunityId,
                            opportunityName: m.opportunityName,
                            product: m.product,
                            accountId: c.accountId,
                            accountName: c.accountName,
                          })
                        }
                      >
                        Create plan
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Children render under their parent when open. */}
            {isOpen && c.children.length > 0 && (
              <div className="plans-customer-children">
                {renderCustomerList(
                  c.children.map((ch: any) => ({ ...ch, depth: c.depth + 1 })),
                  expanded,
                  toggle,
                  missingByCustomer,
                  navigate,
                  setPicker
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
