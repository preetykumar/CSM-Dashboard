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
  type DeploymentCustomerNode,
  type DeploymentOppNode,
  type EnterpriseSubscription,
} from "../../services/api";
import { CustomerHealthCard } from "../CustomerHealthCard";
import { UnifiedUsageSection } from "../UnifiedUsageSection";
import { AccountSupportTickets } from "../account/AccountSupportTickets";
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

  // Derive Amplitude lookup keys the same way CustomerUsageView does — pull
  // from the subscriptions response, not from the deployment-tree's
  // precomputed value, because the precomputed value misses cases where the
  // ZD/SF account has subscriptions but UUID is on a non-first one. Monitor
  // also needs the domain prefix derived from Enterprise_Domain__c.
  const enterpriseUuid =
    subs?.find((s) => s.enterpriseUuid)?.enterpriseUuid ||
    customer.enterpriseUuid ||
    undefined;
  const monitorDomain = subs?.find((s) => s.enterpriseDomain)?.enterpriseDomain?.split(".")[0];

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
              enterpriseUuid={enterpriseUuid}
              monitorDomain={monitorDomain}
              subscriptions={subs || []}
            />
          )
        )}

        {activeTab === "support" && (
          <AccountSupportTickets
            zendeskOrgIds={customer.zendeskOrgIds}
            accountName={customer.accountName}
          />
        )}

        {activeTab === "usage" && (
          subsLoading ? (
            <LoadingRow>Loading subscriptions…</LoadingRow>
          ) : (
            <UnifiedUsageSection
              enterpriseUuid={enterpriseUuid}
              accountName={customer.accountName}
              salesforceAccountId={customer.accountId}
              monitorDomain={monitorDomain}
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
