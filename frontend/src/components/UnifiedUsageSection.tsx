import { useEffect, useState } from "react";
import { fetchUnifiedUsageMetrics, type UnifiedUsageResponse, type UnifiedProductMetrics, type EnterpriseSubscription } from "../services/api";

interface Props {
  enterpriseUuid: string;
  accountName: string;
  monitorDomain?: string;
  subscriptions?: EnterpriseSubscription[];
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

export function UnifiedUsageSection({ enterpriseUuid, accountName, monitorDomain, subscriptions }: Props) {
  const [data, setData] = useState<UnifiedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchUnifiedUsageMetrics(enterpriseUuid, monitorDomain)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load usage data"))
      .finally(() => setLoading(false));
  }, [enterpriseUuid, monitorDomain]);

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
        const hasAnyData = product.events.some((e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0);
        const expanded = expandedProducts.has(product.slug);
        const subsSummary = subscriptions ? getProductSubscriptionSummary(product.slug, subscriptions) : null;
        const hasLicense = subsSummary && (subsSummary.licensed > 0 || subsSummary.isMonitor);

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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
