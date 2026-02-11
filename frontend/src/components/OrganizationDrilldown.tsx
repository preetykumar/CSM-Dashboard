import { useEffect, useState } from "react";
import { fetchDetailedCustomerSummary, fetchEnterpriseSubscriptionsByName, fetchGitHubStatusForTickets, EnterpriseSubscription } from "../services/api";
import { LicenseBanner } from "./LicenseBanner";
import type { DetailedCustomerSummary, ProductStats, Ticket, GitHubDevelopmentStatus } from "../types";

interface Props {
  orgId: number;
  orgName: string;
  onClose: () => void;
}

export function OrganizationDrilldown({ orgId, orgName, onClose }: Props) {
  const [summary, setSummary] = useState<DetailedCustomerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [ticketFilter, setTicketFilter] = useState<"all" | "feature" | "problem">("all");
  const [subscriptions, setSubscriptions] = useState<EnterpriseSubscription[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(true);
  const [githubStatusMap, setGitHubStatusMap] = useState<Map<number, GitHubDevelopmentStatus[]>>(new Map());

  useEffect(() => {
    async function loadDetails() {
      try {
        setLoading(true);
        const data = await fetchDetailedCustomerSummary(orgId);
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load details");
      } finally {
        setLoading(false);
      }
    }

    async function loadSubscriptions() {
      try {
        setLoadingSubscriptions(true);
        const data = await fetchEnterpriseSubscriptionsByName(orgName);
        setSubscriptions(data.subscriptions);
      } catch (err) {
        console.error("Failed to load subscriptions:", err);
      } finally {
        setLoadingSubscriptions(false);
      }
    }

    loadDetails();
    loadSubscriptions();
  }, [orgId, orgName]);

  // Fetch GitHub statuses when summary is loaded
  useEffect(() => {
    if (summary && githubStatusMap.size === 0) {
      const allTicketIds = summary.productBreakdown
        .flatMap((p) => p.tickets)
        .map((t) => t.id);

      if (allTicketIds.length > 0) {
        fetchGitHubStatusForTickets(allTicketIds)
          .then(setGitHubStatusMap)
          .catch((err) => console.error("Failed to load GitHub statuses:", err));
      }
    }
  }, [summary, githubStatusMap.size]);

  const filterTickets = (tickets: Ticket[], filter: typeof ticketFilter): Ticket[] => {
    if (filter === "all") return tickets;
    // Simple heuristic based on subject/tags
    return tickets.filter((t) => {
      const subject = (t.subject || "").toLowerCase();
      const tags = t.tags?.map((tag) => tag.toLowerCase()) || [];

      if (filter === "feature") {
        return (
          subject.includes("feature") ||
          subject.includes("enhancement") ||
          tags.some((tag) => tag.includes("feature") || tag.includes("enhancement"))
        );
      }
      if (filter === "problem") {
        return (
          subject.includes("bug") ||
          subject.includes("problem") ||
          subject.includes("error") ||
          subject.includes("issue") ||
          tags.some(
            (tag) =>
              tag.includes("bug") || tag.includes("problem") || tag.includes("issue")
          )
        );
      }
      return true;
    });
  };

  return (
    <div className="drilldown-overlay" onClick={onClose}>
      <div className="drilldown-modal" onClick={(e) => e.stopPropagation()}>
        <div className="drilldown-header">
          <h2>{orgName}</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {loading && <div className="loading">Loading detailed summary...</div>}
        {error && <div className="error">{error}</div>}

        {summary && (
          <div className="drilldown-content">
            {/* License Banner */}
            <LicenseBanner
              subscriptions={subscriptions}
              loading={loadingSubscriptions}
              accountName={!loadingSubscriptions && subscriptions.length === 0 ? orgName : undefined}
            />

            {/* Request Type Overview */}
            <section className="request-type-overview">
              <h3>Request Type Breakdown</h3>
              <div className="request-type-stats">
                <div
                  className={`request-stat feature ${ticketFilter === "feature" ? "active" : ""}`}
                  onClick={() => setTicketFilter(ticketFilter === "feature" ? "all" : "feature")}
                >
                  <div className="stat-value">{summary.requestTypeBreakdown.featureRequests}</div>
                  <div className="stat-label">Feature Requests</div>
                </div>
                <div
                  className={`request-stat problem ${ticketFilter === "problem" ? "active" : ""}`}
                  onClick={() => setTicketFilter(ticketFilter === "problem" ? "all" : "problem")}
                >
                  <div className="stat-value">{summary.requestTypeBreakdown.problemReports}</div>
                  <div className="stat-label">Problem Reports</div>
                </div>
                <div className="request-stat other">
                  <div className="stat-value">{summary.requestTypeBreakdown.other}</div>
                  <div className="stat-label">Other</div>
                </div>
              </div>
            </section>

            {/* Product Breakdown */}
            <section className="product-breakdown">
              <h3>By Product</h3>
              {summary.productBreakdown.length === 0 ? (
                <p className="no-data">No product data available</p>
              ) : (
                <div className="product-list">
                  {summary.productBreakdown.map((product) => (
                    <ProductCard
                      key={product.product}
                      product={product}
                      expanded={expandedProduct === product.product}
                      onToggle={() =>
                        setExpandedProduct(
                          expandedProduct === product.product ? null : product.product
                        )
                      }
                      ticketFilter={ticketFilter}
                      filterTickets={filterTickets}
                      githubStatusMap={githubStatusMap}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

interface ProductCardProps {
  product: ProductStats;
  expanded: boolean;
  onToggle: () => void;
  ticketFilter: "all" | "feature" | "problem";
  filterTickets: (tickets: Ticket[], filter: "all" | "feature" | "problem") => Ticket[];
  githubStatusMap: Map<number, GitHubDevelopmentStatus[]>;
}

function ProductCard({ product, expanded, onToggle, ticketFilter, filterTickets, githubStatusMap }: ProductCardProps) {
  const filteredTickets = filterTickets(product.tickets, ticketFilter);

  return (
    <div className={`product-card ${expanded ? "expanded" : ""}`}>
      <div className="product-header" onClick={onToggle}>
        <div className="product-info">
          <h4>{product.product}</h4>
          <span className="ticket-count">{product.total} tickets</span>
          {product.openTickets > 0 && (
            <span className="open-count">{product.openTickets} open</span>
          )}
        </div>
        <div className="product-stats-mini">
          <span className="feature-count" title="Feature Requests">
            {product.featureRequests} features
          </span>
          <span className="problem-count" title="Problem Reports">
            {product.problemReports} problems
          </span>
        </div>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="product-details">
          <div className="product-stats-full">
            <div className="stat-bar">
              <div
                className="bar-segment feature"
                style={{
                  width: `${(product.featureRequests / product.total) * 100}%`,
                }}
                title={`${product.featureRequests} Feature Requests`}
              />
              <div
                className="bar-segment problem"
                style={{
                  width: `${(product.problemReports / product.total) * 100}%`,
                }}
                title={`${product.problemReports} Problem Reports`}
              />
              <div
                className="bar-segment other"
                style={{
                  width: `${(product.other / product.total) * 100}%`,
                }}
                title={`${product.other} Other`}
              />
            </div>
            <div className="bar-legend">
              <span className="legend-item feature">Feature Requests ({product.featureRequests})</span>
              <span className="legend-item problem">Problem Reports ({product.problemReports})</span>
              <span className="legend-item other">Other ({product.other})</span>
            </div>
          </div>

          <div className="ticket-list">
            <h5>
              Tickets ({filteredTickets.length})
              {ticketFilter !== "all" && (
                <span className="filter-label">
                  {" "}
                  - Showing {ticketFilter === "feature" ? "Feature Requests" : "Problem Reports"}
                </span>
              )}
            </h5>
            {filteredTickets.length === 0 ? (
              <p className="no-tickets">No tickets match the current filter</p>
            ) : (
              <ul>
                {filteredTickets.slice(0, 10).map((ticket) => {
                  const githubStatuses = githubStatusMap.get(ticket.id);
                  return (
                    <li key={ticket.id}>
                      <a
                        href={ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ticket-id"
                      >
                        #{ticket.id}
                      </a>
                      <span className="ticket-subject">{ticket.subject || "No subject"}</span>
                      <span className={`ticket-status ${ticket.status}`}>{ticket.status}</span>
                      {githubStatuses && githubStatuses.length > 0 && (
                        <span className="github-links">
                          {githubStatuses.map((gh, idx) => (
                            <a
                              key={idx}
                              href={gh.githubUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`github-status-pill status-${gh.projectStatus?.toLowerCase().replace(/\s+/g, "-") || "unknown"}`}
                              title={`${gh.repoName}#${gh.issueNumber}`}
                            >
                              <span className="gh-icon">GH</span>
                              <span className="gh-status">{gh.projectStatus || "Linked"}</span>
                            </a>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
                {filteredTickets.length > 10 && (
                  <li className="more-tickets">
                    ... and {filteredTickets.length - 10} more tickets
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
