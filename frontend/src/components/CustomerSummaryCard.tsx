import { CustomerHealthCard } from "./CustomerHealthCard";
import type { CustomerSummary } from "../types";

interface Props {
  summary: CustomerSummary;
  subtitle?: string;
  onClick?: () => void;
  onStatusClick?: (status: string) => void;
  onPriorityClick?: (priority: string) => void;
  isEscalatedView?: boolean;
  isCriticalView?: boolean;
}

type StatusKey = "new" | "open" | "pending" | "hold" | "solved" | "closed";
type PriorityKey = "low" | "normal" | "high" | "urgent";

export function CustomerSummaryCard({ summary, subtitle, onClick, onStatusClick, onPriorityClick, isEscalatedView, isCriticalView }: Props) {
  const { organization, ticketStats, priorityBreakdown, recentTickets, escalatedTickets, criticalTickets } = summary;

  const handleStatusClick = (e: React.MouseEvent | React.KeyboardEvent, status: StatusKey) => {
    e.stopPropagation();
    const count = ticketStats[status];
    if (count > 0 && onStatusClick) {
      onStatusClick(status);
    }
  };

  const handlePriorityClick = (e: React.MouseEvent | React.KeyboardEvent, priority: PriorityKey) => {
    e.stopPropagation();
    const count = priorityBreakdown[priority];
    if (count > 0 && onPriorityClick) {
      onPriorityClick(priority);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, callback?: () => void) => {
    if ((e.key === "Enter" || e.key === " ") && callback) {
      e.preventDefault();
      e.stopPropagation();
      callback();
    }
  };

  // Only show active ticket statuses (not solved/closed - those are in QBR quarterly views)
  const statuses: { key: StatusKey; label: string }[] = [
    { key: "new", label: "New" },
    { key: "open", label: "Open" },
    { key: "pending", label: "Pending" },
    { key: "hold", label: "Hold" },
  ];

  const priorities: { key: PriorityKey; label: string }[] = [
    { key: "urgent", label: "Urgent" },
    { key: "high", label: "High" },
    { key: "normal", label: "Normal" },
    { key: "low", label: "Low" },
  ];

  // Escalated view shows only escalation tickets with links (card not clickable)
  if (isEscalatedView) {
    return (
      <div className="summary-card escalated-view">
        <div className="summary-card-header">
          <h2>{organization.name}{subtitle && <span className="account-subtitle"> ({subtitle})</span>}</h2>
          <span className="escalation-count">{summary.escalations} escalation{summary.escalations !== 1 ? "s" : ""}</span>
        </div>

        <div className="summary-card-body">
          {escalatedTickets && escalatedTickets.length > 0 ? (
            <ul className="special-tickets-list">
              {escalatedTickets.map((ticket) => {
                const ticketUrl = ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`;
                return (
                  <li key={ticket.id} className="special-ticket-item">
                    <a
                      href={ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ticket-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{ticket.id}
                    </a>
                    <span className={`ticket-status ${ticket.status}`}>{ticket.status}</span>
                    <span className="ticket-subject">{ticket.subject || "No subject"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="no-tickets-message">No active escalations</p>
          )}
        </div>
      </div>
    );
  }

  // Critical defects view shows only critical tickets (urgent + high priority)
  if (isCriticalView) {
    return (
      <div className="summary-card critical-view">
        <div className="summary-card-header">
          <h2>{organization.name}{subtitle && <span className="account-subtitle"> ({subtitle})</span>}</h2>
          <span className="critical-count">{summary.criticalDefects} critical defect{summary.criticalDefects !== 1 ? "s" : ""}</span>
        </div>

        <div className="summary-card-body">
          {criticalTickets && criticalTickets.length > 0 ? (
            <ul className="special-tickets-list">
              {criticalTickets.map((ticket) => {
                const ticketUrl = ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`;
                return (
                  <li key={ticket.id} className="special-ticket-item">
                    <a
                      href={ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ticket-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{ticket.id}
                    </a>
                    <span className={`ticket-status ${ticket.status}`}>{ticket.status}</span>
                    <span className="ticket-subject">{ticket.subject || "No subject"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="no-tickets-message">No critical defects</p>
          )}
        </div>
      </div>
    );
  }

  // Normal view with full breakdown
  return (
    <div
      className={`summary-card ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => handleKeyDown(e, onClick) : undefined}
    >
      <div className="summary-card-header">
        <h2>{organization.name}{subtitle && <span className="account-subtitle"> ({subtitle})</span>}</h2>
        <div className="summary-card-header-right">
          <CustomerHealthCard accountName={organization.salesforce_account_name || organization.name} accountId={organization.salesforce_account_id} compact />
          <div className="total-tickets">{ticketStats.total} total tickets</div>
        </div>
        {(organization.csm_name || organization.owner_name) && (
          <div className="summary-card-assignments">
            {organization.csm_name && <span className="assignment-badge csm-badge">CSM: {organization.csm_name}</span>}
            {organization.owner_name && <span className="assignment-badge ae-badge">AE: {organization.owner_name}</span>}
          </div>
        )}
      </div>

      <div className="summary-card-body">
        <div className="stats-row">
          {statuses.map(({ key, label }) => {
            const count = ticketStats[key];
            const isClickable = count > 0 && onStatusClick;
            return (
              <div
                key={key}
                className={`stat ${key} ${isClickable ? "clickable-stat" : ""}`}
                onClick={(e) => handleStatusClick(e, key)}
                onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStatusClick(e, key); } } : undefined}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                title={isClickable ? `View ${count} ${label.toLowerCase()} tickets` : undefined}
              >
                <div className="stat-value">{count}</div>
                <div className="stat-label">{label}</div>
              </div>
            );
          })}
        </div>

        <div className="priority-section">
          <h3>Priority Breakdown</h3>
          <div className="priority-bars">
            {priorities.map(({ key, label }) => {
              const count = priorityBreakdown[key];
              const isClickable = count > 0 && onPriorityClick;
              return (
                <div
                  key={key}
                  className={`priority-bar ${key} ${isClickable ? "clickable-priority" : ""}`}
                  onClick={(e) => handlePriorityClick(e, key)}
                  onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePriorityClick(e, key); } } : undefined}
                  role={isClickable ? "button" : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  title={isClickable ? `View ${count} ${label.toLowerCase()} priority tickets` : undefined}
                >
                  <div className="bar" style={{ opacity: count > 0 ? 1 : 0.3 }}></div>
                  <div className="count">{count}</div>
                  <div className="label">{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {recentTickets.length > 0 && (
          <div className="recent-section">
            <h3>Recent Tickets</h3>
            <ul className="recent-tickets">
              {recentTickets.slice(0, 5).map((ticket) => {
                const ticketUrl = ticket.url || `https://dequehelp.zendesk.com/agent/tickets/${ticket.id}`;
                return (
                  <li key={ticket.id}>
                    <a
                      href={ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ticket-id"
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{ticket.id}
                    </a>
                    {ticket.subject || "No subject"}
                    <span className={`ticket-status ${ticket.status}`}>{ticket.status}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
