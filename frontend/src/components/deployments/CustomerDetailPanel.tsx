// Per-customer detail panel that opens under a CustomerNode in the Deployments
// tree. Four tabs: Health, Support, Usage, Kantata.
//
// Lazy-fetches per tab:
//   - Subscriptions are needed by both Health and Usage, so fetched once at the
//     panel level and passed down.
//   - Each tab does its own loading state and never blocks the others.
//
// Why a separate panel (vs. inlining): keeps CustomerNode's body lean and lets
// us swap the layout (e.g., side-by-side instead of tabbed) without rewriting
// the tree.

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  fetchEnterpriseSubscriptionsById,
  fetchTicketsByStatus,
  type DeploymentCustomerNode,
  type DeploymentOppNode,
  type EnterpriseSubscription,
} from "../../services/api";
import type { Ticket } from "../../types";
import { CustomerHealthCard } from "../CustomerHealthCard";
import { UnifiedUsageSection } from "../UnifiedUsageSection";
import { Badge, LoadingRow, EmptyState } from "../ui";

type TabId = "health" | "support" | "usage" | "kantata";

interface Props {
  customer: DeploymentCustomerNode;
}

export function CustomerDetailPanel({ customer }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("health");
  const [subs, setSubs] = useState<EnterpriseSubscription[] | null>(null);
  const [subsLoading, setSubsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSubsLoading(true);
    fetchEnterpriseSubscriptionsById(customer.accountId)
      .then((res) => {
        if (cancelled) return;
        setSubs(res.subscriptions);
        setSubsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSubs([]);
        setSubsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.accountId]);

  return (
    <div className="deployments-detail-panel">
      <div className="deployments-detail-tabs" role="tablist">
        {(["health", "support", "usage", "kantata"] as TabId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`deployments-detail-tab ${activeTab === id ? "active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="deployments-detail-body" role="tabpanel">
        {activeTab === "health" && (
          subsLoading ? (
            <LoadingRow>Loading subscriptions…</LoadingRow>
          ) : (
            <CustomerHealthCard
              accountName={customer.accountName}
              accountId={customer.accountId}
              enterpriseUuid={customer.enterpriseUuid || undefined}
              subscriptions={subs || []}
            />
          )
        )}

        {activeTab === "support" && (
          <SupportTab zendeskOrgIds={customer.zendeskOrgIds} accountName={customer.accountName} />
        )}

        {activeTab === "usage" && (
          subsLoading ? (
            <LoadingRow>Loading subscriptions…</LoadingRow>
          ) : (
            <UnifiedUsageSection
              enterpriseUuid={customer.enterpriseUuid || undefined}
              accountName={customer.accountName}
              salesforceAccountId={customer.accountId}
              subscriptions={subs || []}
            />
          )
        )}

        {activeTab === "kantata" && <KantataTab opps={customer.opps} />}
      </div>
    </div>
  );
}

const TAB_LABELS: Record<TabId, string> = {
  health: "Health",
  support: "Support",
  usage: "Usage",
  kantata: "Kantata",
};

// ── Support tab ──────────────────────────────────────────────────────────

function SupportTab({ zendeskOrgIds, accountName }: { zendeskOrgIds: number[]; accountName: string }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (zendeskOrgIds.length === 0) {
      setTickets([]);
      setLoading(false);
      return;
    }
    // Fetch open + pending tickets across all ZD orgs for this customer.
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
        // Sort newest first by updated_at; cap at 20.
        merged.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
        setTickets(merged.slice(0, 20));
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
  }, [zendeskOrgIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (zendeskOrgIds.length === 0) {
    return (
      <EmptyState
        title="No Zendesk org linked"
        detail={`We couldn't find a Zendesk organization linked to ${accountName} via SF Account ID. Support data will appear once a ZD org is tagged with this SF account.`}
      />
    );
  }
  if (loading) return <LoadingRow>Loading tickets…</LoadingRow>;
  if (error) return <EmptyState title="Couldn't load tickets" detail={error} />;
  if (!tickets || tickets.length === 0) {
    return <EmptyState title="No open tickets" detail="No open, pending, or on-hold tickets for this customer right now." />;
  }

  return (
    <div className="deployments-support">
      <div className="deployments-support-count">
        Showing {tickets.length} open / pending / hold ticket{tickets.length === 1 ? "" : "s"}
        {zendeskOrgIds.length > 1 ? ` across ${zendeskOrgIds.length} Zendesk orgs` : ""}.
      </div>
      <table className="deployments-support-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Updated</th>
            <th><span className="visually-hidden">Link</span></th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>{t.subject}</td>
              <td><Badge tone={STATUS_TONE[t.status] || "neutral"}>{t.status}</Badge></td>
              <td>{t.priority ? <Badge tone={PRIORITY_TONE[t.priority] || "neutral"}>{t.priority}</Badge> : "—"}</td>
              <td className="deployments-support-date">{t.updated_at ? new Date(t.updated_at).toLocaleDateString() : "—"}</td>
              <td><span className="visually-hidden">No link available</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

// ── Kantata tab ──────────────────────────────────────────────────────────

function KantataTab({ opps }: { opps: DeploymentOppNode[] }) {
  const withKantata = opps.filter((o) => o.kantata);
  if (withKantata.length === 0) {
    return <EmptyState title="No Kantata workspace" detail="No active Kantata project is linked to this customer's deployment opps." />;
  }
  const totals = withKantata.reduce(
    (acc, o) => {
      const k = o.kantata!;
      acc.budget += k.budget || 0;
      acc.used += k.budgetUsed;
      return acc;
    },
    { budget: 0, used: 0 }
  );
  const remaining = totals.budget - totals.used;
  const pctUsed = totals.budget > 0 ? (totals.used / totals.budget) * 100 : 0;

  return (
    <div className="deployments-kantata-tab">
      <div className="deployments-kantata-summary">
        <div className="deployments-kantata-stat">
          <span className="label">Total budget</span>
          <span className="value">{fmtMoney(totals.budget)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">Used</span>
          <span className="value">{fmtMoney(totals.used)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">Remaining</span>
          <span className={`value ${remaining < 0 ? "negative" : ""}`}>{fmtMoney(remaining)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">% Used</span>
          <span className={`value ${pctUsed > 100 ? "negative" : ""}`}>{pctUsed.toFixed(0)}%</span>
        </div>
      </div>

      <table className="deployments-kantata-table">
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Status</th>
            <th>Budget</th>
            <th>Used</th>
            <th>Due date</th>
            <th><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {withKantata.map((o) => {
            const k = o.kantata!;
            return (
              <tr key={o.oppId}>
                <td>{o.oppName}</td>
                <td>
                  {k.status ? <Badge tone={k.overBudget ? "danger" : "info"}>{k.status}</Badge> : "—"}
                </td>
                <td>{fmtMoney(k.budget)}</td>
                <td>{fmtMoney(k.budgetUsed)}</td>
                <td>{k.effectiveDueDate ? new Date(k.effectiveDueDate).toLocaleDateString() : "—"}</td>
                <td>
                  {k.url ? (
                    <a href={k.url} target="_blank" rel="noopener noreferrer" aria-label="Open in Kantata">
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
