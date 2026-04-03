import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetchAllSummaries } from "../services/api";
import { CustomerSummaryCard } from "./CustomerSummaryCard";
import { OrganizationDrilldown } from "./OrganizationDrilldown";
import { TicketListModal } from "./TicketListModal";
import { Pagination, usePagination } from "./Pagination";
import type { CustomerSummary, Organization } from "../types";

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

// Support Tickets - By Customer View Component
export function SupportCustomersView() {
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
  const [activeDescendant, setActiveDescendant] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function loadData() {
      try {
        const allSummaries = await fetchAllSummaries();
        const orgs: Organization[] = allSummaries.map(s => s.organization);
        setOrganizations(orgs);
        const summaryMap = new Map<number, CustomerSummary>();
        for (const s of allSummaries) {
          summaryMap.set(s.organization.id, s);
        }
        setSummaries(summaryMap);
        setLoadingProgress({ loaded: orgs.length, total: orgs.length });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoadingOrgs(false);
      }
    }

    loadData();
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
              setActiveDescendant(-1);
              if (!e.target.value) {
                setSelectedSearchAccount(null);
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              const suggestionsVisible = showSuggestions && searchSuggestions.length > 0;
              if (e.key === "ArrowDown" && suggestionsVisible) {
                e.preventDefault();
                setActiveDescendant((prev) => Math.min(prev + 1, searchSuggestions.length - 1));
              } else if (e.key === "ArrowUp" && suggestionsVisible) {
                e.preventDefault();
                setActiveDescendant((prev) => Math.max(prev - 1, 0));
              } else if (e.key === "Enter" && activeDescendant >= 0 && suggestionsVisible) {
                e.preventDefault();
                handleSearchSelect(searchSuggestions[activeDescendant]);
                setActiveDescendant(-1);
              } else if (e.key === "Escape" && suggestionsVisible) {
                setShowSuggestions(false);
                setActiveDescendant(-1);
              }
            }}
            role="combobox"
            aria-label="Search accounts"
            aria-expanded={showSuggestions && searchSuggestions.length > 0}
            aria-controls="search-suggestions-listbox"
            aria-activedescendant={activeDescendant >= 0 ? `search-option-${activeDescendant}` : undefined}
            aria-autocomplete="list"
          />
          {(searchQuery || selectedSearchAccount) && (
            <button className="search-clear" onClick={clearSearch} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        {showSuggestions && searchSuggestions.length > 0 && (
          <ul className="search-suggestions" role="listbox" id="search-suggestions-listbox" aria-label="Search suggestions">
            {searchSuggestions.map((account, index) => {
              const summary = consolidatedSummaries.get(account.displayName);
              return (
                <li
                  key={account.displayName}
                  id={`search-option-${index}`}
                  onClick={() => handleSearchSelect(account)}
                  className={`search-suggestion-item ${index === activeDescendant ? "active" : ""}`}
                  role="option"
                  aria-selected={index === activeDescendant}
                >
                  <span className="suggestion-name">
                    {account.displayName}
                    {account.organizations.length > 1 && (
                      <span style={{ color: "#595959", fontSize: "0.85em", marginLeft: 4 }}>
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
