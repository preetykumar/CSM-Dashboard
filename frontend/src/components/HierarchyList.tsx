// Generic recursive renderer for an account-hierarchy tree. Each view
// supplies its own renderItem function — this component just handles the
// recursive walk and depth-based indentation.

import type { ReactNode } from "react";
import type { HierarchyNode } from "../lib/nestByHierarchy";

interface Props<T extends { accountId: string; accountName: string }> {
  roots: HierarchyNode<T>[];
  renderItem: (item: T, ctx: { depth: number; hasChildren: boolean }) => ReactNode;
  // Indentation per depth level, in px. Default 24px.
  indentPx?: number;
  // Optional className to apply to each row wrapper.
  rowClassName?: string;
}

export function HierarchyList<T extends { accountId: string; accountName: string }>({
  roots,
  renderItem,
  indentPx = 24,
  rowClassName = "",
}: Props<T>) {
  const renderNode = (node: HierarchyNode<T>, depth: number): ReactNode => (
    <div
      key={node.item.accountId}
      className={`hierarchy-row${depth > 0 ? " is-child" : ""}${rowClassName ? " " + rowClassName : ""}`}
      style={{ marginLeft: depth * indentPx }}
      data-depth={depth}
    >
      {renderItem(node.item, { depth, hasChildren: node.children.length > 0 })}
      {node.children.length > 0 && (
        <div className="hierarchy-children">
          {node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )}
    </div>
  );

  return <>{roots.map((r) => renderNode(r, 0))}</>;
}
