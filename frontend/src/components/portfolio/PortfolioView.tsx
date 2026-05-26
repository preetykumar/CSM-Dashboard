// Standalone portfolio page — header + role switcher controls + cards.
// Kept around for back-compat at /portfolio; the merged Home (/home) is the
// new primary surface.

import { useEffect, useState } from "react";
import { Users, AlertTriangle } from "lucide-react";
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
  { key: "csm", label: "CSM (mark.washburn@deque.com)" },
  { key: "prs", label: "Renewal Specialist (prs.tester@deque.com)" },
  { key: "tsa", label: "TSA (tsa.tester@deque.com)" },
  { key: "ie", label: "Implementation Engineer (ie.tester@deque.com)" },
];

export function PortfolioView() {
  const [isAdmin, setIsAdmin] = useState(true);
  const [adminRole, setAdminRole] = useState<Role>("admin");
  const [nonAdminRole, setNonAdminRole] = useState<Role>("csm");

  const role: Role = isAdmin ? adminRole : nonAdminRole;
  const userEmail = MOCK_USERS[role];

  const [portfolio, setPortfolio] = useState<MockPortfolioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch portfolio + lazy-load health. Health is excluded from /api/portfolio
  // (it dominated cold response time) and merged in via /api/health/batch once
  // the accounts list has rendered.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiRole: Role = isAdmin ? "admin" : role;
    const apiEmail = isAdmin ? "" : userEmail;

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
  }, [isAdmin, role, userEmail]);

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
          <label className="portfolio-admin-toggle">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            <span>I am admin (wireframe sim)</span>
          </label>

          {isAdmin ? (
            <div className="portfolio-role-switcher" aria-label="Preview as">
              <label htmlFor="admin-preview-role">Preview as:</label>
              <select id="admin-preview-role" value={adminRole} onChange={(e) => setAdminRole(e.target.value as Role)}>
                {PREVIEWABLE_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="portfolio-role-switcher" aria-label="Simulate non-admin role (wireframe only)">
              <label htmlFor="non-admin-role">Logged in as:</label>
              <select id="non-admin-role" value={nonAdminRole} onChange={(e) => setNonAdminRole(e.target.value as Role)}>
                {NON_ADMIN_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      <div className="portfolio-banner">
        <AlertTriangle size={14} aria-hidden />
        <span>
          <strong>Live data from Salesforce.</strong>{" "}
          {isAdmin
            ? "Role switcher above simulates admin previewing different role views — admin sees all portfolios grouped by owner."
            : "Non-admin sees only their own assigned accounts. No role switcher in production for this persona."
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
