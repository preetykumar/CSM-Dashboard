import { useEffect, useState } from "react";
import { fetchAggregateUsageMetrics, type UnifiedUsageResponse, type UnifiedProductMetrics } from "../services/api";

type Trend = "improving" | "worsening" | "flat" | null;

function computeTrend(current: number, previous: number): Trend {
  if (previous === 0 && current === 0) return null;
  if (previous === 0 && current > 0) return "improving";
  if (previous === 0) return "flat";
  const pctChange = (current - previous) / previous;
  if (pctChange > 0.15) return "improving";
  if (pctChange < -0.15) return "worsening";
  return "flat";
}

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  const trend = computeTrend(current, previous);
  if (!trend) return null;
  const config = {
    improving: { arrow: "\u2191", color: "#16a34a" },
    worsening: { arrow: "\u2193", color: "#dc2626" },
    flat: { arrow: "\u2192", color: "#6b7280" },
  };
  const { arrow, color } = config[trend];
  const pctChange = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
  return (
    <span className="health-trend-arrow" style={{ color }} title={`${pctChange > 0 ? "+" : ""}${pctChange}% vs previous month`}>
      {arrow}
    </span>
  );
}

function ProductCard({ product, expanded, onToggle }: { product: UnifiedProductMetrics; expanded: boolean; onToggle: () => void }) {
  const activeEvents = product.events.filter((e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0);
  const hasData = activeEvents.length > 0;

  // Compute headline metric: first "Active Users" or "Unique User Logins" event
  const activeUsersEvt = product.events.find((e) => e.metric === "uniques");
  const totalEvt = product.events.find((e) => e.metric === "totals" && e.current > 0);

  return (
    <div className={`product-usage-card ${expanded ? "expanded" : ""}`}>
      <div
        className="product-usage-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        aria-expanded={expanded}
      >
        <div className="product-usage-info">
          <span className="product-usage-name">{product.displayName}</span>
          {hasData ? (
            <span className="product-usage-headline">
              {activeUsersEvt && activeUsersEvt.current > 0 && (
                <span className="product-metric-badge">
                  {activeUsersEvt.current.toLocaleString()} active users
                  <TrendArrow current={activeUsersEvt.current} previous={activeUsersEvt.previous} />
                </span>
              )}
              {totalEvt && (
                <span className="product-metric-badge secondary">
                  {totalEvt.current.toLocaleString()} {totalEvt.label.toLowerCase()}
                  <TrendArrow current={totalEvt.current} previous={totalEvt.previous} />
                </span>
              )}
            </span>
          ) : (
            <span className="unified-product-badge inactive">No data</span>
          )}
        </div>
        <span className="expand-icon">{expanded ? "\u25BC" : "\u25B6"}</span>
      </div>

      {expanded && hasData && (
        <div className="product-usage-body">
          <table className="devtools-metrics-table">
            <thead>
              <tr>
                <th className="metric-label-col">Metric</th>
                <th className="quarter-col">{activeEvents[0]?.labels?.[2] || ""}</th>
                <th className="quarter-col">{activeEvents[0]?.labels?.[1] || ""}</th>
                <th className="quarter-col current">{activeEvents[0]?.labels?.[0] || ""}</th>
              </tr>
            </thead>
            <tbody>
              {activeEvents.map((evt, i) => (
                <tr key={`${evt.event}-${evt.metric}-${i}`}>
                  <td className="metric-label-col">{evt.label}</td>
                  <td className="quarter-col">{evt.twoAgo.toLocaleString()}</td>
                  <td className="quarter-col">{evt.previous.toLocaleString()}</td>
                  <td className="quarter-col current">
                    {evt.current.toLocaleString()}
                    <TrendArrow current={evt.current} previous={evt.previous} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProductUsageView() {
  const [data, setData] = useState<UnifiedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAggregateUsageMetrics()
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

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
      <div className="product-usage-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading aggregate usage data across all customers...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="product-usage-view"><div className="error">{error}</div></div>;
  }

  if (!data?.products) {
    return <div className="product-usage-view"><p>No usage data available.</p></div>;
  }

  const productList = Object.values(data.products);

  return (
    <div className="product-usage-view">
      <div className="product-usage-view-header">
        <h2>Product Usage (All Customers)</h2>
        <span className="section-count">{productList.length} products</span>
      </div>

      <div className="product-usage-list">
        {productList.map((product) => (
          <ProductCard
            key={product.slug}
            product={product}
            expanded={expandedProducts.has(product.slug)}
            onToggle={() => toggleProduct(product.slug)}
          />
        ))}
      </div>
    </div>
  );
}
