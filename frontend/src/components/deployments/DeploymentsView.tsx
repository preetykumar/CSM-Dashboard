// Deployments view at /deployments — Phase 1 (read-only).
//
// Hierarchy: TSA → Customer → [Opp →] Product
//   - "flat" render: skip Opp level when customer has exactly 1 single-product opp
//   - "by_opp" render: nest Opp level when customer has multiple opps OR any
//     opp has multiple products. Kantata budget shown at Opp level.
//
// Phase 2+ adds the per-product implementation plan beneath each product node.

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Rocket,
  AlertTriangle,
  DollarSign,
  Briefcase,
  Package,
  ExternalLink,
  Users,
} from "lucide-react";
import {
  fetchDeploymentTree,
  type DeploymentTreeResponse,
  type DeploymentCustomerNode,
  type DeploymentOppNode,
  type DeploymentProductNode,
  type DeploymentOppKantata,
} from "../../services/api";
import {
  Page,
  PageHeader,
  Card,
  StatCard,
  StatGrid,
  SectionHeader,
  LoadingRow,
  EmptyState,
  Badge,
  Banner,
} from "../ui";
import { useStickyState } from "../../hooks/useStickyState";
import { CustomerDetailPanel } from "./CustomerDetailPanel";
import { NoKantataModal } from "./NoKantataModal";

// Status filter options for Kantata project status. Default = "in_progress"
// because that's what TSAs care about day-to-day.
type StatusFilter = "in_progress" | "active" | "completed" | "no_kantata" | "all";
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  in_progress: "In Progress",
  active: "Active (any status)",
  completed: "Completed",
  no_kantata: "No Kantata project",
  all: "Show all",
};

function matchesStatusFilter(opp: DeploymentOppNode, filter: StatusFilter): boolean {
  const status = opp.kantata?.status?.toLowerCase() || "";
  switch (filter) {
    case "in_progress":
      return status.includes("in progress");
    case "active":
      return opp.kantata !== null && !status.includes("completed") && !status.includes("cancelled");
    case "completed":
      return status.includes("completed");
    case "no_kantata":
      return opp.kantata === null;
    case "all":
    default:
      return true;
  }
}

// Hardcoded TSA list for now — wireframe stand-in for session-driven role/email.
// Replace with session auth once role plumbing is wired.
const TSA_OPTIONS = [
  { email: "tilly.pick@deque.com", name: "Tilly Pick" },
  { email: "oleksandr.parada@deque.com", name: "Oleksandr Parada" },
  { email: "alfonso.quiroz@deque.com", name: "Alfonso Quiroz" },
  { email: "tamer.abu-shaban@deque.com", name: "Tamer Abu-Shaban" },
  { email: "bharat.bahunutula@deque.com", name: "Bharat Bahunutula" },
  { email: "ankit.kathal@deque.com", name: "Ankit Kathal" },
  { email: "chris.villanueva@deque.com", name: "Chris Villanueva" },
  { email: "weston.cagle@deque.com", name: "Weston Cagle" },
];

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function deployTypeBadge(t: "cloud" | "on_prem") {
  return t === "cloud" ? (
    <Badge tone="info">cloud</Badge>
  ) : (
    <Badge tone="warning">on-prem</Badge>
  );
}

function kantataStatusBadge(k: DeploymentOppKantata | null) {
  if (!k) return <Badge tone="neutral">No Kantata project</Badge>;
  if (k.overBudget) return <Badge tone="danger">Over budget</Badge>;
  return <Badge tone="success">{k.status || "In progress"}</Badge>;
}

