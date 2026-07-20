// Standalone portfolio page — header + role controls + cards.
// Kept around for back-compat at /portfolio; the merged Home (/home) is the
// new primary surface. Identity/role come from the authenticated session via
// useResolvedRole — never from mock tables.

import { useEffect, useState } from "react";
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
import { RoleSelectionModal } from "../home/RoleSelectionModal";
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

export function PortfolioView() {
  const {
    isAdmin,
    userEmail,
    userRole,
    portfolioRole,
    loading: loadingPrefs,
    needsRoleSelection,
    openRoleSelection,
    handleRoleSelected,
  } = useResolvedRole();

  // Admin-only preview selector (re-groups the admin universe client-side).
  const [adminRole, setAdminRole] = useState<Role>("admin");
  const role: Role = isAdmin ? adminRole : portfolioRole;

  const [portfolio, setPortfolio] = useState<MockPortfolioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admins fetch the whole admin universe (email=""); non-admins fetch their
  // own accounts by their real email. Hold off until the role is resolved.
  const apiRole: Role = isAdmin ? "admin" : portfolioRole;
  const apiEmail = userEmail;
  const readyToFetch = isAdmin || (!loadingPrefs && !needsRoleSelection && !!userRole);

  // Fetch portfolio + lazy-load health. Health is excluded from /api/portfolio
  // (it dominated cold response time) and merged in via /api/health/batch once
  // the accounts list has rendered.
  useEffect(() => {
    if (!readyToFetch) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPortfolio(apiRole, apiEmail)
      .then((resp) => {
        if (cancelled) return;
        setPortfolio(resp.accounts);
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
  }, [apiRole, apiEmail, readyToFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadingPrefs) {
    return (
      <div className="portfolio-view">
        <p className="portfolio-empty">Loading portfolio…</p>
      </div>
    );
  }

  if (needsRoleSelection) {
    return <RoleSelectionModal onRoleSelected={handleRoleSelected} />;
  }

  return (
    <div className="portfolio-view">
      <header className="portfolio-header">
        <div>
          <h1>My Portfolio</h1>
          <p className="portfolio-subtitle">
            <Users size={14} aria-hidden /> <strong>{countAccounts(portfolio)}</strong> accounts
            {" · "}
            {isAdmin
              ? <>previewing <strong>{viewLabel(adminRole)}</strong></>
              : <>role: <strong>{ROLE_LABELS[role]}</strong></>
            }
          </p>
        </div>

        <div className="portfolio-controls">
          {isAdmin ? (
            <div className="portfolio-role-switcher" aria-label="Preview as">
              <label htmlFor="admin-preview-role">Preview as:</label>
              <select id="admin-preview-role" value={adminRole} onChange={(e) => setAdminRole(e.target.value as Role)}>
                {PREVIEWABLE_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
          ) : userRole ? (
            <button type="button" className="portfolio-change-role" onClick={openRoleSelection}>
              Change role
            </button>
          ) : null}
        </div>
      </header>

      <div className="portfolio-banner">
        <AlertTriangle size={14} aria-hidden />
        <span>
          <strong>Live data from Salesforce.</strong>{" "}
          {isAdmin
            ? "Admin sees all portfolios grouped by owner; use Preview as to inspect a role view."
            : "You see only your own assigned accounts."
          }
        </span>
      </div>

      {loading ? (
        <p className="portfolio-empty">Loading portfolio…</p>
      ) : error ? (
        <p className="portfolio-empty">Failed to load portfolio: {error}</p>
      ) : (
        <PortfolioContent role={role} isAdmin={isAdmin} portfolio={portfolio} userEmail={userEmail} />
      )}
    </div>
  );
}

function viewLabel(role: Role): string {
  return PREVIEWABLE_ROLES.find((r) => r.key === role)?.label || ROLE_LABELS[role];
}
