// Generic tree-builder: takes a flat list of items keyed by accountId and a
// hierarchy map, returns a forest of root nodes with children populated.
//
// Used by every account-listing view (Support, Usage, Health, Customer
// Renewals, etc.) to render the same parent → children nesting that the
// Deployments and Portfolio views already use.
//
// Scope policies:
//   - "strict" (default): a child only nests if its parent is ALSO in the
//     items list. Orphaned children (parent not in scope) bubble up to the
//     top level — they're not silently dropped.
//   - "family": same as strict for now; can later expand to include parents
//     not in scope as grouping headers.

import type { HierarchyMap } from "../hooks/useAccountHierarchy";

export interface HasAccount {
  accountId: string;
  accountName: string;
}

export interface HierarchyNode<T extends HasAccount> {
  item: T;
  parentId: string | null;
  children: HierarchyNode<T>[];
}

export function nestByHierarchy<T extends HasAccount>(
  items: T[],
  hierarchy: HierarchyMap
): HierarchyNode<T>[] {
  // Build nodes indexed by accountId.
  const nodesById = new Map<string, HierarchyNode<T>>();
  for (const item of items) {
    nodesById.set(item.accountId, { item, parentId: null, children: [] });
  }

  // Set parentId only if parent is also in the items list (strict).
  for (const node of nodesById.values()) {
    const parentId = hierarchy.parentIdById.get(node.item.accountId);
    if (parentId && nodesById.has(parentId)) {
      node.parentId = parentId;
    }
  }

  // Wire children + collect roots.
  const roots: HierarchyNode<T>[] = [];
  for (const node of nodesById.values()) {
    if (node.parentId) {
      const parent = nodesById.get(node.parentId);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children + roots alphabetically by account name.
  const sortRec = (arr: HierarchyNode<T>[]) => {
    arr.sort((a, b) => a.item.accountName.localeCompare(b.item.accountName));
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}

// Flatten a nested forest back to a depth-tagged sequence, useful for views
// that need to render with a simple .map (e.g., inside an existing table).
export function flattenWithDepth<T extends HasAccount>(
  roots: HierarchyNode<T>[]
): Array<{ item: T; depth: number; hasChildren: boolean }> {
  const out: Array<{ item: T; depth: number; hasChildren: boolean }> = [];
  const walk = (nodes: HierarchyNode<T>[], depth: number) => {
    for (const n of nodes) {
      out.push({ item: n.item, depth, hasChildren: n.children.length > 0 });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

// Filter a tree, keeping nodes that match OR have any matching descendant.
// Useful for tree-aware search/filter without losing intermediate parents.
export function filterTree<T extends HasAccount>(
  roots: HierarchyNode<T>[],
  predicate: (item: T) => boolean
): HierarchyNode<T>[] {
  const visit = (node: HierarchyNode<T>): HierarchyNode<T> | null => {
    const keptChildren = node.children
      .map(visit)
      .filter((c): c is HierarchyNode<T> => c !== null);
    const selfMatches = predicate(node.item);
    if (!selfMatches && keptChildren.length === 0) return null;
    return { ...node, children: keptChildren };
  };
  return roots.map(visit).filter((n): n is HierarchyNode<T> => n !== null);
}
