// Customer card — Support + Usage stacked sections (no tabs).
//
// Why no tabs anymore: with only two surfaces left (Support, Usage), tabs are
// overkill — just stack them. Renewals and Deployments moved out to their own
// pipeline views; status is surfaced here via clickable header pills that
// deep-link to the relevant pipeline filtered to this account.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Activity,
  Users,
  Calendar,
  Rocket,
  AlertOctagon,
} from "lucide-react";
import {
  type MockPortfolioAccount,
  getRenewalState,
  getLastRelevantClosedWon,
} from "../../data/portfolioMocks";
import { EmptyState } from "./EmptyState";
import { HealthDrilldown } from "./HealthDrilldown";
import { AccountSupportTickets } from "../account/AccountSupportTickets";
import { AccountUsagePanel } from "../account/AccountUsagePanel";

interface Props {
  account: MockPortfolioAccount;
  depth?: number;
}

export function CustomerCard({ account, depth = 0 }: Props) {
  const renewalState = getRenewalState(account);
  const lastWon = getLastRelevantClosedWon(account);
  const isChurned = renewalState === "churned";

  const [expanded, setExpanded] = useState(depth === 0);
  const [healthOpen, setHealthOpen] = useState(false);
  const navigate = useNavigate();

  const hasChildren = (account.children?.length || 0) > 0;
  const childCount = account.children?.length || 0;
  const isChild = depth > 0;

  const deploymentCount = account.joined.kantataProjects?.length ?? 0;
  const showDeploymentPill = deploymentCount > 0;

  const goToRenewalsPipeline = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/renewals/upcoming?accountId=${encodeURIComponent(account.id)}`);
  };
  const goToDeploymentsPipeline = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/deployments?accountId=${encodeURIComponent(account.id)}`);
  };

  return (
    <div
      className={`portfolio-card ${isChild ? "portfolio-card-child" : ""} ${isChurned ? "portfolio-card-churned" : ""}`}
      style={{ marginLeft: depth * 24 }}
    >
      {/* Header row is a div + onClick (not <button>) so nested pill/chip
          buttons inside don't violate the no-button-inside-button rule. */}
      <div
        role="button"
        tabIndex={0}
        className="portfolio-card-header"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="portfolio-card-name">{account.name}</span>

        {isChurned && (
          <button
            type="button"
            className="portfolio-churned-badge"
            title={lastWon ? `Click to see revival workflow · last renewal ${lastWon.closedDate} (${lastWon.productFamily})` : "Churned"}
            onClick={goToRenewalsPipeline}
          >
            <AlertOctagon size={12} aria-hidden /> CHURNED
          </button>
        )}

        {hasChildren && (
          <span className="portfolio-card-count">
            +{childCount} {childCount === 1 ? "child" : "children"}
          </span>
        )}

        <div className="portfolio-card-summary">
          {/* Health chip group — clickable, opens drilldown modal */}
          {account.joined.healthScore && (
            <button
              type="button"
              className="portfolio-health-chips"
              onClick={(e) => {
                e.stopPropagation();
                setHealthOpen(true);
              }}
              aria-label="View health details"
              title="Click for full health breakdown"
            >
              {(["adoption", "engagement", "support"] as const).map((dim) => {
                const status = account.joined.healthScore![dim].status;
                if (!status) return <span key={dim} className="health-chip health-chip-unknown" title={`${dim}: no data`}>—</span>;
                return (
                  <span key={dim} className={`health-chip health-chip-${status}`} title={`${dim}: ${status}`}>
                    {dim[0].toUpperCase()}
                  </span>
                );
              })}
            </button>
          )}

          {/* Renewals pill — clickable deep-link to Renewals Pipeline */}
          {renewalState === "active" && account.upcomingRenewalDate && (
            <button
              type="button"
              className="portfolio-pill portfolio-pill-renewal"
              onClick={goToRenewalsPipeline}
              title={`${account.renewalStage || ""} · Click to open in Renewals Pipeline`}
            >
              <Calendar size={11} aria-hidden /> Renews {account.upcomingRenewalDate}
            </button>
          )}
          {renewalState === "churned" && lastWon && (
            <button
              type="button"
              className="portfolio-pill portfolio-pill-churned"
              onClick={goToRenewalsPipeline}
              title={`${lastWon.productFamily} · $${lastWon.amount.toLocaleString()} · Click to open in Renewals Pipeline`}
            >
              <Calendar size={11} aria-hidden /> Last renewed {lastWon.closedDate}
            </button>
          )}

          {/* Deployments pill — clickable deep-link to Deployments Pipeline */}
          {showDeploymentPill && (
            <button
              type="button"
              className="portfolio-pill portfolio-pill-deployment"
              onClick={goToDeploymentsPipeline}
              title={`${account.joined.kantataProjects!.map((p) => p.category).join(", ")} · Click to open in Deployments Pipeline`}
            >
              <Rocket size={11} aria-hidden /> {deploymentCount} {deploymentCount === 1 ? "deploy" : "deploys"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <>
          <div className="portfolio-card-body">
            <SupportSection account={account} />
            <UsageSection account={account} />
          </div>

          {hasChildren && (
            <div className="portfolio-children">
              {account.children!.map((child) => (
                <CustomerCard key={child.id} account={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </>
      )}

      {healthOpen && account.joined.healthScore && (
        <HealthDrilldown
          accountName={account.name}
          health={account.joined.healthScore}
          onClose={() => setHealthOpen(false)}
        />
      )}
    </div>
  );
}

function SupportSection({ account }: { account: MockPortfolioAccount }) {
  const j = account.joined;
  const summary =
    j.zendeskOrgIds === null
      ? null
      : `${j.zendeskOpenTickets} open · ${j.zendeskOpen90d} in last 90 days`;

  return (
    <section className="portfolio-section">
      <header className="portfolio-section-header">
        <Activity size={14} aria-hidden />
        <span className="portfolio-section-title">Support</span>
        {summary && <span className="portfolio-section-summary">{summary}</span>}
      </header>
      <div className="portfolio-section-body">
        {/* No-link state already handled inside AccountSupportTickets, but
            for the cheap case where the backend already told us there's no
            recent activity we render a lighter EmptyState here to avoid an
            unnecessary fetch. */}
        {j.zendeskOrgIds !== null && j.zendeskOrgIds.length > 0 && j.zendeskOpen90d === 0 ? (
          <EmptyState reason="no-records" dataType="support tickets" />
        ) : (
          <AccountSupportTickets
            zendeskOrgIds={j.zendeskOrgIds}
            accountName={account.name}
          />
        )}
      </div>
    </section>
  );
}

function UsageSection({ account }: { account: MockPortfolioAccount }) {
  const j = account.joined;
  const summary =
    j.amplitudeActiveUsers90d === null
      ? null
      : `${j.amplitudeActiveUsers90d} active users · ${j.amplitudeTotalUsersInSF} SF contacts/leads`;

  return (
    <section className="portfolio-section">
      <header className="portfolio-section-header">
        <Users size={14} aria-hidden />
        <span className="portfolio-section-title">Usage</span>
        {summary && <span className="portfolio-section-summary">{summary}</span>}
      </header>
      <div className="portfolio-section-body">
        {j.amplitudeActiveUsers90d === null ? (
          // No Amplitude tracking at all for this account — skip the fetch.
          <EmptyState
            reason="no-tracking"
            dataType="Usage"
            hint="No Amplitude tracking is set up for this account yet."
          />
        ) : (
          <AccountUsagePanel accountId={account.id} accountName={account.name} />
        )}
      </div>
    </section>
  );
}
