import { useEffect, useMemo, useState } from "react";
import {
  fetchUnifiedUsageMetrics,
  fetchProductUsers,
  type UnifiedUsageResponse,
  type UnifiedProductMetrics,
  type EnterpriseSubscription,
  type ProductUsersResponse,
  type ProductUserRow,
} from "../services/api";

interface Props {
  enterpriseUuid?: string;
  accountName: string;
  salesforceAccountId?: string;
  monitorDomain?: string;
  subscriptions?: EnterpriseSubscription[];
}

// Different products store different things in gp:organization (UUID, account name,
// initial referring domain). Some products even mix formats. We pass every plausible
// org-key candidate to the backend; it OR's them when filtering activity rows.
function getOrgKeysForAccount(enterpriseUuid: string | undefined, accountName: string): string[] {
  const keys: string[] = [];
  if (enterpriseUuid) keys.push(enterpriseUuid);
  if (accountName) {
    keys.push(accountName);
    // Some account names are stored with leading dash in Amplitude (Deque internal pattern)
    keys.push(`-${accountName}`);
  }
  return Array.from(new Set(keys.filter(Boolean)));
}

// Map Amplitude product slugs to SF subscription product types
const PRODUCT_SUBSCRIPTION_TYPES: Record<string, string[]> = {
  "axe-account-portal": [], // available with any subscription
  "axe-devtools-(browser-extension)": ["axe-devtools-pro", "axe-devtools-html"],
  "developer-hub": [], // included with devtools
  "axe-devtools-mobile": ["axe-devtools-mobile"],
  "axe-assistant": ["axe-assistant-slack", "axe-assistant-teams"],
  "deque-university": ["deque-university", "dequeu"],
  "axe-monitor": ["axe-monitor", "axe-monitor-pro"],
  "axe-reports": [], // included with other products
  "axe-linter": ["axe-devtools-linter"],
  "axe-mcp-server": [], // included with devtools
};

interface ProductSubsSummary {
  licensed: number;
  assigned: number;
  pct: number;
  // Monitor-specific
  isMonitor?: boolean;
  pageCapacity?: number;
  pagesUsed?: number;
  pagePct?: number;
  projects?: number;
}

function getProductSubscriptionSummary(slug: string, subscriptions: EnterpriseSubscription[]): ProductSubsSummary | null {
  const types = PRODUCT_SUBSCRIPTION_TYPES[slug];
  if (!types || types.length === 0) return null;
  const matching = subscriptions.filter((s) => types.includes(s.productType.toLowerCase()));
  if (matching.length === 0) return null;

  // Monitor uses pages, not seats
  if (slug === "axe-monitor") {
    const pageCapacity = matching.reduce((sum, s) => sum + s.licenseCount, 0);
    const pagesUsed = matching.reduce((sum, s) => sum + (s.monitorPageCount || 0), 0);
    const projects = matching.reduce((sum, s) => sum + (s.monitorProjectCount || 0), 0);
    const isUnlimited = pageCapacity >= 9999999;
    return {
      licensed: 0, assigned: 0, pct: 0,
      isMonitor: true,
      pageCapacity: isUnlimited ? -1 : pageCapacity, // -1 = unlimited
      pagesUsed,
      pagePct: isUnlimited ? 0 : (pageCapacity > 0 ? Math.round((pagesUsed / pageCapacity) * 100) : 0),
      projects,
    };
  }

  const licensed = matching.reduce((sum, s) => sum + s.licenseCount, 0);
  const assigned = matching.reduce((sum, s) => sum + s.assignedSeats, 0);
  const pct = licensed > 0 ? Math.round((assigned / licensed) * 100) : 0;
  return { licensed, assigned, pct };
}

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="trend-indicator up" title="New activity">+</span>;
  const pctChange = ((current - previous) / previous) * 100;
  if (Math.abs(pctChange) < 5) return null;
  return (
    <span className={`trend-indicator ${pctChange > 0 ? "up" : "down"}`} title={`${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}% vs previous quarter`}>
      {pctChange > 0 ? "\u25B2" : "\u25BC"}
    </span>
  );
}

