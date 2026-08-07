// Single source of truth for "who is the logged-in user and what role are they?"
//
// Identity and admin status come ONLY from the authenticated Google session
// (useAuth) — never from mock tables. This is the fix for the cross-user data
// leak where every non-admin was shown mark.washburn@deque.com's portfolio.
//
// The non-admin role is the user's own saved preference (per-email, in the DB
// via /api/user/preferences), resolved on mount. Backward compatible: anyone
// who already chose a role (DB, or the legacy localStorage "home_role") is not
// re-prompted; a legacy local choice is migrated into the DB.

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { fetchUserPreferences, saveUserPreferences } from "../services/api";
import type { UserRole } from "../components/home/RoleSelectionModal";
import type { Role } from "../data/portfolioMocks";

// The role picker speaks UserRole; the portfolio resolver speaks Role. Map one
// onto the other. Unknown/legacy values fall back to "csm" — a safe, email
// scoped view (empty rather than another user's data).
//   - "renewal-specialist" → prs   (Renewals pipeline owner)
//   - "field-engineers"    → ie    (legacy alias for Implementation Engineer)
const USER_ROLE_TO_PORTFOLIO: Record<UserRole, Role> = {
  csm: "csm",
  pm: "pm",
  "renewal-specialist": "prs",
  tsa: "tsa",
  ie: "ie",
  "field-engineers": "ie",
};

export function toPortfolioRole(role: UserRole | null): Role {
  return role ? USER_ROLE_TO_PORTFOLIO[role] ?? "csm" : "csm";
}

// ── Session-level role cache ────────────────────────────────────────────────
// The saved role is resolved ONCE per session and shared by every consumer.
// Without this, each of Home / Customers / Portfolio re-fetched preferences on
// mount, and because the portfolio fetch is gated on that result it added a
// full round trip in front of the (expensive) portfolio call on every single
// navigation. `undefined` = not resolved yet; `null` = resolved, none saved.
let cachedRole: UserRole | null | undefined = undefined;
let inflight: Promise<UserRole | null> | null = null;

/** Resolve (and de-dupe) the saved role. Concurrent callers share one request. */
function resolveRoleOnce(): Promise<UserRole | null> {
  if (inflight) return inflight;

  const fromLegacyStore = (): UserRole | null => {
    const saved = localStorage.getItem("home_role") as UserRole | null;
    if (saved) {
      // Migrate the legacy local choice into the server store so it follows the
      // user across devices and survives a cache clear.
      saveUserPreferences({ role: saved }).catch(() => {});
    }
    return saved;
  };

  inflight = fetchUserPreferences()
    .then((prefs) => {
      if (prefs.role) {
        localStorage.setItem("home_role", prefs.role);
        return prefs.role as UserRole;
      }
      return fromLegacyStore();
    })
    .catch(() => fromLegacyStore())
    .then((role) => {
      cachedRole = role;
      return role;
    });

  return inflight;
}

/** Reset the session cache (call on logout / role change by another surface). */
export function resetResolvedRoleCache(): void {
  cachedRole = undefined;
  inflight = null;
}

export interface ResolvedRole {
  /** True until the saved role has been resolved. */
  loading: boolean;
  isAdmin: boolean;
  /** Authenticated user's email; "" for admins (they fetch the admin universe). */
  userEmail: string;
  /** First name for greetings, or "admin". */
  userName: string;
  /** Raw stored role (picker taxonomy); null if never chosen. */
  userRole: UserRole | null;
  /** Stored role mapped onto the portfolio taxonomy (defaults to "csm"). */
  portfolioRole: Role;
  /** True when a non-admin has no saved role and must pick one. */
  needsRoleSelection: boolean;
  /** Re-open the picker (e.g. a "Change role" button). */
  openRoleSelection: () => void;
  /** Wire to RoleSelectionModal.onRoleSelected (the modal already persists). */
  handleRoleSelected: (role: UserRole) => void;
}

export function useResolvedRole(): ResolvedRole {
  const { user, isAdmin, authenticated, authEnabled } = useAuth();

  // Seed synchronously from the session cache so a second mount (i.e. any
  // navigation between Home / Customers / Portfolio) is already resolved and
  // fires the portfolio fetch immediately, with no preferences round trip.
  const [userRole, setUserRole] = useState<UserRole | null>(cachedRole ?? null);
  const [resolved, setResolved] = useState(cachedRole !== undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    // Not signed in yet, or an admin → nothing to resolve. Admins bypass role
    // selection entirely (they preview roles via their own controls).
    if ((authEnabled && !authenticated) || isAdmin) {
      setResolved(true);
      return;
    }
    if (cachedRole !== undefined) {
      setUserRole(cachedRole);
      setResolved(true);
      return;
    }

    let cancelled = false;
    resolveRoleOnce().then((role) => {
      if (cancelled) return;
      setUserRole(role);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, authEnabled, isAdmin]);

  const handleRoleSelected = (selectedRole: UserRole) => {
    // RoleSelectionModal already POSTs to /api/user/preferences; mirror locally
    // and into the session cache so other views pick it up without a refetch.
    cachedRole = selectedRole;
    localStorage.setItem("home_role", selectedRole);
    setUserRole(selectedRole);
    setPickerOpen(false);
  };

  const firstName =
    user?.name?.trim().split(/\s+/)[0] || user?.email?.split("@")[0] || "there";

  return {
    loading: !resolved,
    isAdmin,
    userEmail: isAdmin ? "" : (user?.email ?? ""),
    userName: isAdmin ? "admin" : firstName,
    userRole,
    portfolioRole: toPortfolioRole(userRole),
    // Prompt when a non-admin has resolved with no saved role, or explicitly
    // reopened the picker.
    needsRoleSelection: !isAdmin && resolved && (pickerOpen || !userRole),
    openRoleSelection: () => setPickerOpen(true),
    handleRoleSelected,
  };
}
