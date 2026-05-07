import { useState, useEffect, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import {
  fetchCSMPortfolios,
  fetchAmplitudeProducts,
  fetchEnterpriseSubscriptionsByName,
  fetchEnterpriseSubscriptionsById,
  fetchAccountsWithSubscriptions,
  AmplitudeProduct,
  EnterpriseSubscription,
} from "../services/api";
import { Pagination, usePagination } from "./Pagination";
import { UnifiedUsageSection } from "./UnifiedUsageSection";
import { CustomerHealthCard } from "./CustomerHealthCard";
import { useChurnedAccounts } from "../hooks/useChurnedAccounts";
import type { CSMPortfolio, Organization } from "../types";

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedCustomer {
  accountName: string;
  organizations: Organization[];
}

interface CustomerUsageData {
  accountName: string;
  subscriptions: EnterpriseSubscription[];
  loading: boolean;
  loadingSubscriptions: boolean;
  error?: string;
}

// Consolidate customers within a portfolio by SF account name. Keeps accounts that either have an
// active subscription or are flagged as churned (so CSMs can review churned customers' past usage).
function consolidateCustomers(
  customers: { organization: Organization }[],
  subscriptionFilter?: Set<string>,
  churnedNames?: Set<string>
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

  if (subscriptionFilter && subscriptionFilter.size > 0) {
    accounts = accounts.filter((account) =>
      subscriptionFilter.has(account.accountName) ||
      (churnedNames?.has(account.accountName.toLowerCase()) ?? false)
    );
  }

  return accounts;
}

export function CSMUsageView() {
  const { churnedAccountNames } = useChurnedAccounts();
  const [portfolios, setPortfolios] = useState<CSMPortfolio[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [accountsWithSubscriptions, setAccountsWithSubscriptions] = useState<Set<string>>(new Set());
  const [customerUsage, setCustomerUsage] = useState<Map<string, CustomerUsageData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expandedCSM, setExpandedCSM] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [portfolioData, prods, accountsWithSubs] = await Promise.all([
          fetchCSMPortfolios(),
          fetchAmplitudeProducts(),
          fetchAccountsWithSubscriptions(),
        ]);
        setPortfolios(portfolioData.portfolios);
        setIsAdmin(portfolioData.isAdmin);
        setProducts(prods);
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

  // Load account data (subscriptions)
  const loadAccountUsage = useCallback(async (key: string, accountName: string, accountId?: string) => {
    if (customerUsage.has(key) && !customerUsage.get(key)?.error) {
      return;
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, {
        accountName,
        subscriptions: [],
        loading: true,
        loadingSubscriptions: true,
      });
      return newMap;
    });

    try {
      const subscriptionResult = accountId
        ? await fetchEnterpriseSubscriptionsById(accountId)
        : await fetchEnterpriseSubscriptionsByName(accountName);
      const subscriptions = subscriptionResult.subscriptions;

      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(key, {
          accountName,
          subscriptions,
          loading: false,
          loadingSubscriptions: false,
        });
        return newMap;
      });
    } catch (err) {
      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(key, {
          accountName,
          subscriptions: [],
          loading: false,
          loadingSubscriptions: false,
          error: err instanceof Error ? err.message : "Failed to load subscriptions",
        });
        return newMap;
      });
    }
  }, [customerUsage]);

  const sortedPortfolios = useMemo(() => {
    return [...portfolios].sort((a, b) => a.csm.name.localeCompare(b.csm.name));
  }, [portfolios]);

  // Filter portfolios by search query — match against any consolidated customer's
  // SF account name, Zendesk org name, or domain (so "ihg" finds InterContinental Hotels Group).
  const filteredPortfolios = useMemo(() => {
    if (!searchQuery.trim()) return sortedPortfolios;
    const q = searchQuery.toLowerCase();
    return sortedPortfolios.filter((portfolio) => {
      const consolidated = consolidateCustomers(portfolio.customers, accountsWithSubscriptions, churnedAccountNames);
      return consolidated.some((account) =>
        account.accountName.toLowerCase().includes(q) ||
        account.organizations.some((org) =>
          org.name.toLowerCase().includes(q) ||
          (org.domain_names || []).some((d) => d.toLowerCase().includes(q))
        )
      );
    });
  }, [sortedPortfolios, searchQuery, accountsWithSubscriptions, churnedAccountNames]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const paginatedPortfolios = usePagination(filteredPortfolios, pageSize, currentPage);

  const toggleCSM = (csmEmail: string) => {
    setExpandedCSM(expandedCSM === csmEmail ? null : csmEmail);
  };

  const toggleCustomer = useCallback((key: string, accountName: string, accountId?: string) => {
    if (expandedCustomer === key) {
      setExpandedCustomer(null);
    } else {
      setExpandedCustomer(key);
      loadAccountUsage(key, accountName, accountId);
    }
  }, [expandedCustomer, loadAccountUsage]);

  if (loading) {
    return (
      <div className="usage-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading CSM portfolios...</span>
        </div>
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
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {portfolios.length} CSM portfolios</span>
        </div>
      )}
      <div className="renewal-card">
        <div className="renewal-filter-bar">
          <div className="renewal-search-wrapper">
            <Search size={16} className="renewal-search-icon" />
            <input
              type="text"
              placeholder="Search by account, org, or domain (e.g. 'ihg')…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="renewal-search-input"
            />
          </div>
        </div>
      </div>
      <Pagination
        totalItems={filteredPortfolios.length}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />

      <div className="csm-list">
        {paginatedPortfolios.map((portfolio) => {
          const allConsolidated = consolidateCustomers(portfolio.customers, accountsWithSubscriptions, churnedAccountNames);
          const q = searchQuery.trim().toLowerCase();
          const hasSearch = q.length > 0;
          const consolidatedCustomers = hasSearch
            ? allConsolidated.filter((account) =>
                account.accountName.toLowerCase().includes(q) ||
                account.organizations.some((org) =>
                  org.name.toLowerCase().includes(q) ||
                  (org.domain_names || []).some((d) => d.toLowerCase().includes(q))
                )
              )
            : allConsolidated;
          // Auto-expand CSM cards while a search is active — every visible
          // portfolio is a match, so collapsing them would hide the result
          // the user is searching for.
          const isCSMExpanded = hasSearch || expandedCSM === portfolio.csm.email;

          return (
            <div key={portfolio.csm.email} className={`csm-card ${isCSMExpanded ? "expanded" : ""}`}>
              <div
                className="csm-header"
                onClick={() => toggleCSM(portfolio.csm.email)}
                role="button"
                tabIndex={0}
                aria-expanded={isCSMExpanded}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCSM(portfolio.csm.email);
                  }
                }}
              >
                <div className="csm-info">
                  <h3>{portfolio.csm.name}</h3>
                  <span className="csm-email">{portfolio.csm.email}</span>
                </div>
                <div className="csm-stats">
                  <div className="csm-stat">
                    <span className="value">{consolidatedCustomers.length}</span>
                    <span className="label">Customers</span>
                  </div>
                </div>
                <span className="expand-icon">{isCSMExpanded ? "▼" : "▶"}</span>
              </div>

              {isCSMExpanded && (
                <div className="csm-customers">
                  {consolidatedCustomers.length === 0 ? (
                    <p className="no-customers">No customers with active subscriptions in this portfolio</p>
                  ) : (
                    consolidatedCustomers.map((customer) => {
                        const customerKey = `${portfolio.csm.email}:${customer.accountName}`;
                        const isCustomerExpanded = expandedCustomer === customerKey;
                        const usageData = customerUsage.get(customerKey);
                        const subscriptions = usageData?.subscriptions || [];

                        return (
                          <div key={customerKey} className={`customer-card ${isCustomerExpanded ? "expanded" : ""}`}>
                            <div
                              className="customer-header"
                              onClick={() => toggleCustomer(customerKey, customer.accountName, customer.organizations[0]?.salesforce_account_id)}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isCustomerExpanded}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleCustomer(customerKey, customer.accountName, customer.organizations[0]?.salesforce_account_id);
                                }
                              }}
                            >
                              <span className="expand-icon">{isCustomerExpanded ? "▼" : "▶"}</span>
                              <span className="customer-name">{customer.accountName}</span>
                              {customer.organizations.length > 1 && (
                                <span className="org-count">({customer.organizations.length} orgs)</span>
                              )}
                              {churnedAccountNames.has(customer.accountName.toLowerCase()) && (
                                <span className="churned-badge" title="Lost a renewal in the last 2 quarters">Churned</span>
                              )}
                            </div>

                            {isCustomerExpanded && (
                              <div className="customer-content">
                                {usageData?.loading ? (
                                  <div className="loading">Loading subscription data...</div>
                                ) : usageData?.error ? (
                                  <div className="error">{usageData.error}</div>
                                ) : (
                                  <>
                                    {(() => {
                                      const euuid = subscriptions.find(s => s.enterpriseUuid)?.enterpriseUuid;
                                      const domain = subscriptions.find(s => s.enterpriseDomain)?.enterpriseDomain?.split('.')[0];
                                      const sfId = customer.organizations.find(o => o.salesforce_account_id)?.salesforce_account_id;
                                      return <CustomerHealthCard accountName={customer.accountName} accountId={sfId} enterpriseUuid={euuid} monitorDomain={domain} subscriptions={subscriptions} />;
                                    })()}
                                    {subscriptions.length > 0 && (() => {
                                      const euuid = subscriptions.find(s => s.enterpriseUuid)?.enterpriseUuid;
                                      const domain = subscriptions.find(s => s.enterpriseDomain)?.enterpriseDomain?.split('.')[0];
                                      const sfId = customer.organizations.find(o => o.salesforce_account_id)?.salesforce_account_id;
                                      // Render the unified view even without an Enterprise UUID — products
                                      // that key off SF account name still resolve, and per-product user lists
                                      // work via SF Contact join.
                                      return (
                                        <UnifiedUsageSection
                                          enterpriseUuid={euuid}
                                          accountName={customer.accountName}
                                          salesforceAccountId={sfId}
                                          monitorDomain={domain}
                                          subscriptions={subscriptions}
                                        />
                                      );
                                    })()}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