function ProductMetricsTable({ product, subsSummary }: { product: UnifiedProductMetrics; subsSummary?: ProductSubsSummary | null }) {
  const activeEvents = product.events.filter((e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0);
  const hasSubsData = subsSummary && (subsSummary.licensed > 0 || subsSummary.isMonitor);

  if (activeEvents.length === 0 && !hasSubsData) {
    return <p className="usage-no-data">No usage data available for this product.</p>;
  }

  const labels = activeEvents[0]?.labels || product.events[0]?.labels || ["", "", ""];

  return (
    <table className="devtools-metrics-table">
      <thead>
        <tr>
          <th className="metric-label-col">Metric</th>
          <th className="quarter-col">{labels[2]}</th>
          <th className="quarter-col">{labels[1]}</th>
          <th className="quarter-col current">{labels[0]}</th>
        </tr>
      </thead>
      <tbody>
        {hasSubsData && subsSummary!.isMonitor ? (
          <>
            <tr className="subscription-row">
              <td className="metric-label-col">Page Tier</td>
              <td className="quarter-col" colSpan={3}>
                {subsSummary!.pageCapacity === -1 ? "Unlimited" : subsSummary!.pageCapacity!.toLocaleString() + " pages"}
              </td>
            </tr>
            <tr className="subscription-row">
              <td className="metric-label-col">Unique Pages Processed</td>
              <td className="quarter-col" colSpan={3}>
                {subsSummary!.pagesUsed!.toLocaleString()}
                {subsSummary!.pageCapacity !== -1 && ` (${subsSummary!.pagePct}% of capacity)`}
              </td>
            </tr>
            <tr className="subscription-row">
              <td className="metric-label-col">Projects</td>
              <td className="quarter-col" colSpan={3}>{subsSummary!.projects!.toLocaleString()}</td>
            </tr>
          </>
        ) : hasSubsData ? (
          <>
            <tr className="subscription-row">
              <td className="metric-label-col">Licensed Seats</td>
              <td className="quarter-col" colSpan={3}>{subsSummary!.licensed.toLocaleString()}</td>
            </tr>
            <tr className="subscription-row">
              <td className="metric-label-col">Assigned Seats</td>
              <td className="quarter-col" colSpan={3}>
                {subsSummary!.assigned.toLocaleString()} ({subsSummary!.pct}%)
              </td>
            </tr>
          </>
        ) : null}
        {activeEvents.map((evt, i) => (
          <tr key={`${evt.event}-${evt.metric}-${i}`}>
            <td className="metric-label-col">{evt.label}</td>
            <td className="quarter-col">{evt.twoAgo.toLocaleString()}</td>
            <td className="quarter-col">{evt.previous.toLocaleString()}</td>
            <td className="quarter-col current">
              {evt.current.toLocaleString()}
              <TrendIndicator current={evt.current} previous={evt.previous} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SortKey = "status" | "last_seen" | "event_count_90d" | "name" | "email";
type StatusFilter = "active" | "inactive" | "all";

function ProductUsersList({
  productSlug,
  productDisplayName,
  accountId,
  orgKeys,
}: {
  productSlug: string;
  productDisplayName: string;
  accountId: string;
  orgKeys: string[];
}) {
  const [data, setData] = useState<ProductUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_seen");
  const [sortAsc, setSortAsc] = useState(false);

  // Only fetch inactive seats from the backend when the user actually wants to see them
  const includeInactive = statusFilter !== "active";

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchProductUsers(productSlug, accountId, { orgKeys, includeInactive })
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load users"))
      .finally(() => setLoading(false));
  }, [productSlug, accountId, orgKeys.join("|"), includeInactive]);

  const filteredSorted = useMemo<ProductUserRow[]>(() => {
    if (!data?.users) return [];
    let rows = data.users;
    if (statusFilter === "active") rows = rows.filter((u) => u.event_count_90d > 0);
    else if (statusFilter === "inactive") rows = rows.filter((u) => u.event_count_90d === 0);

    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (u) =>
          (u.name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.title || "").toLowerCase().includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = (a.name || "").localeCompare(b.name || "");
      else if (sortKey === "email") cmp = (a.email || "").localeCompare(b.email || "");
      else if (sortKey === "event_count_90d") cmp = a.event_count_90d - b.event_count_90d;
      else if (sortKey === "status") {
        // Active (>0 events) ranks higher than inactive (0)
        cmp = (a.event_count_90d > 0 ? 1 : 0) - (b.event_count_90d > 0 ? 1 : 0);
      } else {
        // last_seen: nulls last when descending, first when ascending
        const aV = a.last_seen || "";
        const bV = b.last_seen || "";
        cmp = aV.localeCompare(bV);
      }
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [data, filter, sortKey, sortAsc, statusFilter]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      // Strings ascending feels right; metrics/dates/status descending feels right
      setSortAsc(k === "name" || k === "email");
    }
  };

  const exportCsv = () => {
    const rows = filteredSorted;
    const header = ["Status", "Name", "Email", "Title", "Last Active", "Events (90d)", "Matched in SF"];
    const csvRows = [
      header.join(","),
      ...rows.map((u) => {
        const status = u.event_count_90d > 0 ? "Active" : "Inactive";
        return [status, u.name, u.email, u.title, u.last_seen, u.event_count_90d, u.matched ? "yes" : "no"]
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",");
      }),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${productDisplayName.replace(/[^\w]+/g, "-")}-users-${accountId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="product-users-loading"><span className="spinner-small" /> Loading users…</div>;
  if (error) return <p className="product-users-error">Failed to load users: {error}</p>;
  if (!data) return null;

  const totalShown = filteredSorted.length;
  const totalKnown = data.users.length;

  return (
    <div className="product-users-section">
      <div className="product-users-summary">
        <strong>{data.activeCount}</strong> active in last 90 days
        {data.totalContactsAtAccount > 0 && (
          <> · <strong>{data.totalContactsAtAccount}</strong> SF contacts at account</>
        )}
        {data.relatedAccounts && data.relatedAccounts.length > 1 && (
          <span className="product-users-related" title={data.relatedAccounts.map((a) => a.account_name || a.account_id).join("\n")}>
            {" "}· combined across <strong>{data.relatedAccounts.length}</strong> related accounts
          </span>
        )}
        {data.warning && <span className="product-users-warning"> · {data.warning}</span>}
      </div>

      <div className="product-users-controls">
        <label className="product-users-status-filter">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive (no activity in 90d)</option>
            <option value="all">All</option>
          </select>
        </label>
        <input
          type="text"
          className="product-users-filter"
          placeholder="Filter by name, email, or title…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="product-users-count">{totalShown} of {totalKnown}</span>
        <button type="button" className="product-users-export" onClick={exportCsv} disabled={totalShown === 0}>
          Export CSV
        </button>
      </div>

      {totalShown === 0 ? (
        <p className="product-users-empty">
          {totalKnown === 0
            ? "No users found for this product at this account."
            : "No users match the current filters."}
        </p>
      ) : (
        <table className="product-users-table">
          <thead>
            <tr>
              <SortHeader label="Status" sortKey="status" current={sortKey} asc={sortAsc} onSort={onSort} />
              <SortHeader label="Name" sortKey="name" current={sortKey} asc={sortAsc} onSort={onSort} />
              <SortHeader label="Email" sortKey="email" current={sortKey} asc={sortAsc} onSort={onSort} />
              <th>Title</th>
              <SortHeader label="Last Active" sortKey="last_seen" current={sortKey} asc={sortAsc} onSort={onSort} />
              <SortHeader label="Events (90d)" sortKey="event_count_90d" current={sortKey} asc={sortAsc} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((u) => {
              const isActive = u.event_count_90d > 0;
              return (
                <tr key={u.keycloak_id} className={isActive ? "" : "product-users-inactive"}>
                  <td>
                    <span className={`status-badge ${isActive ? "active" : "inactive"}`}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{u.name || (u.matched ? "—" : <em>(no SF contact)</em>)}</td>
                  <td>{u.email ? <a href={`mailto:${u.email}`}>{u.email}</a> : "—"}</td>
                  <td>{u.title || "—"}</td>
                  <td>{u.last_seen || "—"}</td>
                  <td>{u.event_count_90d.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  asc,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  asc: boolean;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th className="sortable" onClick={() => onSort(sortKey)} role="button" tabIndex={0}>
      {label}{active && <span className="sort-arrow">{asc ? " ▲" : " ▼"}</span>}
    </th>
  );
}

export function UnifiedUsageSection({ enterpriseUuid, accountName, salesforceAccountId, monitorDomain, subscriptions }: Props) {
  const [data, setData] = useState<UnifiedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchUnifiedUsageMetrics(enterpriseUuid || "", monitorDomain, accountName)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load usage data"))
      .finally(() => setLoading(false));
  }, [enterpriseUuid, monitorDomain, accountName]);

  const toggleProduct = (slug: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="unified-usage-loading">
        <div className="spinner-small" />
        <span>Loading usage data for {accountName}...</span>
      </div>
    );
  }

  if (error) {
    return <p className="usage-error">Failed to load usage data: {error}</p>;
  }

  if (!data?.products || Object.keys(data.products).length === 0) {
    return <p className="usage-no-data">No usage data available.</p>;
  }

  const productList = Object.values(data.products);

  return (
    <div className="unified-usage-section">
      {productList.map((product) => {
        const hasAmplitudeData = product.events.some((e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0);
        const expanded = expandedProducts.has(product.slug);
        const subsSummary = subscriptions ? getProductSubscriptionSummary(product.slug, subscriptions) : null;
        const hasLicense = subsSummary && (subsSummary.licensed > 0 || subsSummary.isMonitor);
        const hasSubsActivity = subsSummary?.isMonitor ? (subsSummary.pagesUsed || 0) > 0 : (subsSummary?.assigned || 0) > 0;
        const hasAnyData = hasAmplitudeData || hasSubsActivity;

        return (
          <div key={product.slug} className={`unified-product-card ${expanded ? "expanded" : ""}`}>
            <div
              className="unified-product-header"
              onClick={() => toggleProduct(product.slug)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProduct(product.slug); } }}
              aria-expanded={expanded}
            >
              <div className="unified-product-info">
                <span className="unified-product-name">{product.displayName}</span>
                {hasLicense && subsSummary!.isMonitor ? (
                  <span className="unified-product-seats">
                    {subsSummary!.pagesUsed!.toLocaleString()}{subsSummary!.pageCapacity === -1 ? " pages (unlimited)" : `/${subsSummary!.pageCapacity!.toLocaleString()} pages (${subsSummary!.pagePct}%)`}
                  </span>
                ) : hasLicense ? (
                  <span className="unified-product-seats">{subsSummary!.assigned}/{subsSummary!.licensed} seats ({subsSummary!.pct}%)</span>
                ) : null}
                {hasAnyData ? (
                  <span className="unified-product-badge active">Active</span>
                ) : (
                  <span className="unified-product-badge inactive">No data</span>
                )}
              </div>
              <span className="expand-icon">{expanded ? "\u25BC" : "\u25B6"}</span>
            </div>

            {expanded && (
              <div className="unified-product-body">
                <ProductMetricsTable product={product} subsSummary={subsSummary} />
                {salesforceAccountId && (
                  <ProductUsersList
                    productSlug={product.slug}
                    productDisplayName={product.displayName}
                    accountId={salesforceAccountId}
                    orgKeys={getOrgKeysForAccount(enterpriseUuid, accountName)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
