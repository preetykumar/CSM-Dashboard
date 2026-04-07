import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { fetchUserPreferences, fetchCSMPortfolios, fetchPMPortfolios, fetchRenewalOpportunities } from "../services/api";
import { RoleSelectionModal, type UserRole } from "./home/RoleSelectionModal";
import { TodoList } from "./home/TodoList";
import { CalendarWidget } from "./home/CalendarWidget";
import { CalendlyWidget } from "./home/CalendlyWidget";

const ROLE_DISPLAY: Record<UserRole, string> = {
  csm: "Customer Success Manager",
  pm: "Project Manager",
  "renewal-specialist": "Renewal Specialist",
  "field-engineers": "Field Engineer",
};

interface ViewAsUser {
  email: string;
  name: string;
}

export function HomePage() {
  const { user, authenticated, authEnabled, isAdmin } = useAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [showRoleSelection, setShowRoleSelection] = useState(false);

  // Admin "View as" state
  const [viewAsEmail, setViewAsEmail] = useState<string | null>(null);
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  const [availableUsers, setAvailableUsers] = useState<ViewAsUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const userEmail = user?.email || "";
  const userName = user?.name?.split(" ")[0] || "there";

  // The email used for TodoList — either the real user or the "view as" target
  const effectiveEmail = viewAsEmail || userEmail;
  const effectiveDisplayName = viewAsName || userName;

  useEffect(() => {
    if (!authenticated && authEnabled) {
      setLoadingPrefs(false);
      return;
    }

    fetchUserPreferences()
      .then((prefs) => {
        if (prefs.role) {
          setRole(prefs.role as UserRole);
        } else {
          setShowRoleSelection(true);
        }
        setCalendlyUrl(prefs.calendly_url);
      })
      .catch(() => {
        const saved = localStorage.getItem("home_role") as UserRole | null;
        if (saved) {
          setRole(saved);
          setCalendlyUrl(localStorage.getItem("home_calendly_url"));
        } else {
          setShowRoleSelection(true);
        }
      })
      .finally(() => setLoadingPrefs(false));
  }, [authenticated, authEnabled]);

  // Load available users for "View as" when admin selects a role
  useEffect(() => {
    if (!isAdmin || !role) return;

    setLoadingUsers(true);
    loadAvailableUsers(role).then(setAvailableUsers).finally(() => setLoadingUsers(false));
  }, [isAdmin, role]);

  const handleRoleSelected = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setShowRoleSelection(false);
    setViewAsEmail(null);
    setViewAsName(null);
    localStorage.setItem("home_role", selectedRole);
  };

  const handleCalendlyChange = (url: string) => {
    setCalendlyUrl(url || null);
    localStorage.setItem("home_calendly_url", url);
  };

  const handleChangeRole = async () => {
    setShowRoleSelection(true);
  };

  const handleViewAsChange = (email: string) => {
    if (!email) {
      setViewAsEmail(null);
      setViewAsName(null);
    } else {
      setViewAsEmail(email);
      const found = availableUsers.find((u) => u.email === email);
      setViewAsName(found?.name || email);
    }
  };

  if (loadingPrefs) {
    return (
      <div className="home-page">
        <div className="widget-loading" aria-live="polite">Loading your portal…</div>
      </div>
    );
  }

  if (showRoleSelection) {
    return <RoleSelectionModal onRoleSelected={handleRoleSelected} />;
  }

  return (
    <div className="home-page">
      <div className="home-greeting">
        <div>
          <h2>Good {getGreeting()}, {userName} 👋</h2>
          {role && (
            <p className="home-role-badge">
              Working as: <strong>{ROLE_DISPLAY[role]}</strong>
              <button className="role-change-btn" onClick={handleChangeRole}>
                Change role
              </button>
            </p>
          )}
          {isAdmin && role && role !== "field-engineers" && (
            <div className="view-as-selector">
              <label htmlFor="view-as-select">View as: </label>
              <select
                id="view-as-select"
                value={viewAsEmail || ""}
                onChange={(e) => handleViewAsChange(e.target.value)}
                disabled={loadingUsers}
              >
                <option value="">Myself ({userEmail})</option>
                {availableUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
              {viewAsEmail && (
                <span className="view-as-badge">Viewing as {effectiveDisplayName}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="home-layout">
        {/* Left column: todo list */}
        <div className="home-col-main">
          {role && role !== "field-engineers" ? (
            <TodoList role={role} userEmail={effectiveEmail} />
          ) : role === "field-engineers" ? (
            <div className="coming-soon-panel">
              <p>Field Engineer task dashboard coming soon.</p>
            </div>
          ) : null}
        </div>

        {/* Right column: calendar + Calendly */}
        <div className="home-col-side">
          <CalendarWidget />
          <CalendlyWidget
            calendlyUrl={calendlyUrl}
            onSettingsChange={handleCalendlyChange}
          />
        </div>
      </div>
    </div>
  );
}

async function loadAvailableUsers(role: UserRole): Promise<ViewAsUser[]> {
  const users = new Map<string, string>();

  try {
    if (role === "csm") {
      const data = await fetchCSMPortfolios();
      for (const p of data.portfolios || []) {
        if (p.csm?.email) users.set(p.csm.email, p.csm.name || p.csm.email);
      }
    } else if (role === "pm") {
      const data = await fetchPMPortfolios();
      for (const p of (data as any).portfolios || []) {
        if (p.pm?.email) users.set(p.pm.email, p.pm.name || p.pm.email);
      }
    } else if (role === "renewal-specialist") {
      const data = await fetchRenewalOpportunities(365);
      const seen = new Set<string>();
      for (const o of data.opportunities || []) {
        if (o.prsEmail && !seen.has(o.prsEmail)) {
          seen.add(o.prsEmail);
          users.set(o.prsEmail, o.prsName || o.prsEmail);
        }
      }
    }
  } catch {
    // If API fails, return empty list
  }

  return Array.from(users.entries())
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
