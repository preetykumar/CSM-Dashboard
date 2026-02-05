import { useState, useEffect } from "react";
import {
  fetchCSMPortfolios,
  fetchAmplitudeProducts,
  fetchAllAmplitudeSummaries,
  fetchAmplitudeUsageByOrg,
  fetchEnterpriseSubscriptionsByName,
  fetchAccountsWithSubscriptions,
  AmplitudeProduct,
  AmplitudeUsageSummary,
  AmplitudeOrgUsageSummary,
  EnterpriseSubscription,
} from "../services/api";
import { LicenseBanner } from "./LicenseBanner";
import { Pagination, usePagination } from "./Pagination";
import type { CSMPortfolio, Organization } from "../types";

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedCustomer {
  accountName: string;
  organizations: Organization[];
}

interface CustomerUsageData {
  summaries: AmplitudeOrgUsageSummary[];
  subscriptions: EnterpriseSubscription[];
  loading: boolean;
  loadingSubscriptions: boolean;
  error?: string;
}

// Consolidate customers within a portfolio by SF account name, filtered to only those with subscriptions
function consolidateCustomers(
  customers: { organization: Organization }[],
  subscriptionFilter?: Set<string>
): ConsolidatedCustomer[] {
  const accountMap = new Map<string, Organization[]>();

  for (const customer of customers) {
    const org = customer.organization;
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(org);
    accountMap.set(accountName, existing);
  }

  let accounts = Array.from(accountMap.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));

  // Filter to only accounts with subscriptions if filter is provided
  if (subscriptionFilter && subscriptionFilter.size > 0) {
    accounts = accounts.filter((account) => subscriptionFilter.has(account.accountName));
  }

  return accounts;
}

