import { useEffect, useState, useMemo, useRef, useCallback } from "react";
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

type MainTab = "support" | "usage" | "renewals";
type SupportSubTab = "customers" | "csm" | "pm" | "product";
type UsageSubTab = "customers" | "csm";
type RenewalsSubTab = "upcoming" | "prs";
type SmartFilter = "all" | "escalated" | "critical";
type AlphabetRange = "all" | "A-D" | "E-H" | "I-L" | "M-P" | "Q-T" | "U-Z";

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

function Dashboard() {
  useAuth(); // Ensures user is authenticated
  const [mainTab, setMainTab] = useState<MainTab>("support");
  const [supportSubTab, setSupportSubTab] = useState<SupportSubTab>("customers");
  const [usageSubTab, setUsageSubTab] = useState<UsageSubTab>("customers");
  const [renewalsSubTab, setRenewalsSubTab] = useState<RenewalsSubTab>("upcoming");
  const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
  const [alphabetRange, setAlphabetRange] = useState<AlphabetRange>("all");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [summaries, setSummaries] = useState<Map<number, CustomerSummary>>(new Map());
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<{ id: number; name: string } | null>(null);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSearchOrg, setSelectedSearchOrg] = useState<Organization | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Pagination state for By Customer view
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Load organizations first (fast)
  useEffect(() => {
    async function loadOrganizations() {
      try {
        const orgs = await fetchOrganizations();
        setOrganizations(orgs);
        setLoadingProgress({ loaded: 0, total: orgs.length });

        // Then load summaries incrementally
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

  // Filter and sort organizations based on search, smart filter and alphabet range
  const filteredAndSortedOrgs = useMemo(() => {
    // If a specific org is selected via search, only show that one
    if (selectedSearchOrg) {
      return [selectedSearchOrg];
    }

    let filtered = [...organizations];

    // Apply smart filter
    if (smartFilter === "escalated") {
      filtered = filtered.filter((org) => {
        const summary = summaries.get(org.id);
        if (!summary) return false;
        // Check if organization has any escalated tickets
        return summary.escalations > 0;
      });
    } else if (smartFilter === "critical") {
      filtered = filtered.filter((org) => {
        const summary = summaries.get(org.id);
        if (!summary) return false;
        // Critical = urgent or high priority active tickets (not solved/closed)
        return summary.criticalDefects > 0;
      });
    }

    // Apply alphabet range filter
    if (alphabetRange !== "all") {
      const range = ALPHABET_RANGES.find((r) => r.value === alphabetRange);
      if (range) {
        filtered = filtered.filter((org) => {
          const firstChar = org.name.charAt(0).toUpperCase();
          return firstChar >= range.start && firstChar <= range.end;
        });
      }
    }

    // Sort by total tickets (descending)
    return filtered.sort((a, b) => {
      const summaryA = summaries.get(a.id);
      const summaryB = summaries.get(b.id);
      const totalA = summaryA?.ticketStats.total ?? 0;
      const totalB = summaryB?.ticketStats.total ?? 0;
      return totalB - totalA;
    });
  }, [organizations, summaries, smartFilter, alphabetRange, selectedSearchOrg]);

  // Count organizations matching each filter for badges
  const filterCounts = useMemo(() => {
    let escalated = 0;
    let critical = 0;
    organizations.forEach((org) => {
      const summary = summaries.get(org.id);
      if (!summary) return;
      if (summary.escalations > 0) escalated++;
      if (summary.criticalDefects > 0) critical++;
    });
    return { escalated, critical };
  }, [organizations, summaries]);

  // Apply pagination to filtered orgs
  const paginatedOrgs = usePagination(filteredAndSortedOrgs, pageSize, currentPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [smartFilter, alphabetRange, selectedSearchOrg]);

  // Search suggestions
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const query = searchQuery.toLowerCase();
    return organizations
      .filter((org) => org.name.toLowerCase().includes(query))
      .slice(0, 8); // Limit to 8 suggestions
  }, [organizations, searchQuery]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle search selection
  const handleSearchSelect = useCallback((org: Organization) => {
    setSelectedSearchOrg(org);
    setSearchQuery(org.name);
    setShowSuggestions(false);
    // Reset other filters when searching
    setSmartFilter("all");
    setAlphabetRange("all");
  }, []);

  // Clear search
  const clearSearch = useCallback(() => {
    setSelectedSearchOrg(null);
    setSearchQuery("");
    setShowSuggestions(false);
  }, []);

  const handleOrgClick = (org: Organization) => {
    setSelectedOrg({ id: org.id, name: org.name });
  };

  const handleStatusClick = (org: Organization, status: string) => {
    setTicketFilter({ orgId: org.id, orgName: org.name, filterType: "status", filterValue: status });
  };

  const handlePriorityClick = (org: Organization, priority: string) => {
    setTicketFilter({ orgId: org.id, orgName: org.name, filterType: "priority", filterValue: priority });
  };

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
        <div className="main-tabs">
          <button
            className={mainTab === "support" ? "active" : ""}
            onClick={() => setMainTab("support")}
          >
            Support Tickets
          </button>
          <button
            className={mainTab === "usage" ? "active" : ""}
            onClick={() => setMainTab("usage")}
          >
            Usage Analytics
          </button>
          <button
            className={mainTab === "renewals" ? "active" : ""}
            onClick={() => setMainTab("renewals")}
          >
            Renewals
          </button>
        </div>

        {/* Support Tickets Sub-tabs and Filters */}
        {mainTab === "support" && (
          <>
            <div className="sub-tabs">
              <button
                className={supportSubTab === "customers" ? "active" : ""}
                onClick={() => setSupportSubTab("customers")}
              >
                By Customer
              </button>
              <button
                className={supportSubTab === "csm" ? "active" : ""}
                onClick={() => setSupportSubTab("csm")}
              >
                By CSM (QBR View)
              </button>
              <button
                className={supportSubTab === "pm" ? "active" : ""}
                onClick={() => setSupportSubTab("pm")}
              >
                By PM (Reports)
              </button>
              <button
                className={supportSubTab === "product" ? "active" : ""}
                onClick={() => setSupportSubTab("product")}
              >
                By Product
              </button>
            </div>

            {supportSubTab === "customers" && (
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
                          setSelectedSearchOrg(null);
                        }
                      }}
                      onFocus={() => setShowSuggestions(true)}
                    />
                    {(searchQuery || selectedSearchOrg) && (
                      <button className="search-clear" onClick={clearSearch} title="Clear search">
                        ×
                      </button>
                    )}
                  </div>
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <ul className="search-suggestions">
                      {searchSuggestions.map((org) => (
                        <li
                          key={org.id}
                          onClick={() => handleSearchSelect(org)}
                          className="search-suggestion-item"
                        >
                          <span className="suggestion-name">{org.name}</span>
                          {summaries.get(org.id) && (
                            <span className="suggestion-tickets">
                              {summaries.get(org.id)?.ticketStats.total} tickets
                            </span>
                          )}
                        </li>
                      ))}
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
              </>
            )}

            {supportSubTab === "customers" && (
              <p className="hint">Click on status/priority counts to filter tickets, or click the card for full details</p>
            )}
            {supportSubTab === "csm" && (
              <p className="hint">View tickets grouped by CSM and their customer portfolio</p>
            )}
            {supportSubTab === "pm" && (
              <p className="hint">View tickets and analytics grouped by Project Manager for report compilation</p>
            )}
            {supportSubTab === "product" && (
              <p className="hint">View tickets grouped by product, request type, and issue subtype</p>
            )}
          </>
        )}

        {/* Usage Analytics Sub-tabs */}
        {mainTab === "usage" && (
          <>
            <div className="sub-tabs">
              <button
                className={usageSubTab === "customers" ? "active" : ""}
                onClick={() => setUsageSubTab("customers")}
              >
                By Customer
              </button>
              <button
                className={usageSubTab === "csm" ? "active" : ""}
                onClick={() => setUsageSubTab("csm")}
              >
                By CSM (QBR View)
              </button>
            </div>

            {usageSubTab === "customers" && (
              <p className="hint">View product usage metrics by customer organization</p>
            )}
            {usageSubTab === "csm" && (
              <p className="hint">View product usage metrics grouped by CSM portfolio</p>
            )}
          </>
        )}

        {/* Renewals Sub-tabs */}
        {mainTab === "renewals" && (
          <>
            <div className="sub-tabs">
              <button
                className={renewalsSubTab === "upcoming" ? "active" : ""}
                onClick={() => setRenewalsSubTab("upcoming")}
              >
                Upcoming Renewals (All)
              </button>
              <button
                className={renewalsSubTab === "prs" ? "active" : ""}
                onClick={() => setRenewalsSubTab("prs")}
              >
                By PRS (QBR View)
              </button>
            </div>

            {renewalsSubTab === "upcoming" && (
              <p className="hint">View all upcoming renewal opportunities across accounts</p>
            )}
            {renewalsSubTab === "prs" && (
              <p className="hint">View renewal opportunities grouped by Product Renewal Specialist</p>
            )}
          </>
        )}

        {mainTab === "support" && supportSubTab === "customers" && loadingProgress.total > 0 && loadingProgress.loaded < loadingProgress.total && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
            />
            <span className="progress-text">
              Loading {loadingProgress.loaded} of {loadingProgress.total} customers...
            </span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {/* Support Tickets Tab Content - By Customer view stays mounted to preserve state */}
      <div style={{ display: mainTab === "support" && supportSubTab === "customers" ? "block" : "none" }}>
        {loadingOrgs ? (
          <div className="loading">Loading organizations...</div>
        ) : (
          <>
            <Pagination
              totalItems={filteredAndSortedOrgs.length}
              pageSize={pageSize}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
            <div className="results-summary">
              Showing {paginatedOrgs.length} of {filteredAndSortedOrgs.length} accounts
              {smartFilter !== "all" && ` (${smartFilter})`}
              {alphabetRange !== "all" && ` • ${alphabetRange}`}
            </div>
            <div className="summaries-grid">
              {paginatedOrgs.map((org) => {
                const summary = summaries.get(org.id);
                if (summary) {
                  return (
                    <CustomerSummaryCard
                      key={org.id}
                      summary={summary}
                      onClick={() => handleOrgClick(org)}
                      onStatusClick={(status) => handleStatusClick(org, status)}
                      onPriorityClick={(priority) => handlePriorityClick(org, priority)}
                      isEscalatedView={smartFilter === "escalated"}
                      isCriticalView={smartFilter === "critical"}
                    />
                  );
                }
                return (
                  <div key={org.id} className="summary-card loading-card">
                    <div className="summary-card-header">
                      <h2>{org.name}</h2>
                      <div className="total-tickets">Loading...</div>
                    </div>
                  </div>
                );
              })}
              {filteredAndSortedOrgs.length === 0 && organizations.length > 0 && (
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
      </div>

      {/* Support Tickets - CSM, PM and Product views */}
      <div style={{ display: mainTab === "support" && supportSubTab === "csm" ? "block" : "none" }}>
        <CSMPortfolioView />
      </div>
      <div style={{ display: mainTab === "support" && supportSubTab === "pm" ? "block" : "none" }}>
        <PMPortfolioView />
      </div>
      <div style={{ display: mainTab === "support" && supportSubTab === "product" ? "block" : "none" }}>
        <ProductView />
      </div>

      {/* Usage Analytics Tab Content - Components stay mounted to preserve state */}
      <div style={{ display: mainTab === "usage" && usageSubTab === "customers" ? "block" : "none" }}>
        <CustomerUsageView />
      </div>
      <div style={{ display: mainTab === "usage" && usageSubTab === "csm" ? "block" : "none" }}>
        <CSMUsageView />
      </div>

      {/* Renewals Tab Content - Components stay mounted to preserve state */}
      <div style={{ display: mainTab === "renewals" && renewalsSubTab === "upcoming" ? "block" : "none" }}>
        <RenewalAgent />
      </div>
      <div style={{ display: mainTab === "renewals" && renewalsSubTab === "prs" ? "block" : "none" }}>
        <PRSRenewalView />
      </div>

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
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // If auth is enabled and user is not authenticated, show login
  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  // Otherwise show the dashboard with chat
  return (
    <ChatProvider>
      <Dashboard />
    </ChatProvider>
  );
}

export default App;