export function DeploymentsView() {
  // Selections sticky per-user (localStorage namespaced by email).
  const [tsaEmail, setTsaEmail] = useStickyState<string>("deployments:tsa", TSA_OPTIONS[0].email);
  const [statusFilter, setStatusFilter] = useStickyState<StatusFilter>("deployments:statusFilter", "in_progress");

  const [data, setData] = useState<DeploymentTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNoKantataModal, setShowNoKantataModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDeploymentTree("tsa", tsaEmail)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tsaEmail]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const tsaLabel = useMemo(
    () => TSA_OPTIONS.find((t) => t.email === tsaEmail)?.name || tsaEmail,
    [tsaEmail]
  );

  // Apply status filter recursively to the customer tree. A node is kept if
  // its own opps match OR any descendant is kept (so a parent with no direct
  // matching opps stays in view as a grouping for its matching children).
  // Totals at the page-header level still come from the unfiltered data so
  // users see the full pool.
  const filteredCustomers = useMemo(() => {
    if (!data) return [];
    const filterNode = (c: DeploymentCustomerNode): DeploymentCustomerNode | null => {
      const opps = c.opps.filter((o) => matchesStatusFilter(o, statusFilter));
      const productCount = opps.reduce((sum, o) => sum + o.products.length, 0);
      // Recompute renderMode against filtered opps so we don't show "by_opp"
      // nesting when filtering collapsed the customer back to 1 opp / 1 product.
      const renderMode: DeploymentCustomerNode["renderMode"] =
        opps.length === 1 && opps[0].products.length === 1 ? "flat" : "by_opp";
      const children = (c.children || [])
        .map(filterNode)
        .filter((x): x is DeploymentCustomerNode => x !== null);
      if (opps.length === 0 && children.length === 0) return null;
      return { ...c, opps, productCount, oppCount: opps.length, renderMode, children };
    };
    return data.customers.map(filterNode).filter((c): c is DeploymentCustomerNode => c !== null);
  }, [data, statusFilter]);

  const headerActions = (
    <>
      <div className="deployments-filter">
        <label htmlFor="deployments-status">Status</label>
        <select
          id="deployments-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="home-select"
        >
          {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((s) => (
            <option key={s} value={s}>{STATUS_FILTER_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div className="deployments-tsa-switcher">
        <label htmlFor="deployments-tsa">TSA</label>
        <select
          id="deployments-tsa"
          value={tsaEmail}
          onChange={(e) => setTsaEmail(e.target.value)}
          className="home-select"
        >
          {TSA_OPTIONS.map((t) => (
            <option key={t.email} value={t.email}>{t.name}</option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Deployments"
        title={`${tsaLabel}'s portfolio`}
        subtitle="Open booked Kantata projects, grouped by customer then product"
        actions={headerActions}
      />

      {loading ? (
        <Card><LoadingRow>Loading deployments…</LoadingRow></Card>
      ) : error ? (
        <Card><EmptyState title="Couldn't load deployments" detail={error} /></Card>
      ) : !data || data.customers.length === 0 ? (
        <Card><EmptyState
          title="No deployments found"
          detail={`No closed-won deployment opportunities found for ${tsaLabel}. (DEP-* SKUs on closed-won opps tied to accounts where this user is TSA.)`}
        /></Card>
      ) : (
        <>
          {/* Top-level totals */}
          <StatGrid>
            <StatCard
              label="Customers"
              value={String(data.totals.customers)}
              icon={<Users size={16} />}
            />
            <StatCard
              label="Active deployments"
              value={String(data.totals.products)}
              icon={<Rocket size={16} />}
              delta={<span className="ui-stat__delta ui-stat__delta--flat">{data.totals.opps} opportunities</span>}
            />
            <StatCard
              label="DEP-* booked"
              value={fmtMoney(data.totals.depDollars)}
              icon={<DollarSign size={16} />}
            />
            <StatCard
              label="Kantata budget"
              value={fmtMoney(data.totals.kantataBudget)}
              icon={<Briefcase size={16} />}
              delta={<span className="ui-stat__delta ui-stat__delta--flat">
                {fmtMoney(data.totals.kantataUsed)} used · {fmtMoney(data.totals.kantataRemaining)} remaining
              </span>}
            />
          </StatGrid>

          {data.totals.oppsWithoutKantata > 0 && (
            <Banner tone="warning" icon={<AlertTriangle size={16} />}>
              <strong>{data.totals.oppsWithoutKantata} opportunit{data.totals.oppsWithoutKantata === 1 ? "y has" : "ies have"} no Kantata project yet</strong> — these were booked in SF but the project hasn't been set up in Kantata. They surface with <em>No Kantata project</em> badges below.{" "}
              <button
                type="button"
                className="deployments-banner-link"
                onClick={() => setShowNoKantataModal(true)}
              >
                View all {data.totals.oppsWithoutKantata} →
              </button>
            </Banner>
          )}

          <section>
            <SectionHeader
              title="Customers"
              count={
                statusFilter === "all"
                  ? `${data.customers.length} ${data.customers.length === 1 ? "customer" : "customers"}`
                  : `${filteredCustomers.length} of ${data.customers.length} (filtered to ${STATUS_FILTER_LABELS[statusFilter].toLowerCase()})`
              }
            />
            {filteredCustomers.length === 0 ? (
              <Card><EmptyState
                title={`No deployments match "${STATUS_FILTER_LABELS[statusFilter]}"`}
                detail="Try changing the Status filter or select a different TSA."
              /></Card>
            ) : (
              <div className="deployments-customer-list">
                {filteredCustomers.map((c) => (
                  <CustomerNode
                    key={c.accountId}
                    customer={c}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {showNoKantataModal && data && (
        <NoKantataModal
          customers={data.customers}
          onClose={() => setShowNoKantataModal(false)}
        />
      )}
    </Page>
  );
}

function CustomerNode({
  customer,
  depth,
  expanded,
  onToggle,
}: {
  customer: DeploymentCustomerNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const key = `cust:${customer.accountId}`;
  const open = expanded.has(key);
  const flat = customer.renderMode === "flat";
  const hasOwnOpps = customer.opps.length > 0;
  const childCount = customer.children?.length || 0;

  return (
    <div className={`deployments-customer-wrapper${depth > 0 ? " is-child" : ""}`} style={{ marginLeft: depth * 24 }}>
      <Card className="deployments-customer-card">
        <button
          type="button"
          className="deployments-customer-header"
          onClick={() => onToggle(key)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="deployments-customer-name">{customer.accountName}</span>
          <span className="deployments-customer-meta">
            {hasOwnOpps && (
              <>
                <Badge tone="brand">{customer.productCount} {customer.productCount === 1 ? "deployment" : "deployments"}</Badge>
                {customer.oppCount > 1 && <Badge tone="neutral">{customer.oppCount} opps</Badge>}
              </>
            )}
            {childCount > 0 && (
              <Badge tone="info">+{childCount} {childCount === 1 ? "child" : "children"}</Badge>
            )}
            {hasOwnOpps && (
              <span className="deployments-customer-money">{fmtMoney(customer.totalDepDollars)}</span>
            )}
          </span>
        </button>

        {open && (
        <div className="deployments-customer-body">
          {/* Deployment structure (opps / products) — only when this account
              has its own direct deploy opps. A pure grouping parent (only
              children with opps) skips this section. */}
          {hasOwnOpps && (
            flat ? (
              <ProductDeployment
                product={customer.opps[0].products[0]}
                kantata={customer.opps[0].kantata}
                oppName={customer.opps[0].oppName}
                showKantataInline
              />
            ) : (
              customer.opps.map((opp) => (
                <OppNode
                  key={opp.oppId}
                  opp={opp}
                  customerKey={key}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              ))
            )
          )}

          {/* Phase 2 detail panel: Health / Support / Usage / Kantata.
              Only shown when this account has its own deploy opps — a pure
              grouping parent (no direct opps, only children with opps)
              doesn't need the per-customer health/support/usage drilldown. */}
          {hasOwnOpps && <CustomerDetailPanel customer={customer} />}
        </div>
      )}
      </Card>

      {/* Children: render as nested rows under this expanded parent. Strict
          portfolio scope — they're only here if also assigned to this TSA. */}
      {open && childCount > 0 && (
        <div className="deployments-customer-children">
          {customer.children.map((child) => (
            <CustomerNode
              key={child.accountId}
              customer={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OppNode({
  opp,
  customerKey,
  expanded,
  onToggle,
}: {
  opp: DeploymentOppNode;
  customerKey: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const key = `${customerKey}:opp:${opp.oppId}`;
  const open = expanded.has(key);
  const k = opp.kantata;

  return (
    <div className={`deployments-opp ${k ? "" : "deployments-opp--no-kantata"}`}>
      <button
        type="button"
        className="deployments-opp-header"
        onClick={() => onToggle(key)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="deployments-opp-name">{opp.oppName}</span>
        <span className="deployments-opp-meta">
          {kantataStatusBadge(k)}
          {k && k.budget != null && (
            <span className="deployments-opp-budget">
              {fmtMoney(k.budgetUsed)} / {fmtMoney(k.budget)}
            </span>
          )}
          {k && k.url && (
            <a
              href={k.url}
              target="_blank"
              rel="noopener noreferrer"
              className="deployments-opp-kantata-link"
              onClick={(e) => e.stopPropagation()}
              title="Open in Kantata"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </span>
      </button>

      {open && (
        <div className="deployments-opp-body">
          {opp.products.map((p) => (
            <ProductDeployment
              key={`${opp.oppId}:${p.productLabel}:${p.deploymentType}`}
              product={p}
              kantata={null /* already shown at opp level */}
              oppName={opp.oppName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductDeployment({
  product,
  kantata,
  oppName,
  showKantataInline = false,
}: {
  product: DeploymentProductNode;
  kantata: DeploymentOppKantata | null;
  oppName?: string;
  showKantataInline?: boolean;
}) {
  return (
    <div className="deployments-product">
      <div className="deployments-product-header">
        <Package size={14} aria-hidden />
        <span className="deployments-product-name">{product.productLabel}</span>
        {deployTypeBadge(product.deploymentType)}
        <span className="deployments-product-money">{fmtMoney(product.totalDepDollars)}</span>
        {showKantataInline && kantataStatusBadge(kantata)}
      </div>
      {showKantataInline && kantata && kantata.budget != null && (
        <div className="deployments-product-kantata">
          <strong>{oppName}</strong> · Kantata: {fmtMoney(kantata.budgetUsed)} / {fmtMoney(kantata.budget)} used
          {kantata.url && (
            <>
              {" "}
              <a href={kantata.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <ExternalLink size={11} />
              </a>
            </>
          )}
        </div>
      )}
      <div className="deployments-product-plan-stub">
        <em>Implementation plan: coming in Phase 2</em>
      </div>
    </div>
  );
}
