import { useEffect, useState } from "react";
import { fetchCSMPortfolios, fetchEnhancedCustomerSummary, fetchGitHubStatusForTickets } from "../services/api";
import { VelocityBanner } from "./VelocityBanner";
import { ProductBacklogCard } from "./ProductBacklogCard";
import { QuarterlySummaryCard } from "./QuarterlySummaryCard";
import type { CSMPortfolio, CSMCustomerSummary, Ticket, EnhancedCustomerSummary, GitHubDevelopmentStatus } from "../types";

export function CSMPortfolioView() {
  const [portfolios, setPortfolios] = useState<CSMPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCSM, setExpandedCSM] = useState<number | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function loadPortfolios() {
      try {
        const data = await fetchCSMPortfolios();
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
    return <div className="loading">Loading CSM portfolios...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (portfolios.length === 0) {
    return (
      <div className="no-data-message">
        Fetching the latest data for CSM portfolios...
      </div>
    );
  }

  return (
    <div className="csm-portfolio-view">
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {portfolios.length} CSM portfolios</span>
        </div>
      )}
      <div className="csm-list">
        {portfolios.map((portfolio) => (
          <CSMCard
            key={portfolio.csm.id}
            portfolio={portfolio}
            expanded={expandedCSM === portfolio.csm.id}
            onToggle={() =>
              setExpandedCSM(expandedCSM === portfolio.csm.id ? null : portfolio.csm.id)
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

interface CSMCardProps {
  portfolio: CSMPortfolio;
  expanded: boolean;
  onToggle: () => void;
  expandedCustomer: string | null;
  onCustomerToggle: (key: string) => void;
}

function CSMCard({
  portfolio,
  expanded,
  onToggle,
  expandedCustomer,
  onCustomerToggle,
}: CSMCardProps) {
  const { csm, customers, totalTickets, openTickets, totalCustomers } = portfolio;

  return (
    <div className={`csm-card ${expanded ? "expanded" : ""}`}>
      <div className="csm-header" onClick={onToggle}>
        <div className="csm-info">
          <h3>{csm.name}</h3>
          <span className="csm-email">{csm.email}</span>
        </div>
        <div className="csm-stats">
          <div className="csm-stat">
            <span className="value">{totalCustomers}</span>
            <span className="label">Customers</span>
          </div>
          <div className="csm-stat">
            <span className="value">{totalTickets}</span>
            <span className="label">Tickets</span>
          </div>
          <div className="csm-stat open">
            <span className="value">{openTickets}</span>
            <span className="label">Open</span>
          </div>
        </div>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="csm-customers">
          {customers.length === 0 ? (
            <p className="no-customers">No customer tickets found</p>
          ) : (
            customers.map((customer) => {
              const key = `${csm.id}-${customer.organization.id}`;
              return (
                <CustomerCard
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

interface CustomerCardProps {
  customer: CSMCustomerSummary;
  expanded: boolean;
  onToggle: () => void;
}

function CustomerCard({ customer, expanded, onToggle }: CustomerCardProps) {
  const { organization, ticketStats, priorityBreakdown, featureRequests, problemReports, escalations, tickets } = customer;
  const [enhancedSummary, setEnhancedSummary] = useState<EnhancedCustomerSummary | null>(null);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);
  const [githubStatusMap, setGitHubStatusMap] = useState<Map<number, GitHubDevelopmentStatus[]> | null>(null);
  const [drilldownTickets, setDrilldownTickets] = useState<{
    title: string;
    tickets: Ticket[];
    grouped?: boolean;
  } | null>(null);

  // Fetch enhanced summary when expanded
  useEffect(() => {
    if (expanded && !enhancedSummary && !loadingEnhanced) {
      setLoadingEnhanced(true);
      fetchEnhancedCustomerSummary(organization.id)
        .then(setEnhancedSummary)
        .catch((err) => console.error("Failed to load enhanced summary:", err))
        .finally(() => setLoadingEnhanced(false));
    }
  }, [expanded, enhancedSummary, loadingEnhanced, organization.id]);

  // Fetch GitHub statuses when enhanced summary is loaded
  useEffect(() => {
    if (enhancedSummary && !githubStatusMap) {
      // Get all ticket IDs from the backlog
      const ticketIds = enhancedSummary.backlog
        .flatMap((p) => p.modules)
        .flatMap((m) => m.tickets)
        .map((t) => t.id);

      if (ticketIds.length > 0) {
        fetchGitHubStatusForTickets(ticketIds)
          .then(setGitHubStatusMap)
          .catch((err) => console.error("Failed to load GitHub statuses:", err));
      }
    }
  }, [enhancedSummary, githubStatusMap]);

  const handleModuleClick = (productName: string, moduleName: string, moduleTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName}`, tickets: moduleTickets });
  };

  const handleModuleFeaturesClick = (productName: string, moduleName: string, featureTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName} - Features`, tickets: featureTickets });
  };

  const handleModuleBugsClick = (productName: string, moduleName: string, bugTickets: Ticket[]) => {
    setDrilldownTickets({ title: `${productName} - ${moduleName} - Bugs`, tickets: bugTickets });
  };

  const handlePriorityClick = (priority: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filteredTickets = tickets.filter((t) => (t.priority || "normal") === priority);
    const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
    setDrilldownTickets({ title: `${priorityLabel} Priority Tickets`, tickets: filteredTickets });
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

  const handleClosedTicketsClick = () => {
    const closedTickets = tickets.filter(
      (t) => t.status === "solved" || t.status === "closed"
    );
    setDrilldownTickets({ title: "All Closed Tickets This Month", tickets: closedTickets });
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

  return (
    <div className={`customer-card ${expanded ? "expanded" : ""}`}>
      <div className="customer-header" onClick={onToggle}>
        <div className="customer-info">
          <h4>{organization.salesforce_account_name || organization.name}</h4>
          {organization.salesforce_account_name && organization.salesforce_account_name !== organization.name && (
            <span className="zendesk-org-name">Zendesk: {organization.name}</span>
          )}
          <span className="ticket-count">{ticketStats.total} tickets</span>
        </div>
        <div className="customer-stats-mini">
          <div className="priority-breakdown">
            {priorityBreakdown.urgent > 0 && (
              <span className="priority-badge urgent clickable" onClick={(e) => handlePriorityClick("urgent", e)}>
                {priorityBreakdown.urgent} urgent
              </span>
            )}
            {priorityBreakdown.high > 0 && (
              <span className="priority-badge high clickable" onClick={(e) => handlePriorityClick("high", e)}>
                {priorityBreakdown.high} high
              </span>
            )}
            {priorityBreakdown.normal > 0 && (
              <span className="priority-badge normal clickable" onClick={(e) => handlePriorityClick("normal", e)}>
                {priorityBreakdown.normal} normal
              </span>
            )}
            {priorityBreakdown.low > 0 && (
              <span className="priority-badge low clickable" onClick={(e) => handlePriorityClick("low", e)}>
                {priorityBreakdown.low} low
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
          {loadingEnhanced ? (
            <div className="loading-enhanced">Loading detailed summary...</div>
          ) : enhancedSummary ? (
            <>
              <VelocityBanner
                velocity={enhancedSummary.velocity}
                onBugsFixedClick={handleBugsFixedClick}
                onFeaturesCompletedClick={handleFeaturesCompletedClick}
                onClosedClick={handleClosedTicketsClick}
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
              <GroupedTicketView tickets={drilldownTickets.tickets} />
            ) : (
              <div className="ticket-table-container">
                <table className="ticket-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Subject</th>
                      <th>Type</th>
                      <th>Subtype</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Workflow</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownTickets.tickets.map((ticket) => (
                      <TicketDetailRow key={ticket.id} ticket={ticket} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TicketDetailRow({ ticket }: { ticket: Ticket }) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const openInZendesk = () => {
    if (ticket.url) {
      window.open(ticket.url, "_blank");
    } else {
      window.open(`https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`, "_blank");
    }
  };

  return (
    <tr className={`ticket-detail-row ${ticket.is_escalated ? "escalated" : ""}`} onClick={openInZendesk}>
      <td className="ticket-id">
        <a href={ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
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
      <td className="ticket-workflow">{ticket.workflow_status || "-"}</td>
      <td className="ticket-updated">{formatDate(ticket.updated_at)}</td>
    </tr>
  );
}

interface ProductGroup {
  productName: string;
  isPrimary: boolean;
  types: {
    typeName: string;
    tickets: Ticket[];
  }[];
}

function GroupedTicketView({ tickets }: { tickets: Ticket[] }) {
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  // Group tickets by product, then by issue type
  // Primary product (customer's main product) is shown first, others under "Other Products"
  const groupedData: ProductGroup[] = (() => {
    const productMap = new Map<string, Map<string, Ticket[]>>();

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

    // Find primary product (the one with the most tickets)
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

    // Build result: primary product first, then others
    const result: ProductGroup[] = [];
    const typeOrder = ["Bug", "Feature", "Other"];

    // Helper to build types array for a product
    const buildTypes = (typeMap: Map<string, Ticket[]>) => {
      const types: { typeName: string; tickets: Ticket[] }[] = [];
      for (const typeName of typeOrder) {
        if (typeMap.has(typeName)) {
          types.push({ typeName, tickets: typeMap.get(typeName)! });
        }
      }
      return types;
    };

    // Add primary product first
    if (primaryProduct && productMap.has(primaryProduct)) {
      result.push({
        productName: primaryProduct,
        isPrimary: true,
        types: buildTypes(productMap.get(primaryProduct)!),
      });
    }

    // Add other products sorted alphabetically
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="grouped-ticket-view">
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
                          {type.tickets.map((ticket) => (
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
                              <span className="ticket-subtype">{ticket.issue_subtype || ticket.module || "-"}</span>
                              <span className="ticket-subject">{ticket.subject || "No subject"}</span>
                              <span className={`ticket-priority priority-${ticket.priority || "normal"}`}>
                                {ticket.priority || "normal"}
                              </span>
                              <span className="ticket-updated">{formatDate(ticket.updated_at)}</span>
                            </div>
                          ))}
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
