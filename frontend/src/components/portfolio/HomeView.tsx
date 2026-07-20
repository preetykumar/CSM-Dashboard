// Merged Home page: portfolio cards in the main column with a right rail of
// supplementary widgets (calendar, personal todos). Built on the shared UI
// primitives so it shares the same visual language as Renewals / Customer /
// Product / Deployments.
//
// Data path:
//   1. fetch /api/portfolio?role=...&email=... (real backend)
//   2. lazy-fetch /api/health/batch for all account names — merge results
//      back into the tree so health pills fill in progressively
//   3. fetchKey scopes the effect to the params that actually change the API
//      call (admin previewing different roles re-renders without refetching)

import { useEffect, useMemo, useState } from "react";
import { Users, AlertTriangle } from "lucide-react";
import {
  countAccounts,
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
import { RoleSelectionModal } from "../home/RoleSelectionModal";
import {
  Page,
  PageHeader,
  Card,
  Banner,
  SectionHeader,
  LoadingRow,
  EmptyState,
} from "../ui";
import { useStickyState } from "../../hooks/useStickyState";
import { useResolvedRole } from "../../hooks/useResolvedRole";

const ROLE_LABELS: Record<Role, string> = {
  csm: "CSM",
  pm: "Project Manager",
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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export function HomeView() {
  // Identity and privilege come from the authenticated Google session — never
  // from mock tables. (Previously this screen read MOCK_USERS[role], which made
  // every non-admin see mark.washburn@deque.com's portfolio + welcome.)
  const {
    isAdmin,
    userEmail,
    userName,
    userRole,
    portfolioRole,
    loading: loadingPrefs,
    needsRoleSelection,
    openRoleSelection,
    handleRoleSelected,
  } = useResolvedRole();

  // Admin-only "Preview as" selection is sticky. It re-groups the already
  // fetched admin universe client-side; it does NOT change the API call.
  const [adminRole, setAdminRole] = useStickyState<Role>("home:adminRole", "admin");

  // Display role: admins drive it from the preview selector; non-admins from
  // their chosen role (already mapped onto the portfolio taxonomy by the hook).
  const role: Role = isAdmin ? adminRole : portfolioRole;

  const [portfolio, setPortfolio] = useState<MockPortfolioAccount[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fetchKey scopes the effect to params that actually change the API call.
  // Admins fetch the whole admin universe once (preview-as only re-groups
  // client-side); non-admins fetch their own accounts by their real email.
  const apiRole: Role = isAdmin ? "admin" : portfolioRole;
  const apiEmail = userEmail;
  const fetchKey = `${apiRole}::${apiEmail}`;

  // Hold off fetching until we know the user's role (avoids a throwaway CSM
  // fetch before prefs resolve, and no fetch while the role modal is up).
  const readyToFetch = isAdmin || (!loadingPrefs && !needsRoleSelection && !!userRole);

  useEffect(() => {
    if (!readyToFetch) return;
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
  }, [fetchKey, readyToFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountCount = useMemo(() => countAccounts(portfolio), [portfolio]);

  const subtitle = (
    <span className="home-subtitle">
      <Users size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
      <strong>{accountCount}</strong>{" "}
      accounts · {isAdmin ? `previewing ${roleLabel(adminRole)}` : ROLE_LABELS[role]}
    </span>
  );

  // Admins get a "Preview as" selector to inspect role-grouped portfolios.
  // Non-admins get a "Change role" button that reopens the selection modal.
  const headerActions = isAdmin ? (
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
  ) : userRole ? (
    <button
      type="button"
      className="home-select"
      onClick={openRoleSelection}
    >
      Change role
    </button>
  ) : null;

  // First-login gate: resolve the saved role before rendering, then prompt the
  // user to pick one if they haven't. Admins bypass both.
  if (loadingPrefs) {
    return (
      <Page>
        <Card><LoadingRow>Loading your portal…</LoadingRow></Card>
      </Page>
    );
  }

  if (needsRoleSelection) {
    return <RoleSelectionModal onRoleSelected={handleRoleSelected} />;
  }

  return (
    <Page>
      <PageHeader
        eyebrow={isAdmin ? "Admin view" : ROLE_LABELS[role]}
        title={<>Good {getGreeting()}, <span className="home-greeting-name">{userName}</span></>}
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

      {/* Two-column layout: portfolio cards in the main column, calendar +
          personal todos in the right rail. Widgets stack vertically on
          narrow screens (see .home-main-layout breakpoint). */}
      <div className="home-main-layout">
        <main className="home-main-col">
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
        </main>

        <aside className="home-side-rail" aria-label="Calendar and tasks">
          <CalendarWidget />
          <PersonalTodoWidget />
        </aside>
      </div>
    </Page>
  );
}

function roleLabel(role: Role): string {
  return PREVIEWABLE_ROLES.find((r) => r.key === role)?.label || ROLE_LABELS[role];
}
