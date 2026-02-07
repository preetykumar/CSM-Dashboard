import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchAmplitudeProducts,
  fetchQuarterlyEventUsage,
  fetchDomainMapping,
  AmplitudeProduct,
  QuarterlyEventUsageResponse,
} from "../services/api";

interface QuarterlyUsagePanelProps {
  defaultEvent?: string;
}

// Combined account data with both quarters
interface AccountQuarterlyData {
  accountName: string;
  domain: string; // Original domain for reference
  currentQuarter: { uniqueUsers: number; eventCount: number } | null;
  previousQuarter: { uniqueUsers: number; eventCount: number } | null;
}

export function QuarterlyUsagePanel({ defaultEvent = "analysis:complete" }: QuarterlyUsagePanelProps) {
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<QuarterlyEventUsageResponse | null>(null);
  const [domainMapping, setDomainMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparisonExpanded, setComparisonExpanded] = useState(true);
  const [accountsExpanded, setAccountsExpanded] = useState(false);

  // Load products and domain mapping on mount
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [prods, mappingResponse] = await Promise.all([
          fetchAmplitudeProducts(),
          fetchDomainMapping(),
        ]);
        setProducts(prods);
        setDomainMapping(mappingResponse.mapping);
        if (prods.length > 0) {
          setSelectedProduct(prods[0].slug);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load initial data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
        setLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // Load usage data when product is selected
  useEffect(() => {
    if (selectedProduct === null) return;

    const productSlug: string = selectedProduct;
    setLoading(true);
    setError(null);

    fetchQuarterlyEventUsage(productSlug, defaultEvent)
      .then((data) => {
        setUsageData(data);
      })
      .catch((err) => {
        console.error("Failed to load usage data:", err);
        setError(err instanceof Error ? err.message : "Failed to load usage data");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedProduct, defaultEvent]);

  // Map domain to account name
  const getAccountName = useCallback((domain: string): string => {
    // Try exact match first
    const lowerDomain = domain.toLowerCase();
    if (domainMapping[lowerDomain]) {
      return domainMapping[lowerDomain];
    }

    // Try to find a matching domain by checking if the domain ends with a mapped domain
    for (const [mappedDomain, accountName] of Object.entries(domainMapping)) {
      if (lowerDomain.endsWith(mappedDomain) || mappedDomain.endsWith(lowerDomain)) {
        return accountName;
      }
    }

    // Return the domain as-is if no mapping found
    return domain;
  }, [domainMapping]);

  // Combine current and previous quarter data by account
  const combinedAccountData = useMemo((): AccountQuarterlyData[] => {
    if (!usageData) return [];

    const accountMap = new Map<string, AccountQuarterlyData>();

    // Process current quarter
    for (const d of usageData.currentQuarter.domains) {
      const accountName = getAccountName(d.domain);
      const existing = accountMap.get(accountName);
      if (existing) {
        // Aggregate if same account from different domains
        if (existing.currentQuarter) {
          existing.currentQuarter.uniqueUsers += d.uniqueUsers;
          existing.currentQuarter.eventCount += d.eventCount;
        } else {
          existing.currentQuarter = { uniqueUsers: d.uniqueUsers, eventCount: d.eventCount };
        }
      } else {
        accountMap.set(accountName, {
          accountName,
          domain: d.domain,
          currentQuarter: { uniqueUsers: d.uniqueUsers, eventCount: d.eventCount },
          previousQuarter: null,
        });
      }
    }

    // Process previous quarter
    for (const d of usageData.previousQuarter.domains) {
      const accountName = getAccountName(d.domain);
      const existing = accountMap.get(accountName);
      if (existing) {
        if (existing.previousQuarter) {
          existing.previousQuarter.uniqueUsers += d.uniqueUsers;
          existing.previousQuarter.eventCount += d.eventCount;
        } else {
          existing.previousQuarter = { uniqueUsers: d.uniqueUsers, eventCount: d.eventCount };
        }
      } else {
        accountMap.set(accountName, {
          accountName,
          domain: d.domain,
          currentQuarter: null,
          previousQuarter: { uniqueUsers: d.uniqueUsers, eventCount: d.eventCount },
        });
      }
    }

    // Sort by current quarter users descending, then previous quarter
    return Array.from(accountMap.values()).sort((a, b) => {
      const aUsers = (a.currentQuarter?.uniqueUsers || 0) + (a.previousQuarter?.uniqueUsers || 0);
      const bUsers = (b.currentQuarter?.uniqueUsers || 0) + (b.previousQuarter?.uniqueUsers || 0);
      return bUsers - aUsers;
    });
  }, [usageData, getAccountName]);

  // Calculate totals
  const totals = useMemo(() => {
    if (!usageData) return null;
    return {
      currentUsers: usageData.currentQuarter.domains.reduce((sum, d) => sum + d.uniqueUsers, 0),
      currentEvents: usageData.currentQuarter.domains.reduce((sum, d) => sum + d.eventCount, 0),
      currentAccounts: new Set(usageData.currentQuarter.domains.map(d => getAccountName(d.domain))).size,
      previousUsers: usageData.previousQuarter.domains.reduce((sum, d) => sum + d.uniqueUsers, 0),
      previousEvents: usageData.previousQuarter.domains.reduce((sum, d) => sum + d.eventCount, 0),
      previousAccounts: new Set(usageData.previousQuarter.domains.map(d => getAccountName(d.domain))).size,
    };
  }, [usageData, getAccountName]);

  const calcChange = (current: number, previous: number): string => {
    if (previous === 0) return "N/A";
    const change = ((current - previous) / previous) * 100;
    return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  };

  if (error && products.length === 0) {
    return (
      <div className="quarterly-usage-panel">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="quarterly-usage-panel">
      {/* Product Selector */}
      <div className="product-selector-bar">
        <label htmlFor="product-select">Product:</label>
        <select
          id="product-select"
          value={selectedProduct || ""}
          onChange={(e) => setSelectedProduct(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        {usageData && (
          <span className="event-info">
            Event: <code>{usageData.eventType}</code>
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading quarterly usage data...</div>
      ) : error ? (
        <div className="error">{error}</div>
      ) : usageData && totals ? (
        <>
          {/* Quarterly Usage Comparison - Collapsible */}
          <div className="collapsible-section">
            <button
              className="collapsible-header"
              onClick={() => setComparisonExpanded(!comparisonExpanded)}
              aria-expanded={comparisonExpanded}
            >
              <span className="expand-icon">{comparisonExpanded ? "▼" : "▶"}</span>
              <h2>Quarterly Usage Comparison</h2>
            </button>
            {comparisonExpanded && (
              <div className="collapsible-content">
                <div className="quarterly-summary">
                  <table className="quarterly-comparison-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>{usageData.currentQuarter.quarter}</th>
                        <th>{usageData.previousQuarter.quarter}</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Accounts</td>
                        <td className="numeric-cell">{totals.currentAccounts.toLocaleString()}</td>
                        <td className="numeric-cell">{totals.previousAccounts.toLocaleString()}</td>
                        <td className={`numeric-cell ${totals.currentAccounts >= totals.previousAccounts ? "positive" : "negative"}`}>
                          {calcChange(totals.currentAccounts, totals.previousAccounts)}
                        </td>
                      </tr>
                      <tr>
                        <td>Unique Users</td>
                        <td className="numeric-cell">{totals.currentUsers.toLocaleString()}</td>
                        <td className="numeric-cell">{totals.previousUsers.toLocaleString()}</td>
                        <td className={`numeric-cell ${totals.currentUsers >= totals.previousUsers ? "positive" : "negative"}`}>
                          {calcChange(totals.currentUsers, totals.previousUsers)}
                        </td>
                      </tr>
                      <tr>
                        <td>Total Events</td>
                        <td className="numeric-cell">{totals.currentEvents.toLocaleString()}</td>
                        <td className="numeric-cell">{totals.previousEvents.toLocaleString()}</td>
                        <td className={`numeric-cell ${totals.currentEvents >= totals.previousEvents ? "positive" : "negative"}`}>
                          {calcChange(totals.currentEvents, totals.previousEvents)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Usage by Account - Collapsible */}
          <div className="collapsible-section">
            <button
              className="collapsible-header"
              onClick={() => setAccountsExpanded(!accountsExpanded)}
              aria-expanded={accountsExpanded}
            >
              <span className="expand-icon">{accountsExpanded ? "▼" : "▶"}</span>
              <h2>Usage by Account</h2>
              <span className="section-count">{combinedAccountData.length} accounts</span>
            </button>
            {accountsExpanded && (
              <div className="collapsible-content">
                <table className="quarterly-accounts-table">
                  <thead>
                    <tr>
                      <th rowSpan={2}>Account</th>
                      <th colSpan={2}>{usageData.currentQuarter.quarter}</th>
                      <th colSpan={2}>{usageData.previousQuarter.quarter}</th>
                    </tr>
                    <tr>
                      <th>Users</th>
                      <th>Events</th>
                      <th>Users</th>
                      <th>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedAccountData.slice(0, 30).map((account, idx) => (
                      <tr key={`${account.accountName}-${idx}`}>
                        <td className="account-cell" title={account.domain !== account.accountName ? `Domain: ${account.domain}` : undefined}>
                          {account.accountName}
                        </td>
                        <td className="numeric-cell">{account.currentQuarter?.uniqueUsers.toLocaleString() || "-"}</td>
                        <td className="numeric-cell">{account.currentQuarter?.eventCount.toLocaleString() || "-"}</td>
                        <td className="numeric-cell">{account.previousQuarter?.uniqueUsers.toLocaleString() || "-"}</td>
                        <td className="numeric-cell">{account.previousQuarter?.eventCount.toLocaleString() || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>Total ({combinedAccountData.length} accounts)</strong></td>
                      <td className="numeric-cell"><strong>{totals.currentUsers.toLocaleString()}</strong></td>
                      <td className="numeric-cell"><strong>{totals.currentEvents.toLocaleString()}</strong></td>
                      <td className="numeric-cell"><strong>{totals.previousUsers.toLocaleString()}</strong></td>
                      <td className="numeric-cell"><strong>{totals.previousEvents.toLocaleString()}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
