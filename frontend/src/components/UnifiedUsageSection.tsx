import { useEffect, useState } from "react";
import { fetchUnifiedUsageMetrics, type UnifiedUsageResponse, type UnifiedProductMetrics } from "../services/api";

interface Props {
  enterpriseUuid: string;
  accountName: string;
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

function ProductMetricsTable({ product }: { product: UnifiedProductMetrics }) {
  const activeEvents = product.events.filter((e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0);

  if (activeEvents.length === 0) {
    return <p className="usage-no-data">No usage data available for this product.</p>;
  }

  const labels = activeEvents[0]?.labels || ["", "", ""];

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
        {activeEvents.map((evt) => (
          <tr key={evt.event}>
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

export function UnifiedUsageSection({ enterpriseUuid, accountName }: Props) {
  const [data, setData] = useState<UnifiedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchUnifiedUsageMetrics(enterpriseUuid)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load usage data"))
      .finally(() => setLoading(false));
  }, [enterpriseUuid]);

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
                <ProductMetricsTable product={product} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
