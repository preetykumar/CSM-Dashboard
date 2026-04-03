import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { fetchUserPreferences, saveUserPreferences } from "../services/api";
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

export function HomePage() {
  const { user, authenticated, authEnabled } = useAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null);
  const [calendlyToken, setCalendlyToken] = useState<string | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [showRoleSelection, setShowRoleSelection] = useState(false);

  // Determine the user's display email — fallback to "you" for unauthenticated
  const userEmail = user?.email || "";
  const userName = user?.name?.split(" ")[0] || "there";

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
        setCalendlyToken(prefs.calendly_token);
      })
      .catch(() => {
        // API unavailable (no auth, local dev) — show role selection from localStorage
        const saved = localStorage.getItem("home_role") as UserRole | null;
        if (saved) {
          setRole(saved);
          setCalendlyUrl(localStorage.getItem("home_calendly_url"));
          setCalendlyToken(localStorage.getItem("home_calendly_token"));
        } else {
          setShowRoleSelection(true);
        }
      })
      .finally(() => setLoadingPrefs(false));
  }, [authenticated, authEnabled]);

  const handleRoleSelected = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setShowRoleSelection(false);
    // Also cache in localStorage as fallback
    localStorage.setItem("home_role", selectedRole);
  };

  const handleCalendlyChange = (url: string, token: string) => {
    setCalendlyUrl(url || null);
    setCalendlyToken(token || null);
    localStorage.setItem("home_calendly_url", url);
    localStorage.setItem("home_calendly_token", token);
  };

  const handleChangeRole = async () => {
    setShowRoleSelection(true);
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
        </div>
      </div>

      <div className="home-layout">
        {/* Left column: todo list */}
        <div className="home-col-main">
          {role && role !== "field-engineers" ? (
            <TodoList role={role} userEmail={userEmail} />
          ) : role === "field-engineers" ? (
            <div className="coming-soon-panel">
              <p>🔧 Field Engineer task dashboard coming soon.</p>
            </div>
          ) : null}
        </div>

        {/* Right column: calendar + Calendly */}
        <div className="home-col-side">
          <CalendarWidget />
          <CalendlyWidget
            calendlyUrl={calendlyUrl}
            calendlyToken={calendlyToken}
            onSettingsChange={handleCalendlyChange}
          />
        </div>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
