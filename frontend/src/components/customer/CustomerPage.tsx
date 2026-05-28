// Unified Customer page. Replaces the four legacy subviews
// (Support, Usage, Renewals, Health) — those subroutes now redirect here.
//
// Layout:
//   - Page header with role-scope selector (admin previews; non-admin
//     locked to their own role).
//   - Account list (one per SF account in the user's portfolio).
//   - Each account expands inline to reveal the CustomerDrilldown with
//     four tabs: Health / Support / Usage / Active Deployments.
//
// Role scoping is driven by fetchPortfolio(role, email), the same endpoint
// the Home page uses. Admin sees all; CSM/TSA/IE/PRS see their assigned
// accounts only.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Users, AlertTriangle } from "lucide-react";
import {
  countAccounts,
  MOCK_USERS,
  type MockPortfolioAccount,
  type Role,
} from "../../data/portfolioMocks";
import { fetchPortfolio } from "../../services/api";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Banner,
  SectionHeader,
  LoadingRow,
  EmptyState,
} from "../ui";
import { useStickyState } from "../../hooks/useStickyState";
import { CustomerDrilldown } from "./CustomerDrilldown";

const ROLE_LABELS: Record<Role, string> = {
  csm: "CSM",
  prs: "Renewal Specialist",
  tsa: "Technical Solution Architect",
  ie: "Implementation Engineer",
  admin: "Admin (all portfolios)",
};

const PREVIEWABLE_ROLES: Array<{ key: Role; label: string }> = [
  { key: "admin", label: "Admin (all)" },
  { key: "csm", label: "CSM" },
  { key: "prs", label: "Renewal Specialist" },
  { key: "tsa", label: "TSA" },
  { key: "ie", label: "Implementation Engineer" },
];

export function CustomerPage() {
  const [isAdmin, setIsAdmin] = useStickyState<boolean>("customer:isAdmin", true);
  const [adminRole, setAdminRole] = useStickyState<Role>("customer:adminRole", "admin");
  const [nonAdminRole, setNonAdminRole] = useStickyState<Role>("customer:nonAdminRole", "csm");
  const [expanded, setExpanded] = useStickyState<Record<string, boolean>>("customer:expanded", {});

  const role: Role = isAdmin ? adminRole : nonAdminRole;

  const [portfolio, setPortfolio] = useState<MockPortfolioAccount[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scope the effect to params that actually change the API call.
  const apiRole: Role = isAdmin ? "admin" : nonAdminRole;
  const apiEmail = isAdmin ? "" : MOCK_USERS[nonAdminRole];
  const fetchKey = `${apiRole}::${apiEmail}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPortfolio(apiRole, apiEmail)
      .then((resp) => {
        if (cancelled) return;
        setPortfolio(resp.accounts);
        setWarnings(resp.warnings || []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load customers");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountCount = useMemo(() => countAccounts(portfolio), [portfolio]);

  const toggle = (id: string) =>
    setExpanded({ ...expanded, [id]: !expanded[id] });

  const subtitle = (
    <span>
      <Users size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
      <strong>{accountCount}</strong> {accountCount === 1 ? "account" : "accounts"} ·{" "}
      {isAdmin ? `previewing ${ROLE_LABELS[adminRole]}` : ROLE_LABELS[role]}
    </span>
  );

  const headerActions = (
    <>
      <label className="customer-admin-toggle">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
        <span>I am admin <Badge tone="neutral">role preview</Badge></span>
      </label>

      <div className="customer-role-switcher">
        <label htmlFor="customer-role-select">{isAdmin ? "Preview as" : "Logged in as"}</label>
        <select
          id="customer-role-select"
          value={isAdmin ? adminRole : nonAdminRole}
          onChange={(e) =>
            isAdmin ? setAdminRole(e.target.value as Role) : setNonAdminRole(e.target.value as Role)
          }
          className="customer-select"
        >
          {(isAdmin ? PREVIEWABLE_ROLES : PREVIEWABLE_ROLES.filter((r) => r.key !== "admin")).map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Customers"
        title="My Customers"
        subtitle={subtitle}
        actions={headerActions}
      />

      {warnings.length > 0 && (
        <Banner tone="warning" icon={<AlertTriangle size={16} />}>
          <ul className="home-warning-list">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Banner>
      )}

      <section>
        <SectionHeader
          title="Accounts"
          count={loading ? undefined : `${accountCount} ${accountCount === 1 ? "account" : "accounts"}`}
        />

        {loading ? (
          <Card><LoadingRow>Loading customers…</LoadingRow></Card>
        ) : error ? (
          <Card><EmptyState title="Couldn't load customers" detail={error} /></Card>
        ) : portfolio.length === 0 ? (
          <Card>
            <EmptyState
              title="No accounts in scope"
              detail={
                isAdmin
                  ? "No accounts found in Salesforce."
                  : `No accounts are assigned to ${MOCK_USERS[nonAdminRole]} as a ${ROLE_LABELS[nonAdminRole]}.`
              }
            />
          </Card>
        ) : (
          portfolio.map((account) => (
            <CustomerAccountCard
              key={account.id}
              account={account}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
      </section>
    </Page>
  );
}

// ── Account card (recursive — handles parent/child nesting) ───────────────

function CustomerAccountCard({
  account,
  depth,
  expanded,
  onToggle,
}: {
  account: MockPortfolioAccount;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const isOpen = !!expanded[account.id];
  const isChild = depth > 0;
  const children = account.children || [];
  const j = account.joined;

  // Cheap summary numbers from the already-fetched portfolio payload.
  const supportSummary =
    j.zendeskOrgIds === null
      ? null
      : `${j.zendeskOpenTickets} open · ${j.zendeskOpen90d} last 90d`;
  const usageSummary =
    j.amplitudeActiveUsers90d === null
      ? null
      : `${j.amplitudeActiveUsers90d} active users`;

  return (
    <div
      className={`customer-account-wrapper${isChild ? " is-child" : ""}`}
      style={{ marginLeft: depth * 24 }}
    >
      <Card className="customer-account-card">
        <button
          type="button"
          className="customer-account-header"
          onClick={() => onToggle(account.id)}
          aria-expanded={isOpen}
        >
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="customer-account-name">{account.name}</span>
          {isChild && <span className="child-account-pill">child</span>}
          {children.length > 0 && (
            <Badge tone="info">+{children.length} {children.length === 1 ? "child" : "children"}</Badge>
          )}
          <span className="customer-account-summary">
            {supportSummary && <span>{supportSummary}</span>}
            {supportSummary && usageSummary && <span aria-hidden> · </span>}
            {usageSummary && <span>{usageSummary}</span>}
          </span>
        </button>

        {isOpen && (
          <div className="customer-account-body">
            <CustomerDrilldown
              accountId={account.id}
              accountName={account.name}
              zendeskOrgIds={j.zendeskOrgIds}
            />
          </div>
        )}
      </Card>

      {/* Children render below their parent when parent is expanded. */}
      {isOpen && children.length > 0 && (
        <div className="customer-account-children">
          {children.map((child) => (
            <CustomerAccountCard
              key={child.id}
              account={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
