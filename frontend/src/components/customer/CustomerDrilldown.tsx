// Per-customer 4-tab drill-down used by the unified Customer view.
// Tabs: Health, Support, Usage, Active Deployments.
//
// All four tabs lazy-load their data on activation (Support and Usage
// have their own fetch logic; Deployments fetches once per account).
// The summary line on the account header (rendered by the parent
// CustomerPage) already shows cheap counts from the portfolio API.

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  fetchEnterpriseSubscriptionsById,
  fetchAccountDeployments,
  type EnterpriseSubscription,
  type AccountDeploymentsResponse,
} from "../../services/api";
import { CustomerHealthCard } from "../CustomerHealthCard";
import { UnifiedUsageSection } from "../UnifiedUsageSection";
import { AccountSupportTickets } from "../account/AccountSupportTickets";
import { Badge, LoadingRow, EmptyState } from "../ui";

type TabId = "health" | "support" | "usage" | "deployments";

const TAB_LABELS: Record<TabId, string> = {
  health: "Health",
  support: "Support",
  usage: "Usage",
  deployments: "Active Deployments",
};

interface Props {
  accountId: string;
  accountName: string;
  // Zendesk org IDs for this account (passed in from parent to avoid
  // refetching the org list; null = backend couldn't find a linked org).
  zendeskOrgIds: number[] | null;
  // Current ARR from Account.ARR__c — passed in from the portfolio response so
  // we don't re-query SF. null/undefined = no ARR data; banner hides the pill.
  subscriptionArr?: number | null;
}

export function CustomerDrilldown({ accountId, accountName, zendeskOrgIds, subscriptionArr }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("health");
  const [subs, setSubs] = useState<EnterpriseSubscription[] | null>(null);
  const [subsLoading, setSubsLoading] = useState(true);

  // Subscriptions are needed by Health and Usage tabs — fetch once at the
  // panel level and share.
  useEffect(() => {
    let cancelled = false;
    setSubsLoading(true);
    fetchEnterpriseSubscriptionsById(accountId)
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
  }, [accountId]);

  // Derived Amplitude lookup keys — same pattern as CustomerUsageView /
  // Deployments CustomerDetailPanel.
  const enterpriseUuid = subs?.find((s) => s.enterpriseUuid)?.enterpriseUuid;
  const monitorDomain = subs?.find((s) => s.enterpriseDomain)?.enterpriseDomain?.split(".")[0];

  const arrLabel =
    subscriptionArr != null && subscriptionArr > 0 ? formatArrBanner(subscriptionArr) : null;

  return (
    <div className="customer-drilldown">
      <div className="customer-drilldown-banner">
        <span className="customer-drilldown-banner-name">{accountName}</span>
        {arrLabel && (
          <span
            className="customer-drilldown-banner-arr"
            title="Current ARR — Account.ARR__c in Salesforce"
          >
            ARR {arrLabel}
          </span>
        )}
      </div>

      <div className="customer-drilldown-tabs" role="tablist">
        {(Object.keys(TAB_LABELS) as TabId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`customer-drilldown-tab ${activeTab === id ? "active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="customer-drilldown-body" role="tabpanel">
        {activeTab === "health" && (
          subsLoading ? (
            <LoadingRow>Loading subscriptions…</LoadingRow>
          ) : (
            <CustomerHealthCard
              accountName={accountName}
              accountId={accountId}
              enterpriseUuid={enterpriseUuid}
              monitorDomain={monitorDomain}
              subscriptions={subs || []}
            />
          )
        )}

        {activeTab === "support" && (
          <AccountSupportTickets zendeskOrgIds={zendeskOrgIds} accountName={accountName} />
        )}

        {activeTab === "usage" && (
          subsLoading ? (
            <LoadingRow>Loading subscriptions…</LoadingRow>
          ) : (
            <UnifiedUsageSection
              enterpriseUuid={enterpriseUuid}
              accountName={accountName}
              salesforceAccountId={accountId}
              monitorDomain={monitorDomain}
              subscriptions={subs || []}
            />
          )
        )}

        {activeTab === "deployments" && (
          <DeploymentsTab accountId={accountId} />
        )}
      </div>
    </div>
  );
}

// ── Active Deployments tab ───────────────────────────────────────────────

function DeploymentsTab({ accountId }: { accountId: string }) {
  const [data, setData] = useState<AccountDeploymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAccountDeployments(accountId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load deployments");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loading) return <LoadingRow>Loading deployments…</LoadingRow>;
  if (error) return <EmptyState title="Couldn't load deployments" detail={error} />;
  if (!data || data.opps.length === 0) {
    return <EmptyState title="No active deployment opportunities" detail="No deploy-tagged opportunities found in Salesforce for this account." />;
  }

  return (
    <div className="customer-deployments">
      {data.opps.map((opp) => {
        const k = opp.kantata;
        return (
          <div key={opp.oppId} className="customer-deployment-opp">
            <div className="customer-deployment-opp-header">
              <span className="customer-deployment-opp-name">{opp.oppName}</span>
              {opp.closeDate && (
                <span className="customer-deployment-opp-date">
                  {new Date(opp.closeDate).toLocaleDateString()}
                </span>
              )}
              {k && k.status && (
                <Badge tone={k.overBudget ? "danger" : "info"}>{k.status}</Badge>
              )}
            </div>

            {/* Kantata workspace summary */}
            {k ? (
              <div className="customer-deployment-kantata">
                <span className="label">Kantata:</span>
                <span className="value">
                  {fmtMoney(k.budgetUsed)} / {fmtMoney(k.budget)}
                </span>
                {k.effectiveDueDate && (
                  <span className="muted">
                    · due {new Date(k.effectiveDueDate).toLocaleDateString()}
                  </span>
                )}
                {k.url && (
                  <a
                    href={k.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="customer-deployment-kantata-link"
                    title="Open in Kantata"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ) : (
              <div className="customer-deployment-kantata muted">
                <em>No Kantata workspace linked</em>
              </div>
            )}

            {/* SF line items grouped under this opp */}
            <table className="customer-deployment-line-items">
              <thead>
                <tr>
                  <th>Product Code</th>
                  <th>Product Name</th>
                  <th>Family</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {opp.lineItems.map((li, idx) => (
                  <tr key={idx}>
                    <td className="mono">{li.productCode}</td>
                    <td>{li.productName || "—"}</td>
                    <td className="muted">{li.family || "—"}</td>
                    <td style={{ textAlign: "right" }}>{li.quantity}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(li.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Compact ARR for the drilldown banner: $1.2M / $850k / $42.
function formatArrBanner(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
