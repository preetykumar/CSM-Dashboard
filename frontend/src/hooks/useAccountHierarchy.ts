// Single source of truth for SF account hierarchy lookups, fetched once per
// session. The data set is small (~hundreds of rows) and rarely changes, so
// a single fetch is fine. Used by every view that wants to nest customers
// under their parent SF account.

import { useEffect, useState } from "react";

export interface HierarchyEntry {
  accountId: string;
  accountName: string;
  parentId: string | null;
  parentName: string | null;
  ultimateParentId: string;
  ultimateParentName: string;
}

export interface HierarchyMap {
  // Quick lookups
  byId: Map<string, HierarchyEntry>;
  parentIdById: Map<string, string | null>;       // accountId → parentId
  ultimateParentIdById: Map<string, string>;       // accountId → root id
}

const API_BASE = import.meta.env.VITE_API_URL || "/api";

// Module-level cache so multiple views/mounts share one fetch per session.
let cachedPromise: Promise<HierarchyMap> | null = null;

async function fetchHierarchy(): Promise<HierarchyMap> {
  const res = await fetch(`${API_BASE}/organizations/account-hierarchy`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load account hierarchy: ${res.status}`);
  const data = (await res.json()) as { entries: HierarchyEntry[] };
  const byId = new Map<string, HierarchyEntry>();
  const parentIdById = new Map<string, string | null>();
  const ultimateParentIdById = new Map<string, string>();
  for (const e of data.entries) {
    byId.set(e.accountId, e);
    parentIdById.set(e.accountId, e.parentId);
    ultimateParentIdById.set(e.accountId, e.ultimateParentId);
  }
  return { byId, parentIdById, ultimateParentIdById };
}

export function useAccountHierarchy(): {
  hierarchy: HierarchyMap | null;
  loading: boolean;
  error: string | null;
} {
  const [hierarchy, setHierarchy] = useState<HierarchyMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cachedPromise) cachedPromise = fetchHierarchy();
    cachedPromise
      .then((map) => {
        setHierarchy(map);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load hierarchy");
        setLoading(false);
        // Reset so a retry will refetch
        cachedPromise = null;
      });
  }, []);

  return { hierarchy, loading, error };
}
