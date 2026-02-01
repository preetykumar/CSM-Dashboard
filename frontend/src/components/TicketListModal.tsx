import { useEffect, useState } from "react";
import { fetchTicketsByStatus, fetchTicketsByPriority } from "../services/api";
import type { Ticket } from "../types";

type FilterType = "status" | "priority";

interface Props {
  orgId: number;
  orgName: string;
  filterType: FilterType;
  filterValue: string;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  hold: "On Hold",
  solved: "Solved",
  closed: "Closed",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low Priority",
  normal: "Normal Priority",
  high: "High Priority",
  urgent: "Urgent Priority",
};

export function TicketListModal({ orgId, orgName, filterType, filterValue, onClose }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTickets() {
      try {
        const data = filterType === "status"
          ? await fetchTicketsByStatus(orgId, filterValue)
          : await fetchTicketsByPriority(orgId, filterValue);
        setTickets(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    }

    loadTickets();
  }, [orgId, filterType, filterValue]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const filterLabel = filterType === "status"
    ? STATUS_LABELS[filterValue] || filterValue
    : PRIORITY_LABELS[filterValue] || filterValue;

  const headerClass = filterType === "status"
    ? `status-${filterValue}`
    : `priority-${filterValue}`;

  return (
    <div className="drilldown-overlay" onClick={handleOverlayClick}>
      <div className="ticket-modal">
        <div className={`ticket-modal-header ${headerClass}`}>
          <div>
            <h2>{orgName}</h2>
            <p className="status-filter">{filterLabel} Tickets ({tickets.length})</p>
          </div>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="ticket-modal-content">
          {loading && <div className="loading">Loading tickets...</div>}
          {error && <div className="error">{error}</div>}

          {!loading && !error && tickets.length === 0 && (
            <p className="no-tickets">No {filterLabel.toLowerCase()} tickets found.</p>
          )}

          {!loading && !error && tickets.length > 0 && (
            <ul className="ticket-list-full">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="ticket-item">
                  <div className="ticket-item-header">
                    <span className="ticket-id">#{ticket.id}</span>
                    <div className="ticket-badges">
                      <span className={`ticket-status ${ticket.status}`}>
                        {ticket.status}
                      </span>
                      <span className={`ticket-priority ${ticket.priority || "normal"}`}>
                        {ticket.priority || "normal"}
                      </span>
                    </div>
                  </div>
                  <div className="ticket-subject-full">
                    {ticket.subject || "No subject"}
                  </div>
                  <div className="ticket-meta">
                    <span className="ticket-date">
                      Updated: {new Date(ticket.updated_at).toLocaleDateString()}
                    </span>
                    {ticket.tags && ticket.tags.length > 0 && (
                      <span className="ticket-tags">
                        {ticket.tags.slice(0, 3).join(", ")}
                        {ticket.tags.length > 3 && ` +${ticket.tags.length - 3}`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
