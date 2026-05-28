// Renewals-specific helper: groups opportunities by SF account, then nests
// accounts by SF parent → child hierarchy. Phantom parent rows (no own opps)
// are added when an opp's parent isn't already in the dataset — this matches
// the user's "show empty parents as grouping headers" policy.
//
// Each output node represents ONE SF account with its own opportunities and
// stats. Children render nested. No stats rollup — own numbers only.

import type { HierarchyMap, HierarchyEntry } from "../hooks/useAccountHierarchy";
import type { HierarchyNode } from "./nestByHierarchy";

interface MinimalOpp {
  accountId: string;
  companyName: string;
  amount?: number;
}

export interface AccountOppGroup<O extends MinimalOpp> {
  accountId: string;
  accountName: string;
  opps: O[];                  // [] for phantom parents
  isPhantom: boolean;         // true when this row was synthesized from the
                              //   hierarchy because a descendant's parent
                              //   wasn't in the original opp set
  totalAmount: number;        // own opps only — no rollup
  oppCount: number;
}

// 1. Group opps by accountId (companyName fallback for orphan rows).
function groupByAccount<O extends MinimalOpp>(opps: O[]): Map<string, AccountOppGroup<O>> {
  const out = new Map<string, AccountOppGroup<O>>();
  for (const opp of opps) {
    const key = opp.accountId || opp.companyName || "Unknown";
    const existing = out.get(key);
    if (existing) {
      existing.opps.push(opp);
      existing.totalAmount += opp.amount || 0;
      existing.oppCount++;
    } else {
      out.set(key, {
        accountId: key,
        accountName: opp.companyName || key,
        opps: [opp],
        isPhantom: false,
        totalAmount: opp.amount || 0,
        oppCount: 1,
      });
    }
  }
  return out;
}

// 2. Walk up from each grouped account to find ancestors not in the set,
//    add them as phantom (empty) rows so the hierarchy is complete.
function addPhantomParents<O extends MinimalOpp>(
  groups: Map<string, AccountOppGroup<O>>,
  hierarchy: HierarchyMap
): Map<string, AccountOppGroup<O>> {
  // Iterate ids snapshot — we'll be inserting during the walk.
  const initialIds = Array.from(groups.keys());
  for (const id of initialIds) {
    let currentId: string | null = id;
    const visited = new Set<string>([id]);
    while (currentId) {
      const parentId: string | null = hierarchy.parentIdById.get(currentId) ?? null;
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);
      if (!groups.has(parentId)) {
        const entry: HierarchyEntry | undefined = hierarchy.byId.get(parentId);
        groups.set(parentId, {
          accountId: parentId,
          accountName: entry?.accountName || parentId,
          opps: [],
          isPhantom: true,
          totalAmount: 0,
          oppCount: 0,
        });
      }
      currentId = parentId;
    }
  }
  return groups;
}

// 3. Build the parent → children tree.
function buildTree<O extends MinimalOpp>(
  groups: Map<string, AccountOppGroup<O>>,
  hierarchy: HierarchyMap
): HierarchyNode<AccountOppGroup<O>>[] {
  const nodes = new Map<string, HierarchyNode<AccountOppGroup<O>>>();
  for (const [id, group] of groups) {
    nodes.set(id, { item: group, parentId: null, children: [] });
  }
  // Wire parents (only when parent is also in the set — strict scope).
  for (const node of nodes.values()) {
    const parentId = hierarchy.parentIdById.get(node.item.accountId);
    if (parentId && nodes.has(parentId)) {
      node.parentId = parentId;
    }
  }
  const roots: HierarchyNode<AccountOppGroup<O>>[] = [];
  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort alphabetically within each level.
  const sortRec = (arr: HierarchyNode<AccountOppGroup<O>>[]) => {
    arr.sort((a, b) => a.item.accountName.localeCompare(b.item.accountName));
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

// Top-level: opps → grouped/phantom'd/nested tree.
export function nestOppsByAccount<O extends MinimalOpp>(
  opps: O[],
  hierarchy: HierarchyMap | null
): HierarchyNode<AccountOppGroup<O>>[] {
  const groups = groupByAccount(opps);
  if (!hierarchy) {
    // No hierarchy yet — render flat (each group is a root).
    return Array.from(groups.values())
      .sort((a, b) => a.accountName.localeCompare(b.accountName))
      .map((item) => ({ item, parentId: null, children: [] }));
  }
  addPhantomParents(groups, hierarchy);
  return buildTree(groups, hierarchy);
}
