import { useState, useEffect, useMemo } from "react";
import {
  fetchOrganizations,
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
import type { Organization } from "../types";

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedAccount {
  accountName: string; // SF account name or Zendesk org name
  organizations: Organization[]; // All Zendesk orgs mapped to this account
}

interface CustomerUsageData {
  accountName: string;
  summaries: AmplitudeOrgUsageSummary[];
  subscriptions: EnterpriseSubscription[];
  loading: boolean;
  loadingSubscriptions: boolean;
  error?: string;
}

// Group organizations by salesforce_account_name to consolidate duplicates
function consolidateOrganizations(orgs: Organization[]): ConsolidatedAccount[] {
  const accountMap = new Map<string, Organization[]>();

  for (const org of orgs) {
    // Use SF account name if available, otherwise use Zendesk org name
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(org);
    accountMap.set(accountName, existing);
  }

  // Convert map to array and sort by account name
  return Array.from(accountMap.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

export function CustomerUsageView() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [aggregateSummaries, setAggregateSummaries] = useState<AmplitudeUsageSummary[]>([]);
  const [accountsWithSubscriptions, setAccountsWithSubscriptions] = useState<Set<string>>(new Set());
  const [customerUsage, setCustomerUsage] = useState<Map<string, CustomerUsageData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [orgs, prods, summaries, accountsWithSubs] = await Promise.all([
          fetchOrganizations(),
          fetchAmplitudeProducts(),
          fetchAllAmplitudeSummaries(),
          fetchAccountsWithSubscriptions(),
        ]);
        setOrganizations(orgs);
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

  // Consolidate organizations by SF account name, filtered to only those with subscriptions
  const consolidatedAccounts = useMemo(() => {
    const allAccounts = consolidateOrganizations(organizations);
    // Only show accounts that have active subscriptions
    if (accountsWithSubscriptions.size === 0) return [];
    return allAccounts.filter((account) => accountsWithSubscriptions.has(account.accountName));
  }, [organizations, accountsWithSubscriptions]);

  // Filter consolidated accounts by search
  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return consolidatedAccounts;
    const query = searchQuery.toLowerCase();
    return consolidatedAccounts.filter((account) =>
      account.accountName.toLowerCase().includes(query) ||
      account.organizations.some((org) => org.name.toLowerCase().includes(query))
    );
  }, [consolidatedAccounts, searchQuery]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Apply pagination to filtered accounts
  const paginatedAccounts = usePagination(filteredAccounts, pageSize, currentPage);

  // Load usage data and subscriptions for an account when expanded
  const loadAccountUsage = async (account: ConsolidatedAccount) => {
    if (customerUsage.has(account.accountName) && !customerUsage.get(account.accountName)?.error) {
      return; // Already loaded
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(account.accountName, {
        accountName: account.accountName,
        summaries: [],
        subscriptions: [],
        loading: true,
        loadingSubscriptions: true,
      });
      return newMap;
    });

    // Fetch usage and subscriptions in parallel
    const [usageResult, subscriptionResult] = await Promise.allSettled([
      fetchAmplitudeUsageByOrg(account.accountName),
      fetchEnterpriseSubscriptionsByName(account.accountName),
    ]);

    const summaries = usageResult.status === "fulfilled" ? usageResult.value.summaries : [];
    const subscriptions = subscriptionResult.status === "fulfilled" ? subscriptionResult.value.subscriptions : [];
    const error = usageResult.status === "rejected"
      ? (usageResult.reason instanceof Error ? usageResult.reason.message : "Failed to load usage")
      : undefined;

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(account.accountName, {
        accountName: account.accountName,
        summaries,
        subscriptions,
        loading: false,
        loadingSubscriptions: false,
        error,
      });
      return newMap;
    });
  };

  const toggleAccount = (account: ConsolidatedAccount) => {
    setExpandedAccounts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(account.accountName)) {
        newSet.delete(account.accountName);
      } else {
        newSet.add(account.accountName);
        loadAccountUsage(account);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="usage-view">
        <div className="loading">Loading usage data...</div>
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
    <div className="usage-view">
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

      {/* Customer List */}
      <div className="usage-customer-section">
        <div className="usage-section-header">
          <h2>Usage by Customer</h2>
          <div className="usage-search">
            <input
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="usage-search-input"
            />
            {searchQuery && (
              <button
                className="usage-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <Pagination
          totalItems={filteredAccounts.length}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />

        <div className="usage-customer-list">
          {filteredAccounts.length === 0 ? (
            <p className="no-results">
              {searchQuery ? "No customers match your search." : "No customers with active subscriptions found."}
            </p>
          ) : (
            paginatedAccounts.map((account) => {
              const isExpanded = expandedAccounts.has(account.accountName);
              const usageData = customerUsage.get(account.accountName);

              return (
                <div key={account.accountName} className={`usage-customer-card ${isExpanded ? "expanded" : ""}`}>
                  <button
                    className="usage-customer-header"
                    onClick={() => toggleAccount(account)}
                    aria-expanded={isExpanded}
                  >
                    <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
                    <span className="customer-name">{account.accountName}</span>
                    {account.organizations.length > 1 && (
                      <span className="org-count">({account.organizations.length} orgs)</span>
                    )}
                    <span className="expand-hint">
                      {isExpanded ? "Click to collapse" : "Click to view usage"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="usage-customer-content">
                      {/* License Banner */}
                      <LicenseBanner
                        subscriptions={usageData?.subscriptions || []}
                        loading={usageData?.loadingSubscriptions}
                        accountName={!usageData?.loadingSubscriptions && usageData?.subscriptions?.length === 0
                          ? account.accountName
                          : undefined
                        }
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
                                className={`usage-product-card ${!hasData ? "no-data" : ""}`}
                              >
                                <h4>{summary.product}</h4>
                                {summary.error ? (
                                  <p className="usage-error">Error</p>
                                ) : !hasData ? (
                                  <p className="usage-no-data">No usage recorded</p>
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
