// Reusable per-account support ticket list. Used by both the Deployments
// detail panel and the Home portfolio CustomerCard.
//
// Fetches open/pending/hold tickets across every Zendesk org linked to a
// single SF account, dedupes, sorts by most recently updated, caps at 20.

import { useEffect, useState } from "react";
import { fetchTicketsByStatus } from "../../services/api";
import type { Ticket } from "../../types";
import { Badge, LoadingRow, EmptyState } from "../ui";

interface Props {
  // Zendesk org IDs linked to this SF account. Pass null when the account
  // hasn't been resolved to any Zendesk org — renders a "no link" state.
  zendeskOrgIds: number[] | null;
  // Used in the empty-state messages only.
  accountName: string;
  // Optional: caps the visible list. Default 20.
  limit?: number;
}

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  new: "info",
  open: "warning",
  pending: "warning",
  hold: "neutral",
  solved: "success",
  closed: "success",
};

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

export function AccountSupportTickets({ zendeskOrgIds, accountName, limit = 20 }: Props) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (zendeskOrgIds === null) {
      setTickets(null);
      setLoading(false);
      return;
    }
    if (zendeskOrgIds.length === 0) {
      setTickets([]);
      setLoading(false);
      return;
    }
    Promise.all(
      zendeskOrgIds.flatMap((orgId) => [
        fetchTicketsByStatus(orgId, "open").catch(() => [] as Ticket[]),
        fetchTicketsByStatus(orgId, "pending").catch(() => [] as Ticket[]),
        fetchTicketsByStatus(orgId, "hold").catch(() => [] as Ticket[]),
      ])
    )
      .then((groups) => {
        if (cancelled) return;
        const merged = groups.flat();
        merged.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
        setTickets(merged.slice(0, limit));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load tickets");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zendeskOrgIds, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (zendeskOrgIds === null) {
    return (
      <EmptyState
        title="No Zendesk org linked"
        detail={`We couldn't find a Zendesk organization linked to ${accountName}. Ask the Zendesk admin to set the SF Account ID on the matching org.`}
      />
    );
  }
  if (loading) return <LoadingRow>Loading tickets…</LoadingRow>;
  if (error) return <EmptyState title="Couldn't load tickets" detail={error} />;
  if (!tickets || tickets.length === 0) {
    return <EmptyState title="No open tickets" detail="No open, pending, or on-hold tickets for this account right now." />;
  }

  return (
    <div className="account-support">
      <div className="account-support-count">
        Showing {tickets.length} open / pending / hold ticket{tickets.length === 1 ? "" : "s"}
        {zendeskOrgIds.length > 1 ? ` across ${zendeskOrgIds.length} Zendesk orgs` : ""}.
      </div>
      <table className="account-support-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const ticketUrl = `https://dequehelp.zendesk.com/agent/tickets/${t.id}`;
            return (
              <tr key={t.id}>
                <td>
                  <a
                    href={ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="account-support-link"
                    title={`Open Zendesk ticket #${t.id} in a new tab`}
                  >
                    {t.subject || `(no subject) #${t.id}`}
                  </a>
                </td>
                <td><Badge tone={STATUS_TONE[t.status] || "neutral"}>{t.status}</Badge></td>
                <td>{t.priority ? <Badge tone={PRIORITY_TONE[t.priority] || "neutral"}>{t.priority}</Badge> : "—"}</td>
                <td className="account-support-date">
                  {t.updated_at ? new Date(t.updated_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
