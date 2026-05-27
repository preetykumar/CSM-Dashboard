// Per-user sticky state backed by localStorage.
//
// Each user's UI selections (last-picked TSA on Deployments, last role on
// Home, filter values, expand/collapse defaults, etc.) survive page reloads
// and tab switches. The storage namespace is keyed by the authenticated
// user's email so different users on the same device don't see each other's
// selections.
//
// Usage:
//   const [tsaEmail, setTsaEmail] = useStickyState("deployments:tsa", "tilly.pick@deque.com");
//
// The signature mirrors useState so any useState callsite can be swapped in
// place. The `defaultValue` is used only when nothing is in storage.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_PREFIX = "prefs";

function storageKey(userEmail: string | null | undefined, key: string): string {
  const ns = userEmail ? userEmail.toLowerCase() : "anon";
  return `${STORAGE_PREFIX}:${ns}:${key}`;
}

export function useStickyState<T>(key: string, defaultValue: T): [T, (next: T) => void] {
  const { user } = useAuth();
  const fullKey = storageKey(user?.email, key);

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored === null) return defaultValue;
      return JSON.parse(stored) as T;
    } catch {
      return defaultValue;
    }
  });

  // Re-sync if the user changes (e.g., logout/login) — pull fresh defaults
  // from the new user's namespace.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored === null) setValue(defaultValue);
      else setValue(JSON.parse(stored) as T);
    } catch {
      setValue(defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  const setAndPersist = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(fullKey, JSON.stringify(next));
      } catch {
        // localStorage full or unavailable — silently degrade to in-memory only
      }
    },
    [fullKey]
  );

  return [value, setAndPersist];
}
