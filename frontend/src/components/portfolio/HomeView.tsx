// Merged Home page: personal context (greeting + calendar + todos) on top,
// portfolio cards below. Built on the shared UI primitives so it shares the
// same visual language as Renewals / Customer / Product / Deployments.
//
// Data path:
//   1. fetch /api/portfolio?role=...&email=... (real backend)
//   2. lazy-fetch /api/health/batch for all account names — merge results
//      back into the tree so health pills fill in progressively
//   3. fetchKey scopes the effect to the params that actually change the API
//      call (admin previewing different roles re-renders without refetching)

import { useEffect, useMemo, useState } from "react";
import { Users, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import {
  countAccounts,
  MOCK_USERS,
  type MockPortfolioAccount,
  type HealthScore,
  type Role,
} from "../../data/portfolioMocks";
import {
  fetchPortfolio,
  fetchHealthScoresBatch,
  collectAccountNames,
  transformHealth,
  applyHealthScores,
} from "../../services/api";
import { PortfolioContent } from "./PortfolioContent";
import { CalendarWidget } from "../home/CalendarWidget";
import { PersonalTodoWidget } from "../home/PersonalTodoWidget";
import {
  Page,
  PageHeader,
  Card,
  Banner,
  Badge,
  SectionHeader,
  LoadingRow,
  EmptyState,
} from "../ui";
import { useStickyState } from "../../hooks/useStickyState";

const ROLE_LABELS: Record<Role, string> = {
  csm: "CSM",
  prs: "Renewal Specialist",
  tsa: "Technical Solution Architect",
  ie: "Implementation Engineer",
  admin: "Admin (all portfolios)",
};

const PREVIEWABLE_ROLES: Array<{ key: Role; label: string }> = [
  { key: "admin", label: "Admin overview (By CSM + By TSA)" },
  { key: "csm", label: "All CSM portfolios" },
  { key: "prs", label: "All Renewal Specialist portfolios" },
  { key: "tsa", label: "All TSA portfolios" },
  { key: "ie", label: "All Implementation Engineer portfolios" },
];

const NON_ADMIN_ROLES: Array<{ key: Role; label: string }> = [
  { key: "csm", label: `CSM (${MOCK_USERS.csm})` },
  { key: "prs", label: `Renewal Specialist (${MOCK_USERS.prs})` },
  { key: "tsa", label: `TSA (${MOCK_USERS.tsa})` },
  { key: "ie", label: `Implementation Engineer (${MOCK_USERS.ie})` },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export function HomeView() {
  // Selections sticky per-user (localStorage namespaced by email).
  const [isAdmin, setIsAdmin] = useStickyState<boolean>("home:isAdmin", true);
  const [adminRole, setAdminRole] = useStickyState<Role>("home:adminRole", "admin");
  const [nonAdminRole, setNonAdminRole] = useStickyState<Role>("home:nonAdminRole", "csm");
  const [widgetsOpen, setWidgetsOpen] = useStickyState<boolean>("home:widgetsOpen", true);

  const role: Role = isAdmin ? adminRole : nonAdminRole;
  const userEmail = MOCK_USERS[role];
  const userName = isAdmin ? "admin" : userEmail.split("@")[0].split(".")[0];

  const [portfolio, setPortfolio] = useState<MockPortfolioAccount[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fetchKey scopes the effect to params that actually change the API call.
  // Admin previewing different roles re-renders client-side without refetching.
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

        const names = collectAccountNames(resp.accounts);
        if (names.length === 0) return;

        fetchHealthScoresBatch(names)
          .then((scores) => {
            if (cancelled) return;
            const byName = new Map<string, HealthScore>();
            for (const [name, raw] of Object.entries(scores)) {
              byName.set(name, transformHealth(raw));
            }
            setPortfolio((prev) => applyHealthScores(prev, byName));
          })
          .catch((err) => console.warn("Health batch fetch failed:", err));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load portfolio");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountCount = useMemo(() => countAccounts(portfolio), [portfolio]);

  const subtitle = (
    <span className="home-subtitle">
      <Users size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
      <strong>{accountCount}</strong>{" "}
      accounts · {isAdmin ? `previewing ${roleLabel(adminRole)}` : ROLE_LABELS[role]}
    </span>
  );

  const headerActions = (
    <>
      <label className="home-admin-toggle">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
        <span>I am admin <Badge tone="neutral">wireframe sim</Badge></span>
      </label>

      {isAdmin ? (
        <div className="home-role-switcher">
          <label htmlFor="home-admin-role">Preview as</label>
          <select
            id="home-admin-role"
            value={adminRole}
            onChange={(e) => setAdminRole(e.target.value as Role)}
            className="home-select"
          >
            {PREVIEWABLE_ROLES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="home-role-switcher">
          <label htmlFor="home-non-admin-role">Logged in as</label>
          <select
            id="home-non-admin-role"
            value={nonAdminRole}
            onChange={(e) => setNonAdminRole(e.target.value as Role)}
            className="home-select"
          >
            {NON_ADMIN_ROLES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );

  return (
    <Page>
      <PageHeader
        eyebrow={isAdmin ? "Admin view" : ROLE_LABELS[role]}
        title={<>Good {getGreeting()}, <span className="home-greeting-name">{userName}</span></>}
        subtitle={subtitle}
        actions={headerActions}
      />

      {/* Widget strip — collapsible so it doesn't crowd deep portfolio review */}
      <Card variant="ghost" className="home-widget-card">
        <button
          type="button"
          className="home-widget-toggle"
          onClick={() => setWidgetsOpen(!widgetsOpen)}
          aria-expanded={widgetsOpen}
        >
          {widgetsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>{widgetsOpen ? "Hide" : "Show"} calendar & todos</span>
        </button>
        {widgetsOpen && (
          <div className="home-widget-grid">
            <div className="home-widget-col"><CalendarWidget /></div>
            <div className="home-widget-col"><PersonalTodoWidget /></div>
          </div>
        )}
      </Card>

      {warnings.length > 0 && (
        <Banner tone="warning" icon={<AlertTriangle size={16} />}>
          <ul className="home-warning-list">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Banner>
      )}

      {/* Portfolio cards ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="My Portfolio"
          count={loading ? undefined : `${accountCount} ${accountCount === 1 ? "account" : "accounts"}`}
        />

        {loading ? (
          <Card><LoadingRow>Loading portfolio…</LoadingRow></Card>
        ) : error ? (
          <Card>
            <EmptyState
              title="Couldn't load portfolio"
              detail={error}
            />
          </Card>
        ) : accountCount === 0 ? (
          <Card>
            <EmptyState
              title={isAdmin ? "No accounts found" : `No accounts assigned to ${userEmail}`}
              detail="If this looks wrong, check Salesforce assignment fields for this user."
            />
          </Card>
        ) : (
          <PortfolioContent
            role={role}
            isAdmin={isAdmin}
            portfolio={portfolio}
            userEmail={userEmail}
          />
        )}
      </section>
    </Page>
  );
}

function roleLabel(role: Role): string {
  return PREVIEWABLE_ROLES.find((r) => r.key === role)?.label || ROLE_LABELS[role];
}
