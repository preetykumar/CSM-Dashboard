import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { fetchOrganizations, fetchCustomerSummary } from "./services/api";
import { SyncButton } from "./components/SyncButton";
import { CustomerSummaryCard } from "./components/CustomerSummaryCard";
import { OrganizationDrilldown } from "./components/OrganizationDrilldown";
import { CSMPortfolioView } from "./components/CSMPortfolioView";
import { PMPortfolioView } from "./components/PMPortfolioView";
import { ProductView } from "./components/ProductView";
import { TicketListModal } from "./components/TicketListModal";
import { LoginPage } from "./components/LoginPage";
import { UserMenu } from "./components/UserMenu";
import { ChatWidget } from "./components/chat";
import { CustomerUsageView } from "./components/CustomerUsageView";
import { CSMUsageView } from "./components/CSMUsageView";
import RenewalAgent from "./components/RenewalAgent";
import { PRSRenewalView } from "./components/PRSRenewalView";
import { Pagination, usePagination } from "./components/Pagination";
import { useAuth } from "./contexts/AuthContext";
import { ChatProvider } from "./contexts/ChatContext";
import type { CustomerSummary, Organization } from "./types";

type SmartFilter = "all" | "escalated" | "critical";
type AlphabetRange = "all" | "A-D" | "E-H" | "I-L" | "M-P" | "Q-T" | "U-Z";

// Consolidated account that groups child Zendesk orgs by SF parent account
interface ConsolidatedAccount {
  displayName: string;
  organizations: Organization[];
  orgIds: number[];
}

const ALPHABET_RANGES: { value: AlphabetRange; label: string; start: string; end: string }[] = [
  { value: "all", label: "All", start: "", end: "" },
  { value: "A-D", label: "A-D", start: "A", end: "D" },
  { value: "E-H", label: "E-H", start: "E", end: "H" },
  { value: "I-L", label: "I-L", start: "I", end: "L" },
  { value: "M-P", label: "M-P", start: "M", end: "P" },
  { value: "Q-T", label: "Q-T", start: "Q", end: "T" },
  { value: "U-Z", label: "U-Z", start: "U", end: "Z" },
];

interface TicketFilter {
  orgId: number;
  orgName: string;
  filterType: "status" | "priority";
  filterValue: string;
}

// Route configuration for easy reference
const ROUTES = {
  SUPPORT_CUSTOMERS: "/support/customers",
  SUPPORT_CSM: "/support/csm",
  SUPPORT_PM: "/support/pm",
  SUPPORT_PRODUCT: "/support/product",
  USAGE_CUSTOMERS: "/usage/customers",
  USAGE_CSM: "/usage/csm",
  RENEWALS_UPCOMING: "/renewals/upcoming",
  RENEWALS_PRS: "/renewals/prs",
} as const;

