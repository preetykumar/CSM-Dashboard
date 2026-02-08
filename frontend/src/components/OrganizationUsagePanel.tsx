import { useState, useEffect } from "react";
import {
  fetchAmplitudeProducts,
  fetchAllAmplitudeSummaries,
  fetchAmplitudeUsageByOrg,
  AmplitudeProduct,
  AmplitudeUsageSummary,
  AmplitudeOrgUsageSummary,
} from "../services/api";

interface OrganizationUsagePanelProps {
  selectedOrg: { id: number; name: string } | null;
  className?: string;
}

export function OrganizationUsagePanel({
  selectedOrg,
  className = "",
}: OrganizationUsagePanelProps) {
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [aggregateSummaries, setAggregateSummaries] = useState<AmplitudeUsageSummary[]>([]);
  const [orgSummaries, setOrgSummaries] = useState<AmplitudeOrgUsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgLoading, setOrgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load products and aggregate summaries on mount
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
        setAggregateSummaries(summariesData);
      } catch (err) {
        console.error("Failed to load Amplitude data:", err);
        setError(err instanceof Error ? err.message : "Failed to load usage data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Load organization-specific data when org is selected
  useEffect(() => {
    if (!selectedOrg) {
      setOrgSummaries([]);
      return;
    }

    const orgName = selectedOrg.name;
    async function loadOrgData() {
      try {
        setOrgLoading(true);
        const data = await fetchAmplitudeUsageByOrg(orgName);
        setOrgSummaries(data.summaries);
      } catch (err) {
        console.error(`Failed to load usage for ${orgName}:`, err);
        // Don't show error - just show aggregate data
        setOrgSummaries([]);
      } finally {
        setOrgLoading(false);
      }
    }
    loadOrgData();
  }, [selectedOrg]);

  if (loading) {
    return (
      <div className={`org-usage-panel ${className}`}>
        <div className="panel-header">
          <h2 className="panel-title">Usage Analytics</h2>
        </div>
        <div className="usage-loading">Loading usage data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`org-usage-panel ${className}`}>
        <div className="panel-header">
          <h2 className="panel-title">Usage Analytics</h2>
        </div>
        <div className="usage-error">
          <p>{error}</p>
          <p className="usage-error-hint">Usage analytics may not be configured.</p>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className={`org-usage-panel ${className}`}>
        <div className="panel-header">
          <h2 className="panel-title">Usage Analytics</h2>
        </div>
        <div className="usage-empty">
          <p>No products configured for usage tracking.</p>
        </div>
      </div>
    );
  }

  // Display summaries - either org-specific or aggregate
  const displaySummaries = selectedOrg && orgSummaries.length > 0 ? orgSummaries : aggregateSummaries;
  const isOrgView = selectedOrg && orgSummaries.length > 0;

  return (
    <div className={`org-usage-panel ${className}`}>
      <div className="panel-header">
        <h2 className="panel-title">Usage Analytics</h2>
        {selectedOrg && (
          <span className="panel-subtitle">
            {orgLoading ? "Loading..." : isOrgView ? selectedOrg.name : "All Organizations"}
          </span>
        )}
        {!selectedOrg && (
          <span className="panel-subtitle">All Organizations (hover or focus a customer to filter)</span>
        )}
      </div>

      <div className="org-usage-grid">
        {displaySummaries.map((summary, index) => {
          const product = products.find((p) => p.slug === summary.slug);
          const hasData = summary.last7Days.activeUsers > 0 || summary.last30Days.activeUsers > 0;

          return (
            <div
              key={summary.slug || summary.product || `summary-${index}`}
              className={`org-usage-card ${!hasData && isOrgView ? "no-data" : ""}`}
            >
              <h3 className="org-usage-product-name">{summary.product}</h3>

              {summary.error ? (
                <p className="org-usage-error">Error loading data</p>
              ) : (
                <div className="org-usage-metrics">
                  <div className="org-usage-period">
                    <span className="period-label">Last 7 days</span>
                    <div className="period-values">
                      <span className="metric-active">
                        {summary.last7Days.activeUsers.toLocaleString()} active
                      </span>
                      <span className="metric-new">
                        +{summary.last7Days.newUsers.toLocaleString()} new
                      </span>
                    </div>
                  </div>
                  <div className="org-usage-period">
                    <span className="period-label">Last 30 days</span>
                    <div className="period-values">
                      <span className="metric-active">
                        {summary.last30Days.activeUsers.toLocaleString()} active
                      </span>
                      <span className="metric-new">
                        +{summary.last30Days.newUsers.toLocaleString()} new
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {product && (
                <span className="org-usage-project-id">Project: {product.projectId}</span>
              )}

              {!hasData && isOrgView && (
                <div className="org-usage-no-data">No usage recorded for this organization</div>
              )}
            </div>
          );
        })}
      </div>

      {isOrgView && (
        <div className="org-usage-note">
          Showing usage for <strong>{selectedOrg?.name}</strong>
        </div>
      )}
    </div>
  );
}
