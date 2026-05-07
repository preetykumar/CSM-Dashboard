import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchOrganizations,
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
import type { Organization } from "../types";

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedAccount {
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

// Group organizations by salesforce_account_name to consolidate duplicates
function consolidateOrganizations(orgs: Organization[]): ConsolidatedAccount[] {
  const accountMap = new Map<string, Organization[]>();

  for (const org of orgs) {
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(org);
    accountMap.set(accountName, existing);
  }

  return Array.from(accountMap.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

export function CustomerUsageView() {
  const { churnedAccountNames } = useChurnedAccounts();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
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
        const [orgs, prods, accountsWithSubs] = await Promise.all([
          fetchOrganizations(),
          fetchAmplitudeProducts(),
          fetchAccountsWithSubscriptions(),
        ]);
        setOrganizations(orgs);
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

  // Consolidate organizations by SF account name. Keep accounts with active subscriptions OR
  // churned in the last 2 quarters (so users can review churned customers' past usage).
  const consolidatedAccounts = useMemo(() => {
    const allAccounts = consolidateOrganizations(organizations);
    if (accountsWithSubscriptions.size === 0) return [];
    return allAccounts.filter((account) =>
      accountsWithSubscriptions.has(account.accountName) ||
      churnedAccountNames.has(account.accountName.toLowerCase())
    );
  }, [organizations, accountsWithSubscriptions, churnedAccountNames]);

  // Filter consolidated accounts by search
  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return consolidatedAccounts;
    const query = searchQuery.toLowerCase();
    return consolidatedAccounts.filter((account) =>
      account.accountName.toLowerCase().includes(query) ||
      account.organizations.some((org) =>
        org.name.toLowerCase().includes(query) ||
        (org.domain_names || []).some((d) => d.toLowerCase().includes(query))
      )
    );
  }, [consolidatedAccounts, searchQuery]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Apply pagination to filtered accounts
  const paginatedAccounts = usePagination(filteredAccounts, pageSize, currentPage);

  // Load account data (subscriptions)
  const loadAccountUsage = useCallback(async (account: ConsolidatedAccount) => {
    if (customerUsage.has(account.accountName) && !customerUsage.get(account.accountName)?.error) {
      return;
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(account.accountName, {
        accountName: account.accountName,
        subscriptions: [],
        loading: true,
        loadingSubscriptions: true,
      });
      return newMap;
    });

    try {
      const sfAccountId = account.organizations[0]?.salesforce_account_id;
      const subscriptionResult = sfAccountId
        ? await fetchEnterpriseSubscriptionsById(sfAccountId)
        : await fetchEnterpriseSubscriptionsByName(account.accountName);
      const subscriptions = subscriptionResult.subscriptions;

      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(account.accountName, {
          accountName: account.accountName,
          subscriptions,
          loading: false,
          loadingSubscriptions: false,
        });
        return newMap;
      });
    } catch (err) {
      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(account.accountName, {
          accountName: account.accountName,
          subscriptions: [],
          loading: false,
          loadingSubscriptions: false,
          error: err instanceof Error ? err.message : "Failed to load subscriptions",
        });
        return newMap;
      });
    }
  }, [customerUsage]);

  const toggleAccount = useCallback((account: ConsolidatedAccount) => {
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
  }, [loadAccountUsage]);

  if (loading) {
    return (
      <div className="usage-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading usage data...</span>
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
      {/* Customer List Section */}
      <div className="customer-usage-section">
        <div className="usage-header">
          <h2>Usage by Customer</h2>
          <span className="section-count">{filteredAccounts.length} customers with active subscriptions</span>
        </div>

        <div className="usage-customer-controls">
          <div className="usage-search">
            <input
              id="customer-usage-search"
              name="customer-usage-search"
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
      </div>

      <div className="usage-customer-list">
        {filteredAccounts.length === 0 ? (
          <p className="no-results">
            {searchQuery ? "No customers match your search." : "No customers with active subscriptions found."}
          </p>
        ) : (
          paginatedAccounts.map((account) => {
            const isExpanded = expandedAccounts.has(account.accountName);
            const usageData = customerUsage.get(account.accountName);
            const subscriptions = usageData?.subscriptions || [];

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
                  {churnedAccountNames.has(account.accountName.toLowerCase()) && (
                    <span className="churned-badge" title="Lost a renewal in the last 2 quarters">Churned</span>
                  )}
                  <span className="expand-hint">
                    {isExpanded ? "Click to collapse" : "Click to view usage"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="usage-customer-content">
                    {usageData?.loading ? (
                      <div className="usage-loading">Loading subscription data...</div>
                    ) : usageData?.error ? (
                      <div className="usage-error">{usageData.error}</div>
                    ) : (
                      <>
                        {(() => {
                          const euuid = subscriptions.find(s => s.enterpriseUuid)?.enterpriseUuid;
                          const domain = subscriptions.find(s => s.enterpriseDomain)?.enterpriseDomain?.split('.')[0];
                          const sfId = account.organizations.find(o => o.salesforce_account_id)?.salesforce_account_id;
                          return <CustomerHealthCard accountName={account.accountName} accountId={sfId} enterpriseUuid={euuid} monitorDomain={domain} subscriptions={subscriptions} />;
                        })()}
                        {subscriptions.length > 0 && (() => {
                          const euuid = subscriptions.find(s => s.enterpriseUuid)?.enterpriseUuid;
                          const domain = subscriptions.find(s => s.enterpriseDomain)?.enterpriseDomain?.split('.')[0];
                          const sfId = account.organizations.find(o => o.salesforce_account_id)?.salesforce_account_id;
                          // Render the unified view even without an Enterprise UUID — products
                          // that key off SF account name (Account Portal, Assistant, University,
                          // Monitor) still resolve, and the per-product user lists work via
                          // SF Contact join. Only DevTools-style products will show empty.
                          return (
                            <UnifiedUsageSection
                              enterpriseUuid={euuid}
                              accountName={account.accountName}
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
    </div>
  );
}