// Support Tickets - By Customer View Component
function SupportCustomersView() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [summaries, setSummaries] = useState<Map<number, CustomerSummary>>(new Map());
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<{ id: number; name: string } | null>(null);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);
  const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
  const [alphabetRange, setAlphabetRange] = useState<AlphabetRange>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSearchAccount, setSelectedSearchAccount] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function loadOrganizations() {
      try {
        const orgs = await fetchOrganizations();
        setOrganizations(orgs);
        setLoadingProgress({ loaded: 0, total: orgs.length });

        for (const org of orgs) {
          try {
            const summary = await fetchCustomerSummary(org.id);
            setSummaries(prev => new Map(prev).set(org.id, summary));
            setLoadingProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
          } catch (err) {
            console.error(`Failed to load summary for ${org.name}:`, err);
            setLoadingProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoadingOrgs(false);
      }
    }

    loadOrganizations();
  }, []);

  // Consolidate organizations by SF ultimate parent name
  const consolidatedAccounts = useMemo(() => {
    const accountMap = new Map<string, Organization[]>();
    for (const org of organizations) {
      const groupKey = org.sf_ultimate_parent_name || org.salesforce_account_name || org.name;
      const existing = accountMap.get(groupKey) || [];
      existing.push(org);
      accountMap.set(groupKey, existing);
    }
    return Array.from(accountMap.entries()).map(([displayName, orgs]) => ({
      displayName,
      organizations: orgs,
      orgIds: orgs.map(o => o.id),
    }));
  }, [organizations]);

  // Aggregate summaries for consolidated accounts
  const consolidatedSummaries = useMemo(() => {
    const result = new Map<string, CustomerSummary>();
    for (const account of consolidatedAccounts) {
      const childSummaries = account.orgIds
        .map(id => summaries.get(id))
        .filter((s): s is CustomerSummary => !!s);
      if (childSummaries.length === 0) continue;

      const aggregated: CustomerSummary = {
        organization: {
          ...childSummaries[0].organization,
          id: account.orgIds[0],
          name: account.displayName,
        },
        ticketStats: { total: 0, new: 0, open: 0, pending: 0, hold: 0, solved: 0, closed: 0 },
        priorityBreakdown: { low: 0, normal: 0, high: 0, urgent: 0 },
        escalations: 0,
        escalatedTickets: [],
        criticalDefects: 0,
        criticalTickets: [],
        recentTickets: [],
      };

      for (const s of childSummaries) {
        aggregated.ticketStats.total += s.ticketStats.total;
        aggregated.ticketStats.new += s.ticketStats.new;
        aggregated.ticketStats.open += s.ticketStats.open;
        aggregated.ticketStats.pending += s.ticketStats.pending;
        aggregated.ticketStats.hold += s.ticketStats.hold;
        aggregated.ticketStats.solved += s.ticketStats.solved;
        aggregated.ticketStats.closed += s.ticketStats.closed;
        aggregated.priorityBreakdown.low += s.priorityBreakdown.low;
        aggregated.priorityBreakdown.normal += s.priorityBreakdown.normal;
        aggregated.priorityBreakdown.high += s.priorityBreakdown.high;
        aggregated.priorityBreakdown.urgent += s.priorityBreakdown.urgent;
        aggregated.escalations += s.escalations;
        aggregated.escalatedTickets.push(...s.escalatedTickets);
        aggregated.criticalDefects += s.criticalDefects;
        aggregated.criticalTickets.push(...s.criticalTickets);
        aggregated.recentTickets.push(...s.recentTickets);
      }
      // Sort and limit recent tickets
      aggregated.recentTickets.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      aggregated.recentTickets = aggregated.recentTickets.slice(0, 10);
      result.set(account.displayName, aggregated);
    }
    return result;
  }, [consolidatedAccounts, summaries]);

  const filteredAndSortedAccounts = useMemo(() => {
    if (selectedSearchAccount) {
      const account = consolidatedAccounts.find(a => a.displayName === selectedSearchAccount);
      return account ? [account] : [];
    }

    let filtered = [...consolidatedAccounts];

    if (smartFilter === "escalated") {
      filtered = filtered.filter(account => {
        const summary = consolidatedSummaries.get(account.displayName);
        return summary ? summary.escalations > 0 : false;
      });
    } else if (smartFilter === "critical") {
      filtered = filtered.filter(account => {
        const summary = consolidatedSummaries.get(account.displayName);
        return summary ? summary.criticalDefects > 0 : false;
      });
    }

    if (alphabetRange !== "all") {
      const range = ALPHABET_RANGES.find((r) => r.value === alphabetRange);
      if (range) {
        filtered = filtered.filter(account => {
          const firstChar = account.displayName.charAt(0).toUpperCase();
          return firstChar >= range.start && firstChar <= range.end;
        });
      }
    }

    return filtered.sort((a, b) => {
      const summaryA = consolidatedSummaries.get(a.displayName);
      const summaryB = consolidatedSummaries.get(b.displayName);
      const totalA = summaryA?.ticketStats.total ?? 0;
      const totalB = summaryB?.ticketStats.total ?? 0;
      return totalB - totalA;
    });
  }, [consolidatedAccounts, consolidatedSummaries, smartFilter, alphabetRange, selectedSearchAccount]);

  const filterCounts = useMemo(() => {
    let escalated = 0;
    let critical = 0;
    for (const account of consolidatedAccounts) {
      const summary = consolidatedSummaries.get(account.displayName);
      if (!summary) continue;
      if (summary.escalations > 0) escalated++;
      if (summary.criticalDefects > 0) critical++;
    }
    return { escalated, critical };
  }, [consolidatedAccounts, consolidatedSummaries]);

  const paginatedAccounts = usePagination(filteredAndSortedAccounts, pageSize, currentPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [smartFilter, alphabetRange, selectedSearchAccount]);

  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const query = searchQuery.toLowerCase();
    return consolidatedAccounts
      .filter(account =>
        account.displayName.toLowerCase().includes(query) ||
        account.organizations.some(org => org.name.toLowerCase().includes(query))
      )
      .slice(0, 8);
  }, [consolidatedAccounts, searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearchSelect = useCallback((account: ConsolidatedAccount) => {
    setSelectedSearchAccount(account.displayName);
    setSearchQuery(account.displayName);
    setShowSuggestions(false);
    setSmartFilter("all");
    setAlphabetRange("all");
  }, []);

  const clearSearch = useCallback(() => {
    setSelectedSearchAccount(null);
    setSearchQuery("");
    setShowSuggestions(false);
  }, []);

  const handleAccountClick = (account: ConsolidatedAccount) => {
    // Open drilldown for the org with most tickets
    const primaryOrg = account.organizations.reduce((best, org) => {
      const bestTotal = summaries.get(best.id)?.ticketStats.total ?? 0;
      const orgTotal = summaries.get(org.id)?.ticketStats.total ?? 0;
      return orgTotal > bestTotal ? org : best;
    }, account.organizations[0]);
    setSelectedOrg({ id: primaryOrg.id, name: account.displayName });
  };

  const handleStatusClick = (account: ConsolidatedAccount, status: string) => {
    const primaryOrg = account.organizations[0];
    setTicketFilter({ orgId: primaryOrg.id, orgName: account.displayName, filterType: "status", filterValue: status });
  };

  const handlePriorityClick = (account: ConsolidatedAccount, priority: string) => {
    const primaryOrg = account.organizations[0];
    setTicketFilter({ orgId: primaryOrg.id, orgName: account.displayName, filterType: "priority", filterValue: priority });
  };

  return (
    <>
      {/* Search with Autocomplete */}
      <div className="search-container" ref={searchRef}>
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Search accounts..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSuggestions(true);
              if (!e.target.value) {
                setSelectedSearchAccount(null);
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            aria-label="Search accounts"
          />
          {(searchQuery || selectedSearchAccount) && (
            <button className="search-clear" onClick={clearSearch} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        {showSuggestions && searchSuggestions.length > 0 && (
          <ul className="search-suggestions" role="listbox" aria-label="Search suggestions">
            {searchSuggestions.map((account) => {
              const summary = consolidatedSummaries.get(account.displayName);
              return (
                <li
                  key={account.displayName}
                  onClick={() => handleSearchSelect(account)}
                  className="search-suggestion-item"
                  role="option"
                >
                  <span className="suggestion-name">
                    {account.displayName}
                    {account.organizations.length > 1 && (
                      <span style={{ color: "#666", fontSize: "0.85em", marginLeft: 4 }}>
                        ({account.organizations.length} accounts)
                      </span>
                    )}
                  </span>
                  {summary && (
                    <span className="suggestion-tickets">
                      {summary.ticketStats.total} tickets
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Smart Filters */}
      <div className="smart-filters">
        <span className="filter-label">Quick Filters:</span>
        <button
          className={`filter-btn ${smartFilter === "all" ? "active" : ""}`}
          onClick={() => setSmartFilter("all")}
        >
          All Accounts
        </button>
        <button
          className={`filter-btn ${smartFilter === "escalated" ? "active" : ""}`}
          onClick={() => setSmartFilter("escalated")}
        >
          Escalated {filterCounts.escalated > 0 && <span className="badge urgent">{filterCounts.escalated}</span>}
        </button>
        <button
          className={`filter-btn ${smartFilter === "critical" ? "active" : ""}`}
          onClick={() => setSmartFilter("critical")}
        >
          Critical Defects {filterCounts.critical > 0 && <span className="badge high">{filterCounts.critical}</span>}
        </button>
      </div>

      {/* Alphabet Range Navigation */}
      <div className="alphabet-nav">
        <span className="filter-label">Browse:</span>
        {ALPHABET_RANGES.map((range) => (
          <button
            key={range.value}
            className={`alpha-btn ${alphabetRange === range.value ? "active" : ""}`}
            onClick={() => setAlphabetRange(range.value)}
          >
            {range.label}
          </button>
        ))}
      </div>

      <p className="hint">Click on status/priority counts to filter tickets, or click the card for full details</p>

      {loadingProgress.total > 0 && loadingProgress.loaded < loadingProgress.total && (
        <div className="progress-bar" role="progressbar" aria-valuenow={loadingProgress.loaded} aria-valuemax={loadingProgress.total} aria-label="Loading customers progress">
          <div
            className="progress-fill"
            style={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
          />
          <span className="progress-text">
            Loading {loadingProgress.loaded} of {loadingProgress.total} customers...
          </span>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {loadingOrgs ? (
        <div className="loading" aria-live="polite">Loading organizations...</div>
      ) : (
        <>
          <Pagination
            totalItems={filteredAndSortedAccounts.length}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
          <div className="results-summary">
            Showing {paginatedAccounts.length} of {filteredAndSortedAccounts.length} accounts
            {smartFilter !== "all" && ` (${smartFilter})`}
            {alphabetRange !== "all" && ` • ${alphabetRange}`}
          </div>
          <div className="summaries-grid">
            {paginatedAccounts.map((account) => {
              const summary = consolidatedSummaries.get(account.displayName);
              if (summary) {
                return (
                  <CustomerSummaryCard
                    key={account.displayName}
                    summary={summary}
                    subtitle={account.organizations.length > 1 ? `${account.organizations.length} accounts` : undefined}
                    onClick={() => handleAccountClick(account)}
                    onStatusClick={(status) => handleStatusClick(account, status)}
                    onPriorityClick={(priority) => handlePriorityClick(account, priority)}
                    isEscalatedView={smartFilter === "escalated"}
                    isCriticalView={smartFilter === "critical"}
                  />
                );
              }
              return (
                <div key={account.displayName} className="summary-card loading-card">
                  <div className="summary-card-header">
                    <h2>{account.displayName}</h2>
                    <div className="total-tickets">Loading...</div>
                  </div>
                </div>
              );
            })}
            {filteredAndSortedAccounts.length === 0 && organizations.length > 0 && (
              <p className="no-results">No accounts match the current filters.</p>
            )}
            {organizations.length === 0 && !error && (
              <p>No customer data found. Make sure your Zendesk credentials are configured.</p>
            )}
          </div>
        </>
      )}

      {selectedOrg && (
        <OrganizationDrilldown
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          onClose={() => setSelectedOrg(null)}
        />
      )}

      {ticketFilter && (
        <TicketListModal
          orgId={ticketFilter.orgId}
          orgName={ticketFilter.orgName}
          filterType={ticketFilter.filterType}
          filterValue={ticketFilter.filterValue}
          onClose={() => setTicketFilter(null)}
        />
      )}
    </>
  );
}

// Dashboard with routing
function Dashboard() {
  useAuth();
  const location = useLocation();

  // Determine active main tab based on current path
  const getActiveMainTab = () => {
    if (location.pathname.startsWith("/support")) return "support";
    if (location.pathname.startsWith("/usage")) return "usage";
    if (location.pathname.startsWith("/renewals")) return "renewals";
    return "support";
  };

  const activeMainTab = getActiveMainTab();

  // Get hint text based on current route
  const getHintText = () => {
    switch (location.pathname) {
      case ROUTES.SUPPORT_CUSTOMERS:
        return null; // Handled in SupportCustomersView
      case ROUTES.SUPPORT_CSM:
        return "View tickets grouped by CSM and their customer portfolio";
      case ROUTES.SUPPORT_PM:
        return "View tickets and analytics grouped by Project Manager for report compilation";
      case ROUTES.SUPPORT_PRODUCT:
        return "View tickets grouped by product, request type, and issue subtype";
      case ROUTES.USAGE_CUSTOMERS:
        return "View product usage metrics by customer organization";
      case ROUTES.USAGE_CSM:
        return "View product usage metrics grouped by CSM portfolio";
      case ROUTES.RENEWALS_UPCOMING:
        return "View all upcoming renewal opportunities across accounts";
      case ROUTES.RENEWALS_PRS:
        return "View renewal opportunities grouped by Product Renewal Specialist";
      default:
        return null;
    }
  };

  const hintText = getHintText();

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div>
            <h1>Customer Success Manager Dashboard</h1>
          </div>
          <div className="header-actions">
            <SyncButton />
            <UserMenu />
          </div>
        </div>

        {/* Main Tab Navigation */}
        <nav className="main-tabs" aria-label="Main navigation">
          <NavLink
            to={ROUTES.SUPPORT_CUSTOMERS}
            className={activeMainTab === "support" ? "active" : ""}
          >
            Support Tickets
          </NavLink>
          <NavLink
            to={ROUTES.USAGE_CUSTOMERS}
            className={activeMainTab === "usage" ? "active" : ""}
          >
            Usage Analytics
          </NavLink>
          <NavLink
            to={ROUTES.RENEWALS_UPCOMING}
            className={activeMainTab === "renewals" ? "active" : ""}
          >
            Renewals
          </NavLink>
        </nav>

        {/* Support Tickets Sub-tabs */}
        {activeMainTab === "support" && (
          <nav className="sub-tabs" aria-label="Support tickets views">
            <NavLink to={ROUTES.SUPPORT_CUSTOMERS} end>
              By Customer
            </NavLink>
            <NavLink to={ROUTES.SUPPORT_CSM}>
              By CSM (QBR View)
            </NavLink>
            <NavLink to={ROUTES.SUPPORT_PM}>
              By PM (Reports)
            </NavLink>
            <NavLink to={ROUTES.SUPPORT_PRODUCT}>
              By Product
            </NavLink>
          </nav>
        )}

        {/* Usage Analytics Sub-tabs */}
        {activeMainTab === "usage" && (
          <nav className="sub-tabs" aria-label="Usage analytics views">
            <NavLink to={ROUTES.USAGE_CUSTOMERS} end>
              By Customer
            </NavLink>
            <NavLink to={ROUTES.USAGE_CSM}>
              By CSM (QBR View)
            </NavLink>
          </nav>
        )}

        {/* Renewals Sub-tabs */}
        {activeMainTab === "renewals" && (
          <nav className="sub-tabs" aria-label="Renewals views">
            <NavLink to={ROUTES.RENEWALS_UPCOMING} end>
              Upcoming Renewals (All)
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_PRS}>
              By PRS (QBR View)
            </NavLink>
          </nav>
        )}

        {hintText && <p className="hint">{hintText}</p>}
      </header>

      {/* Route-based content */}
      <main>
        <Routes>
          {/* Support Routes */}
          <Route path="/support/customers" element={<SupportCustomersView />} />
          <Route path="/support/csm" element={<CSMPortfolioView />} />
          <Route path="/support/pm" element={<PMPortfolioView />} />
          <Route path="/support/product" element={<ProductView />} />

          {/* Usage Routes */}
          <Route path="/usage/customers" element={<CustomerUsageView />} />
          <Route path="/usage/csm" element={<CSMUsageView />} />

          {/* Renewals Routes */}
          <Route path="/renewals/upcoming" element={<RenewalAgent />} />
          <Route path="/renewals/prs" element={<PRSRenewalView />} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to={ROUTES.SUPPORT_CUSTOMERS} replace />} />
          <Route path="/support" element={<Navigate to={ROUTES.SUPPORT_CUSTOMERS} replace />} />
          <Route path="/usage" element={<Navigate to={ROUTES.USAGE_CUSTOMERS} replace />} />
          <Route path="/renewals" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to={ROUTES.SUPPORT_CUSTOMERS} replace />} />
        </Routes>
      </main>

      {/* AI Chat Assistant */}
      <ChatWidget />

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <span>CSM Dashboard v1.0.0 (MVP)</span>
          <span className="footer-separator">|</span>
          <a
            href="https://github.com/preetykumar/CSM-Dashboard/blob/main/RELEASE_NOTES.md"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            Release Notes
          </a>
          <span className="footer-separator">|</span>
          <span>&copy; {new Date().getFullYear()} Deque Systems</span>
        </div>
      </footer>
    </div>
  );
}

function App() {
  const { authenticated, authEnabled, loading } = useAuth();

  if (loading) {
    return (
      <div className="app">
        <div className="loading" aria-live="polite">Loading...</div>
      </div>
    );
  }

  // If auth is enabled and user is not authenticated, show login
  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  // Otherwise show the dashboard with chat and routing
  return (
    <BrowserRouter>
      <ChatProvider>
        <Dashboard />
      </ChatProvider>
    </BrowserRouter>
  );
}

export default App;