export function CSMUsageView() {
  const [portfolios, setPortfolios] = useState<CSMPortfolio[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [aggregateSummaries, setAggregateSummaries] = useState<AmplitudeUsageSummary[]>([]);
  const [accountsWithSubscriptions, setAccountsWithSubscriptions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expandedCSM, setExpandedCSM] = useState<number | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [customerUsage, setCustomerUsage] = useState<Map<string, CustomerUsageData>>(new Map());
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [portfolioData, prods, summaries, accountsWithSubs] = await Promise.all([
          fetchCSMPortfolios(),
          fetchAmplitudeProducts(),
          fetchAllAmplitudeSummaries(),
          fetchAccountsWithSubscriptions(),
        ]);
        setPortfolios(portfolioData.portfolios);
        setIsAdmin(portfolioData.isAdmin);
        setProducts(prods);
        setAggregateSummaries(summaries);
        setAccountsWithSubscriptions(new Set(accountsWithSubs.accountNames));
      } catch (err) {
        console.error("Failed to load data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Load usage data and subscriptions for a customer when expanded
  const loadCustomerUsage = async (key: string, orgName: string) => {
    if (customerUsage.has(key) && !customerUsage.get(key)?.error) {
      return; // Already loaded
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, { summaries: [], subscriptions: [], loading: true, loadingSubscriptions: true });
      return newMap;
    });

    // Fetch usage and subscriptions in parallel
    const [usageResult, subscriptionResult] = await Promise.allSettled([
      fetchAmplitudeUsageByOrg(orgName),
      fetchEnterpriseSubscriptionsByName(orgName),
    ]);

    const summaries = usageResult.status === "fulfilled" ? usageResult.value.summaries : [];
    const subscriptions = subscriptionResult.status === "fulfilled" ? subscriptionResult.value.subscriptions : [];
    const error = usageResult.status === "rejected"
      ? (usageResult.reason instanceof Error ? usageResult.reason.message : "Failed to load usage")
      : undefined;

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, {
        summaries,
        subscriptions,
        loading: false,
        loadingSubscriptions: false,
        error,
      });
      return newMap;
    });
  };

  // Apply pagination to portfolios
  const paginatedPortfolios = usePagination(portfolios, pageSize, currentPage);

  const toggleCSM = (csmId: number) => {
    setExpandedCSM(expandedCSM === csmId ? null : csmId);
  };

  const toggleCustomer = (key: string, orgName: string) => {
    if (expandedCustomer === key) {
      setExpandedCustomer(null);
    } else {
      setExpandedCustomer(key);
      loadCustomerUsage(key, orgName);
    }
  };

  if (loading) {
    return (
      <div className="usage-view">
        <div className="loading">Loading CSM portfolios and usage data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="usage-view">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (portfolios.length === 0) {
    return (
      <div className="usage-view">
        <div className="usage-empty">
          <p>No CSM portfolios found.</p>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="usage-view">
        <div className="usage-empty">
          <p>No products configured for usage tracking.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="usage-view csm-usage-view">
      {/* Aggregate Summary */}
      <div className="usage-aggregate-section">
        <h2>Aggregate Usage (All Organizations)</h2>
        <div className="usage-products-grid">
          {aggregateSummaries.map((summary) => (
            <div key={summary.slug || summary.product} className="usage-product-card">
              <h3>{summary.product}</h3>
              {summary.error ? (
                <p className="usage-error">Error loading data</p>
              ) : (
                <div className="usage-metrics">
                  <div className="usage-period">
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
                  <div className="usage-period">
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
            </div>
          ))}
        </div>
      </div>

      {/* CSM Portfolios */}
      <div className="usage-csm-section">
        <h2>Usage by CSM Portfolio</h2>
        {isAdmin && (
          <div className="admin-banner">
            <span className="admin-badge">Admin View</span>
            <span className="admin-info">Viewing all {portfolios.length} CSM portfolios</span>
          </div>
        )}

        <Pagination
          totalItems={portfolios.length}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />

        <div className="csm-usage-list">
          {paginatedPortfolios.map((portfolio) => {
            const isCSMExpanded = expandedCSM === portfolio.csm.id;

            return (
              <div key={portfolio.csm.id} className={`csm-usage-card ${isCSMExpanded ? "expanded" : ""}`}>
                <button
                  className="csm-usage-header"
                  onClick={() => toggleCSM(portfolio.csm.id)}
                  aria-expanded={isCSMExpanded}
                >
                  <div className="csm-info">
                    <span className="csm-name">{portfolio.csm.name}</span>
                    <span className="csm-email">{portfolio.csm.email}</span>
                  </div>
                  <div className="csm-stats">
                    <span className="stat">{consolidateCustomers(portfolio.customers, accountsWithSubscriptions).length} customers</span>
                  </div>
                  <span className="expand-icon">{isCSMExpanded ? "▼" : "▶"}</span>
                </button>

                {isCSMExpanded && (
                  <div className="csm-usage-content">
                    {consolidateCustomers(portfolio.customers, accountsWithSubscriptions).length === 0 ? (
                      <p className="no-customers">No customers with active subscriptions in this portfolio</p>
                    ) : (
                      <div className="csm-customers-list">
                        {consolidateCustomers(portfolio.customers, accountsWithSubscriptions).map((consolidatedCustomer) => {
                          const key = `${portfolio.csm.id}-${consolidatedCustomer.accountName}`;
                          const isCustomerExpanded = expandedCustomer === key;
                          const usageData = customerUsage.get(key);

                          return (
                            <div
                              key={key}
                              className={`customer-usage-card ${isCustomerExpanded ? "expanded" : ""}`}
                            >
                              <button
                                className="customer-usage-header"
                                onClick={() => toggleCustomer(key, consolidatedCustomer.accountName)}
                                aria-expanded={isCustomerExpanded}
                              >
                                <span className="customer-name">{consolidatedCustomer.accountName}</span>
                                {consolidatedCustomer.organizations.length > 1 && (
                                  <span className="org-count">({consolidatedCustomer.organizations.length} orgs)</span>
                                )}
                                <span className="expand-hint">
                                  {isCustomerExpanded ? "Hide usage" : "View usage"}
                                </span>
                                <span className="expand-icon">{isCustomerExpanded ? "▼" : "▶"}</span>
                              </button>

                              {isCustomerExpanded && (
                                <div className="customer-usage-content">
                                  {/* License Banner */}
                                  <LicenseBanner
                                    subscriptions={usageData?.subscriptions || []}
                                    loading={usageData?.loadingSubscriptions}
                                    accountName={!usageData?.loadingSubscriptions && usageData?.subscriptions?.length === 0
                                      ? consolidatedCustomer.accountName
                                      : undefined
                                    }
                                    compact
                                  />

                                  {/* Usage Data */}
                                  {usageData?.loading ? (
                                    <div className="usage-loading">Loading usage data...</div>
                                  ) : usageData?.error ? (
                                    <div className="usage-error">{usageData.error}</div>
                                  ) : usageData?.summaries && usageData.summaries.length > 0 ? (
                                    <div className="usage-products-grid compact">
                                      {usageData.summaries.map((summary) => {
                                        const hasData =
                                          summary.last7Days.activeUsers > 0 ||
                                          summary.last30Days.activeUsers > 0;

                                        return (
                                          <div
                                            key={summary.slug || summary.product}
                                            className={`usage-product-card compact ${!hasData ? "no-data" : ""}`}
                                          >
                                            <h4>{summary.product}</h4>
                                            {summary.error ? (
                                              <p className="usage-error">Error</p>
                                            ) : !hasData ? (
                                              <p className="usage-no-data">No usage</p>
                                            ) : (
                                              <div className="usage-metrics compact">
                                                <div className="usage-period">
                                                  <span className="period-label">7d</span>
                                                  <span className="metric-active">
                                                    {summary.last7Days.activeUsers.toLocaleString()}
                                                  </span>
                                                </div>
                                                <div className="usage-period">
                                                  <span className="period-label">30d</span>
                                                  <span className="metric-active">
                                                    {summary.last30Days.activeUsers.toLocaleString()}
                                                  </span>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="usage-no-data">No usage data available</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
