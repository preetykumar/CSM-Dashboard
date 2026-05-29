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
import { ChevronDown, ChevronRight, Users, AlertTriangle, Search, X } from "lucide-react";
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
  const [search, setSearch] = useState("");

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
  const filteredPortfolio = useMemo(() => filterAccounts(portfolio, search), [portfolio, search]);
  const filteredCount = useMemo(() => countAccounts(filteredPortfolio), [filteredPortfolio]);
  const letterGroups = useMemo(() => groupByFirstLetter(filteredPortfolio), [filteredPortfolio]);
  const letterAvailability = useMemo(() => {
    const set = new Set(letterGroups.map((g) => g.letter));
    return set;
  }, [letterGroups]);

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

        {!loading && !error && portfolio.length > 0 && (
          <div className="portfolio-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              placeholder="Search accounts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter accounts by name"
            />
            {search && (
              <>
                <span className="portfolio-search-count">
                  {filteredCount} of {accountCount}
                </span>
                <button
                  type="button"
                  className="portfolio-search-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        )}

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
        ) : search && filteredCount === 0 ? (
          <p className="portfolio-empty">No accounts match “{search}”.</p>
        ) : (
          <>
            <AlphaJumper available={letterAvailability} />
            {letterGroups.map((group) => (
              <div key={group.letter} className="customer-letter-group">
                <h3
                  id={`customer-letter-${group.letter}`}
                  className="customer-letter-header"
                >
                  {group.letter}
                </h3>
                {group.accounts.map((account) => (
                  <CustomerAccountCard
                    key={account.id}
                    account={account}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                  />
                ))}
              </div>
            ))}
          </>
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
  const arrSummary =
    j.subscriptionArr === undefined || j.subscriptionArr === null
      ? null
      : `ARR ${formatArr(j.subscriptionArr)}`;

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
            {arrSummary && <span className="customer-account-arr">{arrSummary}</span>}
            {arrSummary && (supportSummary || usageSummary) && <span aria-hidden> · </span>}
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
              subscriptionArr={j.subscriptionArr}
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

// Bucket the (already filtered) root accounts by first letter of their name.
// Numbers / symbols collapse into "#". Children stay nested under their parent
// — only the roots get grouped. Letters with no accounts are omitted from the
// output (the jumper handles "missing letter" UI separately).
function groupByFirstLetter(
  accounts: MockPortfolioAccount[]
): Array<{ letter: string; accounts: MockPortfolioAccount[] }> {
  const buckets = new Map<string, MockPortfolioAccount[]>();
  for (const acc of accounts) {
    const first = (acc.name || "").trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const list = buckets.get(letter) || [];
    list.push(acc);
    buckets.set(letter, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    })
    .map(([letter, accounts]) => ({ letter, accounts }));
}

const ALPHA_LETTERS: string[] = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  "#",
];

function AlphaJumper({ available }: { available: Set<string> }) {
  return (
    <nav className="customer-alpha-jumper" aria-label="Jump to letter">
      {ALPHA_LETTERS.map((l) => {
        const has = available.has(l);
        return (
          <a
            key={l}
            href={has ? `#customer-letter-${l}` : undefined}
            className={`customer-alpha-letter${has ? "" : " disabled"}`}
            aria-disabled={!has}
            tabIndex={has ? 0 : -1}
            onClick={(e) => {
              if (!has) {
                e.preventDefault();
                return;
              }
              // Native anchor scrolling works, but smooth-scroll feels nicer.
              e.preventDefault();
              document.getElementById(`customer-letter-${l}`)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          >
            {l}
          </a>
        );
      })}
    </nav>
  );
}

// Recursive name filter — keeps a parent in the tree if it matches OR any
// descendant matches, so searching for a child name doesn't strip its parent.
// Matches PortfolioContent's filterPortfolio behavior.
function filterAccounts(
  accounts: MockPortfolioAccount[],
  query: string
): MockPortfolioAccount[] {
  const q = query.trim().toLowerCase();
  if (!q) return accounts;
  const out: MockPortfolioAccount[] = [];
  for (const acc of accounts) {
    const filteredChildren = acc.children ? filterAccounts(acc.children, q) : [];
    const selfMatches = acc.name.toLowerCase().includes(q);
    if (selfMatches || filteredChildren.length > 0) {
      out.push({
        ...acc,
        children: filteredChildren.length > 0 ? filteredChildren : acc.children,
      });
    }
  }
  return out;
}

// Compact ARR display: $1.2M / $850k / $0. Plain numbers below $1k.
function formatArr(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
