import { useState, useEffect } from "react";
import {
  fetchAmplitudeProducts,
  fetchAllAmplitudeSummaries,
  fetchAmplitudeUsage,
  AmplitudeProduct,
  AmplitudeUsageSummary,
  AmplitudeUsageData,
} from "../services/api";

interface UsagePanelProps {
  className?: string;
}

export function UsagePanel({ className = "" }: UsagePanelProps) {
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [summaries, setSummaries] = useState<AmplitudeUsageSummary[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [detailedUsage, setDetailedUsage] = useState<AmplitudeUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load products and summaries
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [productsData, summariesData] = await Promise.all([
          fetchAmplitudeProducts(),
          fetchAllAmplitudeSummaries(),
        ]);
        setProducts(productsData);
        setSummaries(summariesData);
      } catch (err) {
        console.error("Failed to load Amplitude data:", err);
        setError(err instanceof Error ? err.message : "Failed to load usage data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Load detailed usage when product is selected
  useEffect(() => {
    if (!selectedProduct) {
      setDetailedUsage(null);
      return;
    }

    const productSlug = selectedProduct; // Capture for async closure
    async function loadDetail() {
      try {
        setDetailLoading(true);
        const data = await fetchAmplitudeUsage(productSlug, 30);
        setDetailedUsage(data);
      } catch (err) {
        console.error("Failed to load detailed usage:", err);
      } finally {
        setDetailLoading(false);
      }
    }
    loadDetail();
  }, [selectedProduct]);

  if (loading) {
    return (
      <div className={`usage-panel ${className}`}>
        <h2 className="panel-title">Usage Data</h2>
        <div className="usage-loading">Loading usage data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`usage-panel ${className}`}>
        <h2 className="panel-title">Usage Data</h2>
        <div className="usage-error">
          <p>{error}</p>
          <p className="usage-error-hint">Usage analytics may not be configured.</p>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className={`usage-panel ${className}`}>
        <h2 className="panel-title">Usage Data</h2>
        <div className="usage-empty">
          <p>No products configured for usage tracking.</p>
          <p className="usage-hint">Contact admin to configure Amplitude integration.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`usage-panel ${className}`}>
      <h2 className="panel-title">Usage Data</h2>

      {/* Product Summaries */}
      <div className="usage-summaries">
        {summaries.map((summary, index) => {
          const product = products.find((p) => p.slug === summary.slug);
          const isSelected = selectedProduct === summary.slug;

          return (
            <div
              key={summary.slug || summary.product || `summary-${index}`}
              className={`usage-product-card ${isSelected ? "selected" : ""}`}
              onClick={() => setSelectedProduct(isSelected ? null : summary.slug || null)}
            >
              <h3 className="usage-product-name">{summary.product}</h3>

              {summary.error ? (
                <p className="usage-product-error">Error: {summary.error}</p>
              ) : (
                <div className="usage-metrics">
                  <div className="usage-metric">
                    <span className="metric-label">Last 7 days</span>
                    <div className="metric-values">
                      <span className="metric-value active">
                        {summary.last7Days.activeUsers.toLocaleString()} active
                      </span>
                      <span className="metric-value new">
                        +{summary.last7Days.newUsers.toLocaleString()} new
                      </span>
                    </div>
                  </div>
                  <div className="usage-metric">
                    <span className="metric-label">Last 30 days</span>
                    <div className="metric-values">
                      <span className="metric-value active">
                        {summary.last30Days.activeUsers.toLocaleString()} active
                      </span>
                      <span className="metric-value new">
                        +{summary.last30Days.newUsers.toLocaleString()} new
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {product && (
                <span className="usage-project-id">Project: {product.projectId}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed View */}
      {selectedProduct && (
        <div className="usage-detail">
          {detailLoading ? (
            <div className="usage-detail-loading">Loading details...</div>
          ) : detailedUsage ? (
            <>
              <h4 className="usage-detail-title">
                {detailedUsage.product} - Daily Activity
              </h4>
              <div className="usage-chart">
                {detailedUsage.dailyUsage.slice(-14).map((day) => (
                  <div key={day.date} className="usage-day">
                    <div
                      className="usage-bar active"
                      style={{
                        height: `${Math.min(100, (day.activeUsers / Math.max(...detailedUsage.dailyUsage.map(d => d.activeUsers))) * 100)}%`,
                      }}
                      title={`Active: ${day.activeUsers}`}
                    />
                    <div
                      className="usage-bar new"
                      style={{
                        height: `${Math.min(100, (day.newUsers / Math.max(1, ...detailedUsage.dailyUsage.map(d => d.newUsers))) * 100)}%`,
                      }}
                      title={`New: ${day.newUsers}`}
                    />
                    <span className="usage-day-label">
                      {new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="usage-legend">
                <span className="legend-item active">Active Users</span>
                <span className="legend-item new">New Users</span>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
