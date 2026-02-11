import { useEffect, useState, useMemo } from "react";
import { fetchPMPortfolios, fetchEnhancedCustomerSummary, fetchGitHubStatusForTickets, fetchEnterpriseSubscriptionsByName, EnterpriseSubscription } from "../services/api";
import { VelocityBanner } from "./VelocityBanner";
import { ProductBacklogCard } from "./ProductBacklogCard";
import { QuarterlySummaryCard } from "./QuarterlySummaryCard";
import { LicenseBanner } from "./LicenseBanner";
import { Pagination, usePagination } from "./Pagination";
import type { PMPortfolio, CSMCustomerSummary, Ticket, MinimalTicket, EnhancedCustomerSummary, GitHubDevelopmentStatus, Organization } from "../types";

// Consolidated customer that groups multiple Zendesk orgs by SF account name
interface ConsolidatedCustomerSummary {
  accountName: string;
  organizations: Organization[];
  ticketStats: { total: number; open: number; pending: number; solved: number; closed: number };
  priorityBreakdown: { urgent: number; high: number; normal: number; low: number };
  featureRequests: number;
  problemReports: number;
  escalations: number;
  tickets: (Ticket | MinimalTicket)[];
  primaryOrgId: number;
}

// Consolidate customers within a portfolio by SF account name
function consolidateCustomerSummaries(customers: CSMCustomerSummary[]): ConsolidatedCustomerSummary[] {
  const accountMap = new Map<string, CSMCustomerSummary[]>();

  for (const customer of customers) {
    const org = customer.organization;
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(customer);
    accountMap.set(accountName, existing);
  }

  return Array.from(accountMap.entries())
    .map(([accountName, customerGroup]) => {
      const aggregated: ConsolidatedCustomerSummary = {
        accountName,
        organizations: customerGroup.map((c) => c.organization),
        ticketStats: { total: 0, open: 0, pending: 0, solved: 0, closed: 0 },
        priorityBreakdown: { urgent: 0, high: 0, normal: 0, low: 0 },
        featureRequests: 0,
        problemReports: 0,
        escalations: 0,
        tickets: [],
        primaryOrgId: customerGroup[0].organization.id,
      };

      for (const customer of customerGroup) {
        aggregated.ticketStats.total += customer.ticketStats.total;
        aggregated.ticketStats.open += customer.ticketStats.open;
        aggregated.ticketStats.pending += customer.ticketStats.pending;
        aggregated.ticketStats.solved += customer.ticketStats.solved;
        aggregated.ticketStats.closed += customer.ticketStats.closed;
        aggregated.priorityBreakdown.urgent += customer.priorityBreakdown.urgent;
        aggregated.priorityBreakdown.high += customer.priorityBreakdown.high;
        aggregated.priorityBreakdown.normal += customer.priorityBreakdown.normal;
        aggregated.priorityBreakdown.low += customer.priorityBreakdown.low;
        aggregated.featureRequests += customer.featureRequests;
        aggregated.problemReports += customer.problemReports;
        aggregated.escalations += customer.escalations;
        aggregated.tickets = [...aggregated.tickets, ...customer.tickets];
      }

      return aggregated;
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

export function PMPortfolioView() {
  const [portfolios, setPortfolios] = useState<PMPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPM, setExpandedPM] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Sort portfolios alphabetically by PM name
  const sortedPortfolios = useMemo(() => {
    return [...portfolios].sort((a, b) => a.pm.name.localeCompare(b.pm.name));
  }, [portfolios]);

  // Apply pagination to sorted portfolios
  const paginatedPortfolios = usePagination(sortedPortfolios, pageSize, currentPage);

  useEffect(() => {
    async function loadPortfolios() {
      try {
        const data = await fetchPMPortfolios();
        setPortfolios(data.portfolios);
        setIsAdmin(data.isAdmin);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load portfolios");
      } finally {
        setLoading(false);
      }
    }
    loadPortfolios();
  }, []);

  if (loading) {
    return <div className="loading">Loading Project Manager portfolios...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (portfolios.length === 0) {
    return (
      <div className="no-data-message">
        Fetching the latest data for PM portfolios...
      </div>
    );
  }

  return (
    <div className="csm-portfolio-view">
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {portfolios.length} PM portfolios</span>
        </div>
      )}
      <Pagination
        totalItems={portfolios.length}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />
      <div className="csm-list">
        {paginatedPortfolios.map((portfolio) => (
          <PMCard
            key={portfolio.pm.email}
            portfolio={portfolio}
            expanded={expandedPM === portfolio.pm.email}
            onToggle={() =>
              setExpandedPM(expandedPM === portfolio.pm.email ? null : portfolio.pm.email)
            }
            expandedCustomer={expandedCustomer}
            onCustomerToggle={(key) =>
              setExpandedCustomer(expandedCustomer === key ? null : key)
            }
          />
        ))}
      </div>
    </div>
  );
}

interface PMCardProps {
  portfolio: PMPortfolio;
  expanded: boolean;
  onToggle: () => void;
  expandedCustomer: string | null;
  onCustomerToggle: (key: string) => void;
}

function PMCard({
  portfolio,
  expanded,
  onToggle,
  expandedCustomer,
  onCustomerToggle,
}: PMCardProps) {
  const { pm, customers } = portfolio;

  // Consolidate customers by SF account name
  const consolidatedCustomers = consolidateCustomerSummaries(customers);

  return (
    <div className={`csm-card ${expanded ? "expanded" : ""}`}>
      <div className="csm-header" onClick={onToggle}>
        <div className="csm-info">
          <h3>{pm.name}</h3>
          <span className="csm-email">{pm.email}</span>
        </div>
        <div className="csm-stats">
          <div className="csm-stat">
            <span className="value">{consolidatedCustomers.length}</span>
            <span className="label">Customers</span>
          </div>
        </div>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="csm-customers">
          {consolidatedCustomers.length === 0 ? (
            <p className="no-customers">No customer tickets found</p>
          ) : (
            consolidatedCustomers.map((customer) => {
              const key = `${pm.id}-${customer.accountName}`;
              return (
                <ConsolidatedCustomerCard
                  key={key}
                  customer={customer}
                  expanded={expandedCustomer === key}
                  onToggle={() => onCustomerToggle(key)}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

interface ConsolidatedCustomerCardProps {
  customer: ConsolidatedCustomerSummary;
  expanded: boolean;
  onToggle: () => void;
}

function ConsolidatedCustomerCard({ customer, expanded, onToggle }: ConsolidatedCustomerCardProps) {
  const { accountName, organizations, ticketStats, featureRequests, problemReports, escalations, tickets, primaryOrgId } = customer;
  const [enhancedSummary, setEnhancedSummary] = useState<EnhancedCustomerSummary | null>(null);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);
  const [githubStatusMap, setGitHubStatusMap] = useState<Map<number, GitHubDevelopmentStatus[]> | null>(null);
  const [subscriptions, setSubscriptions] = useState<EnterpriseSubscription[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [drilldownTickets, setDrilldownTickets] = useState<{
    title: string;
    tickets: (Ticket | MinimalTicket)[];
    grouped?: boolean;
  } | null>(null);

  // Fetch enhanced summary and subscriptions when expanded
  useEffect(() => {
    if (expanded && !enhancedSummary && !loadingEnhanced) {
      setLoadingEnhanced(true);
      fetchEnhancedCustomerSummary(primaryOrgId)
        .then(setEnhancedSummary)
        .catch((err) => console.error("Failed to load enhanced summary:", err))
        .finally(() => setLoadingEnhanced(false));
    }

    if (expanded && subscriptions.length === 0 && !loadingSubscriptions) {
      setLoadingSubscriptions(true);
      fetchEnterpriseSubscriptionsByName(accountName)
        .then((data) => setSubscriptions(data.subscriptions))
        .catch((err) => console.error("Failed to load subscriptions:", err))
        .finally(() => setLoadingSubscriptions(false));
    }
  }, [expanded, enhancedSummary, loadingEnhanced, primaryOrgId, subscriptions.length, loadingSubscriptions, accountName]);

  // Fetch GitHub statuses for ALL tickets when card is expanded
  useEffect(() => {
    if (expanded && !githubStatusMap && tickets.length > 0) {
      // Get all ticket IDs from the customer's portfolio
      const ticketIds = tickets.map((t) => t.id);

      fetchGitHubStatusForTickets(ticketIds)
        .then((newMap) => {
          const completeMap = new Map<number, GitHubDevelopmentStatus[]>();
          for (const id of ticketIds) {
            completeMap.set(id, newMap.get(id) || []);
          }
          setGitHubStatusMap(completeMap);
        })
        .catch((err) => console.error("Failed to load GitHub statuses:", err));
    }
  }, [expanded, githubStatusMap, tickets]);

  const handleModuleClick = (productName: string, moduleName: string, moduleTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName}`, tickets: moduleTickets });
  };

  const handleModuleFeaturesClick = (productName: string, moduleName: string, featureTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName} - Features`, tickets: featureTickets });
  };

  const handleModuleBugsClick = (productName: string, moduleName: string, bugTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName} - Bugs`, tickets: bugTickets });
  };

  const handleTypeClick = (type: "feature" | "bug", e: React.MouseEvent) => {
    e.stopPropagation();
    const filteredTickets = tickets.filter((t) => t.ticket_type === type);
    const typeLabel = type === "feature" ? "Feature Requests" : "Bug Reports";
    setDrilldownTickets({ title: typeLabel, tickets: filteredTickets });
  };

  const handleEscalationsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const escalatedTickets = tickets.filter((t) => t.is_escalated && !["solved", "closed"].includes(t.status));
    setDrilldownTickets({ title: "Escalated Tickets", tickets: escalatedTickets });
  };

  // Velocity drill-down handlers
  const handleBugsFixedClick = () => {
    const bugsFixed = tickets.filter(
      (t) => t.ticket_type === "bug" && (t.status === "solved" || t.status === "closed")
    );
    setDrilldownTickets({ title: "Bugs Fixed This Month", tickets: bugsFixed });
  };

  const handleFeaturesCompletedClick = () => {
    const featuresCompleted = tickets.filter(
      (t) => t.ticket_type === "feature" && (t.status === "solved" || t.status === "closed")
    );
    setDrilldownTickets({ title: "Features Completed This Month", tickets: featuresCompleted });
  };

  // Status drill-down handler
  const handleStatusClick = (status: string) => {
    const filteredTickets = tickets.filter((t) => t.status === status);
    const statusLabels: Record<string, string> = {
      new: "New",
      open: "Open",
      pending: "Pending",
      hold: "On Hold",
    };
    setDrilldownTickets({ title: `${statusLabels[status] || status} Tickets`, tickets: filteredTickets });
  };

  // Quarterly drill-down handlers
  const getQuarterDateRange = (quarter: "current" | "previous"): { start: Date; end: Date } => {
    const now = new Date();
    const currentQuarterNum = Math.floor(now.getMonth() / 3) + 1;
    const currentYear = now.getFullYear();

    if (quarter === "current") {
      const start = new Date(currentYear, (currentQuarterNum - 1) * 3, 1);
      const end = new Date(currentYear, currentQuarterNum * 3, 0, 23, 59, 59);
      return { start, end };
    } else {
      let prevQuarterNum = currentQuarterNum - 1;
      let prevYear = currentYear;
      if (prevQuarterNum === 0) {
        prevQuarterNum = 4;
        prevYear = currentYear - 1;
      }
      const start = new Date(prevYear, (prevQuarterNum - 1) * 3, 1);
      const end = new Date(prevYear, prevQuarterNum * 3, 0, 23, 59, 59);
      return { start, end };
    }
  };

  const handleQuarterlyBugsClick = (quarter: "current" | "previous") => {
    const { start, end } = getQuarterDateRange(quarter);
    const quarterLabel = quarter === "current" ? enhancedSummary?.currentQuarter.quarter : enhancedSummary?.previousQuarter.quarter;
    const bugsFixed = tickets.filter((t) => {
      if (t.ticket_type !== "bug" || (t.status !== "solved" && t.status !== "closed")) return false;
      const updatedAt = new Date(t.updated_at);
      return updatedAt >= start && updatedAt <= end;
    });
    setDrilldownTickets({ title: `Bugs Fixed - ${quarterLabel}`, tickets: bugsFixed, grouped: true });
  };

  const handleQuarterlyFeaturesClick = (quarter: "current" | "previous") => {
    const { start, end } = getQuarterDateRange(quarter);
    const quarterLabel = quarter === "current" ? enhancedSummary?.currentQuarter.quarter : enhancedSummary?.previousQuarter.quarter;
    const features = tickets.filter((t) => {
      if (t.ticket_type !== "feature" || (t.status !== "solved" && t.status !== "closed")) return false;
      const updatedAt = new Date(t.updated_at);
      return updatedAt >= start && updatedAt <= end;
    });
    setDrilldownTickets({ title: `Features Completed - ${quarterLabel}`, tickets: features, grouped: true });
  };

  const handleQuarterlyTotalClick = (quarter: "current" | "previous") => {
    const { start, end } = getQuarterDateRange(quarter);
    const quarterLabel = quarter === "current" ? enhancedSummary?.currentQuarter.quarter : enhancedSummary?.previousQuarter.quarter;
    const closed = tickets.filter((t) => {
      if (t.status !== "solved" && t.status !== "closed") return false;
      const updatedAt = new Date(t.updated_at);
      return updatedAt >= start && updatedAt <= end;
    });
    setDrilldownTickets({ title: `All Closed - ${quarterLabel}`, tickets: closed, grouped: true });
  };

  // Calculate unresolved ticket count
  const unresolvedCount = tickets.filter(t =>
    ['new', 'open', 'pending', 'hold'].includes(t.status)
  ).length;

  // Calculate status counts for display
  const statusCounts = {
    new: tickets.filter(t => t.status === 'new').length,
    open: tickets.filter(t => t.status === 'open').length,
    pending: tickets.filter(t => t.status === 'pending').length,
    hold: tickets.filter(t => t.status === 'hold').length,
  };

  return (
    <div className={`customer-card ${expanded ? "expanded" : ""}`}>
      <div className="customer-header" onClick={onToggle}>
        <div className="customer-info">
          <h4>{accountName}</h4>
          {organizations.length > 1 && (
            <span className="org-count">({organizations.length} Zendesk orgs)</span>
          )}
          <span className="ticket-count">{unresolvedCount} Unresolved tickets</span>
        </div>
        <div className="customer-stats-mini">
          <div className="status-breakdown">
            {statusCounts.new > 0 && (
              <span className="status-badge new clickable" onClick={(e) => { e.stopPropagation(); handleStatusClick('new'); }}>
                {statusCounts.new} new
              </span>
            )}
            {statusCounts.open > 0 && (
              <span className="status-badge open clickable" onClick={(e) => { e.stopPropagation(); handleStatusClick('open'); }}>
                {statusCounts.open} open
              </span>
            )}
            {statusCounts.pending > 0 && (
              <span className="status-badge pending clickable" onClick={(e) => { e.stopPropagation(); handleStatusClick('pending'); }}>
                {statusCounts.pending} pending
              </span>
            )}
            {statusCounts.hold > 0 && (
              <span className="status-badge hold clickable" onClick={(e) => { e.stopPropagation(); handleStatusClick('hold'); }}>
                {statusCounts.hold} on hold
              </span>
            )}
          </div>
          <div className="type-breakdown">
            <span className="feature-count clickable" onClick={(e) => handleTypeClick("feature", e)}>
              {featureRequests} features
            </span>
            <span className="problem-count clickable" onClick={(e) => handleTypeClick("bug", e)}>
              {problemReports} problems
            </span>
            {escalations > 0 && (
              <span className="escalation-count clickable" onClick={handleEscalationsClick}>
                {escalations} escalated
              </span>
            )}
          </div>
        </div>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="customer-details">
          {/* License Banner */}
          <LicenseBanner
            subscriptions={subscriptions}
            loading={loadingSubscriptions}
            accountName={!loadingSubscriptions && subscriptions.length === 0 ? accountName : undefined}
            compact
          />

          {loadingEnhanced ? (
            <div className="loading-enhanced">Loading detailed summary...</div>
          ) : enhancedSummary ? (
            <>
              <VelocityBanner
                velocity={enhancedSummary.velocity}
                ticketStats={{
                  new: ticketStats.open > 0 ? tickets.filter(t => t.status === 'new').length : 0,
                  open: tickets.filter(t => t.status === 'open').length,
                  pending: tickets.filter(t => t.status === 'pending').length,
                  hold: tickets.filter(t => t.status === 'hold').length,
                }}
                onBugsFixedClick={handleBugsFixedClick}
                onFeaturesCompletedClick={handleFeaturesCompletedClick}
                onStatusClick={handleStatusClick}
              />

              <QuarterlySummaryCard
                currentQuarter={enhancedSummary.currentQuarter}
                previousQuarter={enhancedSummary.previousQuarter}
                onBugsClick={handleQuarterlyBugsClick}
                onFeaturesClick={handleQuarterlyFeaturesClick}
                onTotalClick={handleQuarterlyTotalClick}
              />

              <div className="product-backlog-section">
                <h5>Product Backlog</h5>
                {enhancedSummary.backlog.length === 0 ? (
                  <p className="no-backlog">No open tickets in backlog</p>
                ) : (
                  enhancedSummary.backlog.map((product) => (
                    <ProductBacklogCard
                      key={product.productName}
                      backlog={product}
                      onModuleClick={handleModuleClick}
                      onFeaturesClick={handleModuleFeaturesClick}
                      onBugsClick={handleModuleBugsClick}
                      githubStatusByTicketId={githubStatusMap || undefined}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="error-enhanced">Failed to load detailed summary</div>
          )}
        </div>
      )}

      {drilldownTickets && (
        <div className="ticket-drilldown-modal" onClick={() => setDrilldownTickets(null)}>
          <div className="ticket-drilldown-content" onClick={(e) => e.stopPropagation()}>
            <div className="drilldown-header">
              <h4>{drilldownTickets.title}</h4>
              <span className="drilldown-count">{drilldownTickets.tickets.length} tickets</span>
              <button onClick={() => setDrilldownTickets(null)}>Close</button>
            </div>
            {drilldownTickets.grouped ? (
              <GroupedTicketView tickets={drilldownTickets.tickets} githubStatusMap={githubStatusMap} />
            ) : (
              <SortableTicketTable
                tickets={drilldownTickets.tickets}
                githubStatusMap={githubStatusMap}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Sortable Ticket Table Component
type SortColumn = "id" | "subject" | "type" | "subtype" | "status" | "priority" | "age" | "updated";
type SortDirection = "asc" | "desc";

interface SortableTicketTableProps {
  tickets: (Ticket | MinimalTicket)[];
  githubStatusMap?: Map<number, GitHubDevelopmentStatus[]> | null;
}

function SortableTicketTable({ tickets, githubStatusMap }: SortableTicketTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("age");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const calculateAge = (createdAt: string | undefined | null): number => {
    if (!createdAt) return 0;
    const created = new Date(createdAt);
    if (isNaN(created.getTime())) return 0;
    const now = new Date();
    const diffTime = now.getTime() - created.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const formatAge = (days: number): string => {
    if (isNaN(days) || days === 0) return "Today";
    if (days === 1) return "1 day";
    if (days < 7) return `${days} days`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return weeks === 1 ? "1 week" : `${weeks} weeks`;
    }
    if (days < 365) {
      const months = Math.floor(days / 30);
      return months === 1 ? "1 month" : `${months} months`;
    }
    const years = Math.floor(days / 365);
    return years === 1 ? "1 year" : `${years} years`;
  };

  const getAgeClass = (days: number): string => {
    if (days <= 7) return "age-fresh";
    if (days <= 30) return "age-recent";
    if (days <= 90) return "age-moderate";
    if (days <= 180) return "age-old";
    return "age-stale";
  };

  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const sortedTickets = useMemo(() => {
    const sorted = [...tickets].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case "id":
          comparison = a.id - b.id;
          break;
        case "subject":
          comparison = (a.subject || "").localeCompare(b.subject || "");
          break;
        case "type":
          comparison = (a.ticket_type || "other").localeCompare(b.ticket_type || "other");
          break;
        case "subtype":
          comparison = (a.issue_subtype || a.module || "").localeCompare(b.issue_subtype || b.module || "");
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "priority":
          comparison = (priorityOrder[a.priority || "normal"] || 2) - (priorityOrder[b.priority || "normal"] || 2);
          break;
        case "age":
          comparison = calculateAge(a.created_at) - calculateAge(b.created_at);
          break;
        case "updated":
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [tickets, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const renderSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return <span className="sort-indicator inactive">⇅</span>;
    return <span className="sort-indicator active">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  const openInZendesk = (ticket: Ticket | MinimalTicket) => {
    const url = ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`;
    window.open(url, "_blank");
  };

  return (
    <div className="ticket-table-container">
      <table className="ticket-table sortable">
        <thead>
          <tr>
            <th className="sortable-header" onClick={() => handleSort("id")}>
              ID {renderSortIndicator("id")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("subject")}>
              Subject {renderSortIndicator("subject")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("type")}>
              Type {renderSortIndicator("type")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("subtype")}>
              Subtype {renderSortIndicator("subtype")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("status")}>
              Status {renderSortIndicator("status")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("priority")}>
              Priority {renderSortIndicator("priority")}
            </th>
            <th>GitHub</th>
            <th className="sortable-header" onClick={() => handleSort("age")}>
              Age {renderSortIndicator("age")}
            </th>
            <th className="sortable-header" onClick={() => handleSort("updated")}>
              Updated {renderSortIndicator("updated")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedTickets.map((ticket) => {
            const age = calculateAge(ticket.created_at);
            const githubStatuses = githubStatusMap?.get(ticket.id);

            return (
              <tr
                key={ticket.id}
                className={`ticket-detail-row ${ticket.is_escalated ? "escalated" : ""}`}
                onClick={() => openInZendesk(ticket)}
              >
                <td className="ticket-id">
                  <a
                    href={ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    #{ticket.id}
                  </a>
                  {ticket.is_escalated && <span className="escalation-indicator" title="Escalated">!</span>}
                </td>
                <td className="ticket-subject">{ticket.subject || "No subject"}</td>
                <td className={`ticket-type type-${ticket.ticket_type || "other"}`}>
                  {ticket.ticket_type === "bug" ? "Bug" : ticket.ticket_type === "feature" ? "Feature" : "Other"}
                </td>
                <td className="ticket-subtype">{ticket.issue_subtype || ticket.module || "-"}</td>
                <td className={`ticket-status status-${ticket.status}`}>{ticket.status}</td>
                <td className={`ticket-priority priority-${ticket.priority || "normal"}`}>{ticket.priority || "normal"}</td>
                <td className="ticket-github">
                  {githubStatuses && githubStatuses.length > 0 ? (
                    <div className="github-links">
                      {githubStatuses.map((gh, idx) => (
                        <a
                          key={idx}
                          href={gh.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`github-status-pill status-${gh.projectStatus?.toLowerCase().replace(/\s+/g, "-") || "unknown"}`}
                          onClick={(e) => e.stopPropagation()}
                          title={`${gh.repoName}#${gh.issueNumber}`}
                        >
                          <span className="gh-icon">GH</span>
                          <span className="gh-status">{gh.projectStatus || "Linked"}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className="no-github">-</span>
                  )}
                </td>
                <td className={`ticket-age ${getAgeClass(age)}`} title={`Created: ${formatDate(ticket.created_at)}`}>
                  {formatAge(age)}
                </td>
                <td className="ticket-updated">{formatDate(ticket.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ProductGroup {
  productName: string;
  isPrimary: boolean;
  types: {
    typeName: string;
    tickets: (Ticket | MinimalTicket)[];
  }[];
}

type GroupSortColumn = "age" | "priority" | "updated";

function GroupedTicketView({ tickets, githubStatusMap }: { tickets: (Ticket | MinimalTicket)[]; githubStatusMap?: Map<number, GitHubDevelopmentStatus[]> | null }) {
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<GroupSortColumn>("age");
  const [sortAsc, setSortAsc] = useState(false);

  const calculateAge = (createdAt: string | undefined | null): number => {
    if (!createdAt) return 0;
    const created = new Date(createdAt);
    if (isNaN(created.getTime())) return 0;
    const now = new Date();
    const diffTime = now.getTime() - created.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const formatAge = (days: number): string => {
    if (isNaN(days) || days === 0) return "Today";
    if (days === 1) return "1d";
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
  };

  const getAgeClass = (days: number): string => {
    if (days <= 7) return "age-fresh";
    if (days <= 30) return "age-recent";
    if (days <= 90) return "age-moderate";
    if (days <= 180) return "age-old";
    return "age-stale";
  };

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const sortTickets = (ticketList: (Ticket | MinimalTicket)[]): (Ticket | MinimalTicket)[] => {
    return [...ticketList].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "age":
          comparison = calculateAge(a.created_at) - calculateAge(b.created_at);
          break;
        case "priority":
          comparison = (priorityOrder[a.priority || "normal"] || 2) - (priorityOrder[b.priority || "normal"] || 2);
          break;
        case "updated":
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      return sortAsc ? comparison : -comparison;
    });
  };

  const handleSortChange = (column: GroupSortColumn) => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(false);
    }
  };

  const groupedData: ProductGroup[] = (() => {
    const productMap = new Map<string, Map<string, (Ticket | MinimalTicket)[]>>();

    for (const ticket of tickets) {
      const product = ticket.product || "Unassigned";
      const ticketType = ticket.ticket_type === "bug" ? "Bug" : ticket.ticket_type === "feature" ? "Feature" : "Other";

      if (!productMap.has(product)) {
        productMap.set(product, new Map());
      }
      const typeMap = productMap.get(product)!;
      if (!typeMap.has(ticketType)) {
        typeMap.set(ticketType, []);
      }
      typeMap.get(ticketType)!.push(ticket);
    }

    let primaryProduct = "";
    let maxCount = 0;
    for (const [product, typeMap] of productMap) {
      let count = 0;
      for (const tickets of typeMap.values()) {
        count += tickets.length;
      }
      if (count > maxCount) {
        maxCount = count;
        primaryProduct = product;
      }
    }

    const result: ProductGroup[] = [];
    const typeOrder = ["Bug", "Feature", "Other"];

    const buildTypes = (typeMap: Map<string, (Ticket | MinimalTicket)[]>) => {
      const types: { typeName: string; tickets: (Ticket | MinimalTicket)[] }[] = [];
      for (const typeName of typeOrder) {
        if (typeMap.has(typeName)) {
          types.push({ typeName, tickets: typeMap.get(typeName)! });
        }
      }
      return types;
    };

    if (primaryProduct && productMap.has(primaryProduct)) {
      result.push({
        productName: primaryProduct,
        isPrimary: true,
        types: buildTypes(productMap.get(primaryProduct)!),
      });
    }

    const otherProducts = Array.from(productMap.keys())
      .filter((p) => p !== primaryProduct)
      .sort();

    for (const productName of otherProducts) {
      result.push({
        productName,
        isPrimary: false,
        types: buildTypes(productMap.get(productName)!),
      });
    }

    return result;
  })();

  const toggleProduct = (productName: string) => {
    const newSet = new Set(expandedProducts);
    if (newSet.has(productName)) {
      newSet.delete(productName);
    } else {
      newSet.add(productName);
    }
    setExpandedProducts(newSet);
  };

  const toggleType = (key: string) => {
    const newSet = new Set(expandedTypes);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setExpandedTypes(newSet);
  };

  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="grouped-ticket-view">
      <div className="grouped-sort-controls">
        <span className="sort-label">Sort by:</span>
        <button
          className={`sort-btn ${sortBy === "age" ? "active" : ""}`}
          onClick={() => handleSortChange("age")}
        >
          Age {sortBy === "age" && (sortAsc ? "↑" : "↓")}
        </button>
        <button
          className={`sort-btn ${sortBy === "priority" ? "active" : ""}`}
          onClick={() => handleSortChange("priority")}
        >
          Priority {sortBy === "priority" && (sortAsc ? "↑" : "↓")}
        </button>
        <button
          className={`sort-btn ${sortBy === "updated" ? "active" : ""}`}
          onClick={() => handleSortChange("updated")}
        >
          Updated {sortBy === "updated" && (sortAsc ? "↑" : "↓")}
        </button>
      </div>

      {groupedData.map((product) => {
        const productExpanded = expandedProducts.has(product.productName);
        const totalTickets = product.types.reduce((sum, t) => sum + t.tickets.length, 0);

        return (
          <div key={product.productName} className={`product-group ${product.isPrimary ? "primary-product" : "other-product"}`}>
            <div
              className="product-group-header"
              onClick={() => toggleProduct(product.productName)}
            >
              <span className="expand-icon">{productExpanded ? "▼" : "▶"}</span>
              <span className="product-name">
                {product.productName}
                {product.isPrimary && <span className="primary-badge">Primary</span>}
              </span>
              <span className="product-count">{totalTickets} tickets</span>
            </div>

            {productExpanded && (
              <div className="product-group-content">
                {product.types.map((type) => {
                  const typeKey = `${product.productName}-${type.typeName}`;
                  const typeExpanded = expandedTypes.has(typeKey);
                  const sortedTypeTickets = sortTickets(type.tickets);

                  return (
                    <div key={typeKey} className="type-group">
                      <div
                        className={`type-group-header type-${type.typeName.toLowerCase()}`}
                        onClick={() => toggleType(typeKey)}
                      >
                        <span className="expand-icon">{typeExpanded ? "▼" : "▶"}</span>
                        <span className="type-name">{type.typeName}</span>
                        <span className="type-count">{type.tickets.length}</span>
                      </div>

                      {typeExpanded && (
                        <div className="type-group-tickets">
                          {sortedTypeTickets.map((ticket) => {
                            const ticketGithubStatuses = githubStatusMap?.get(ticket.id);
                            const age = calculateAge(ticket.created_at);
                            return (
                              <div
                                key={ticket.id}
                                className={`grouped-ticket-row ${ticket.is_escalated ? "escalated" : ""}`}
                                onClick={() => {
                                  const url = ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`;
                                  window.open(url, "_blank");
                                }}
                              >
                                <span className="ticket-id">
                                  #{ticket.id}
                                  {ticket.is_escalated && <span className="escalation-indicator" title="Escalated">!</span>}
                                </span>
                                <span className={`ticket-age ${getAgeClass(age)}`} title={`Created: ${formatDate(ticket.created_at)}`}>
                                  {formatAge(age)}
                                </span>
                                <span className="ticket-subtype">{ticket.issue_subtype || ticket.module || "-"}</span>
                                <span className="ticket-subject">{ticket.subject || "No subject"}</span>
                                <span className={`ticket-priority priority-${ticket.priority || "normal"}`}>
                                  {ticket.priority || "normal"}
                                </span>
                                {ticketGithubStatuses && ticketGithubStatuses.length > 0 && (
                                  <span className="ticket-github-pills">
                                    {ticketGithubStatuses.map((gh, idx) => (
                                      <a
                                        key={idx}
                                        href={gh.githubUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`github-status-pill status-${gh.projectStatus?.toLowerCase().replace(/\s+/g, "-") || "unknown"}`}
                                        onClick={(e) => e.stopPropagation()}
                                        title={`${gh.repoName}#${gh.issueNumber}`}
                                      >
                                        <span className="gh-icon">GH</span>
                                        <span className="gh-status">{gh.projectStatus || "Linked"}</span>
                                      </a>
                                    ))}
                                  </span>
                                )}
                                <span className="ticket-updated">{formatDate(ticket.updated_at)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
