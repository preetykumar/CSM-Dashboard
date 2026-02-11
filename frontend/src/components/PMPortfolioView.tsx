import { useEffect, useState, useMemo } from "react";
import { fetchPMPortfolios, fetchEnhancedCustomerSummary } from "../services/api";
import { VelocityBanner } from "./VelocityBanner";
import { QuarterlySummaryCard } from "./QuarterlySummaryCard";
import { Pagination, usePagination } from "./Pagination";
import type { PMPortfolio, CSMCustomerSummary, Ticket, MinimalTicket, EnhancedCustomerSummary, Organization } from "../types";

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

  const handlePMClick = (pmName: string) => {
    setExpandedPM(expandedPM === pmName ? null : pmName);
    setExpandedCustomer(null);
  };

  const handleCustomerClick = (customerId: string) => {
    setExpandedCustomer(expandedCustomer === customerId ? null : customerId);
  };

  if (loading) {
    return (
      <div className="pm-portfolio-view">
        <div className="loading">Loading Project Manager portfolios...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pm-portfolio-view">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (portfolios.length === 0) {
    return (
      <div className="pm-portfolio-view">
        <div className="empty-state">
          <h3>No Project Manager Portfolios Found</h3>
          <p>Project Manager assignments are synced from Salesforce using the Project_Manager__c field on the Account object.</p>
          <p>Please ensure:</p>
          <ul>
            <li>The Project_Manager__c field exists on the Account object in Salesforce</li>
            <li>Accounts have Project Managers assigned</li>
            <li>A data sync has been run recently</li>
          </ul>
        </div>
      </div>
    );
  }

  // Calculate totals for summary banner
  const totalCustomers = portfolios.reduce((sum, p) => sum + p.totalCustomers, 0);
  const totalTickets = portfolios.reduce((sum, p) => sum + p.totalTickets, 0);
  const openTickets = portfolios.reduce((sum, p) => sum + p.openTickets, 0);

  return (
    <div className="pm-portfolio-view">
      <div className="pm-header">
        <h2>Project Manager Portfolios</h2>
        <div className="pm-summary-stats">
          <span className="stat-badge">{portfolios.length} Project Managers</span>
          <span className="stat-badge">{totalCustomers} Customers</span>
          <span className="stat-badge">{totalTickets} Total Tickets</span>
          <span className="stat-badge highlight">{openTickets} Open</span>
        </div>
      </div>

      {isAdmin && sortedPortfolios.length > pageSize && (
        <div className="pagination-controls">
          <Pagination
            totalItems={sortedPortfolios.length}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      )}

      <div className="pm-list">
        {paginatedPortfolios.map((portfolio) => (
          <PMCard
            key={portfolio.pm.email}
            portfolio={portfolio}
            expanded={expandedPM === portfolio.pm.name}
            onToggle={() => handlePMClick(portfolio.pm.name)}
            expandedCustomer={expandedCustomer}
            onCustomerToggle={handleCustomerClick}
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
  onCustomerToggle: (customerId: string) => void;
}

function PMCard({ portfolio, expanded, onToggle, expandedCustomer, onCustomerToggle }: PMCardProps) {
  const { pm, customers, totalTickets, openTickets, totalCustomers } = portfolio;
  const consolidatedCustomers = useMemo(() => consolidateCustomerSummaries(customers), [customers]);

  // Calculate escalations and critical defects
  const totalEscalations = customers.reduce((sum, c) => sum + c.escalations, 0);
  const totalUrgentHigh = customers.reduce((sum, c) => sum + c.priorityBreakdown.urgent + c.priorityBreakdown.high, 0);

  return (
    <div className={`pm-card ${expanded ? "expanded" : ""}`}>
      <div className="pm-card-header" onClick={onToggle}>
        <div className="pm-info">
          <span className="pm-expand-icon">{expanded ? "−" : "+"}</span>
          <h3>{pm.name}</h3>
          <span className="pm-email">{pm.email}</span>
        </div>
        <div className="pm-stats">
          <span className="stat">{totalCustomers} customers</span>
          <span className="stat">{totalTickets} tickets</span>
          <span className="stat highlight">{openTickets} open</span>
          {totalEscalations > 0 && <span className="stat escalation">{totalEscalations} escalations</span>}
          {totalUrgentHigh > 0 && <span className="stat critical">{totalUrgentHigh} urgent/high</span>}
        </div>
      </div>

      {expanded && (
        <div className="pm-card-body">
          <div className="customer-grid">
            {consolidatedCustomers.map((customer) => (
              <ConsolidatedCustomerCard
                key={customer.accountName}
                customer={customer}
                expanded={expandedCustomer === customer.accountName}
                onToggle={() => onCustomerToggle(customer.accountName)}
              />
            ))}
          </div>
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
  const [enhancedSummary, setEnhancedSummary] = useState<EnhancedCustomerSummary | null>(null);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);

  useEffect(() => {
    if (expanded && !enhancedSummary && !loadingEnhanced) {
      setLoadingEnhanced(true);
      fetchEnhancedCustomerSummary(customer.primaryOrgId)
        .then(setEnhancedSummary)
        .catch(console.error)
        .finally(() => setLoadingEnhanced(false));
    }
  }, [expanded, enhancedSummary, loadingEnhanced, customer.primaryOrgId]);

  const { ticketStats, priorityBreakdown, escalations } = customer;
  const activeTickets = ticketStats.open + ticketStats.pending;

  return (
    <div className={`customer-card ${expanded ? "expanded" : ""}`}>
      <div className="customer-card-header" onClick={onToggle}>
        <div className="customer-info">
          <span className="expand-icon">{expanded ? "−" : "+"}</span>
          <h4>{customer.accountName}</h4>
          {customer.organizations.length > 1 && (
            <span className="org-count">({customer.organizations.length} orgs)</span>
          )}
        </div>
        <div className="customer-quick-stats">
          <span className="stat">{ticketStats.total} tickets</span>
          <span className={`stat ${activeTickets > 0 ? "highlight" : ""}`}>{activeTickets} active</span>
          {escalations > 0 && <span className="stat escalation">{escalations} esc</span>}
          {(priorityBreakdown.urgent + priorityBreakdown.high) > 0 && (
            <span className="stat critical">{priorityBreakdown.urgent + priorityBreakdown.high} crit</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="customer-card-body">
          {loadingEnhanced ? (
            <div className="loading-mini">Loading customer details...</div>
          ) : enhancedSummary ? (
            <div className="customer-details">
              {/* Velocity Banner */}
              <VelocityBanner velocity={enhancedSummary.velocity} />

              {/* Quarterly Summaries for QBR reporting */}
              <div className="quarterly-section">
                <h5>Quarterly Performance (QBR Data)</h5>
                <QuarterlySummaryCard
                  currentQuarter={enhancedSummary.currentQuarter}
                  previousQuarter={enhancedSummary.previousQuarter}
                />
              </div>

              {/* Ticket Status Breakdown */}
              <div className="status-breakdown">
                <h5>Ticket Status</h5>
                <div className="status-grid">
                  <div className="status-item new">
                    <span className="status-count">{ticketStats.open}</span>
                    <span className="status-label">Open</span>
                  </div>
                  <div className="status-item pending">
                    <span className="status-count">{ticketStats.pending}</span>
                    <span className="status-label">Pending</span>
                  </div>
                  <div className="status-item solved">
                    <span className="status-count">{ticketStats.solved}</span>
                    <span className="status-label">Solved</span>
                  </div>
                  <div className="status-item closed">
                    <span className="status-count">{ticketStats.closed}</span>
                    <span className="status-label">Closed</span>
                  </div>
                </div>
              </div>

              {/* Priority Breakdown */}
              <div className="priority-breakdown">
                <h5>Priority Breakdown</h5>
                <div className="priority-grid">
                  <div className="priority-item urgent">
                    <span className="priority-count">{priorityBreakdown.urgent}</span>
                    <span className="priority-label">Urgent</span>
                  </div>
                  <div className="priority-item high">
                    <span className="priority-count">{priorityBreakdown.high}</span>
                    <span className="priority-label">High</span>
                  </div>
                  <div className="priority-item normal">
                    <span className="priority-count">{priorityBreakdown.normal}</span>
                    <span className="priority-label">Normal</span>
                  </div>
                  <div className="priority-item low">
                    <span className="priority-count">{priorityBreakdown.low}</span>
                    <span className="priority-label">Low</span>
                  </div>
                </div>
              </div>

              {/* Request Type Summary */}
              <div className="request-type-summary">
                <h5>Request Types</h5>
                <div className="request-type-grid">
                  <div className="request-type bug">
                    <span className="type-count">{customer.problemReports}</span>
                    <span className="type-label">Bugs/Issues</span>
                  </div>
                  <div className="request-type feature">
                    <span className="type-count">{customer.featureRequests}</span>
                    <span className="type-label">Features</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="customer-details-fallback">
              <div className="status-breakdown">
                <h5>Ticket Status</h5>
                <div className="status-grid">
                  <div className="status-item">Open: {ticketStats.open}</div>
                  <div className="status-item">Pending: {ticketStats.pending}</div>
                  <div className="status-item">Solved: {ticketStats.solved}</div>
                  <div className="status-item">Closed: {ticketStats.closed}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
