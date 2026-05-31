// Shared account-primary renderer for Renewals views (Closed Won, Closed
// Lost, Overdue, Monthly, Quarterly, By CSM, By Specialist, Upcoming,
// Process Audit). All those views share the same nesting pattern:
//
//   Account A
//     ├─ opp 1, opp 2 …            (OpportunityCard rendered inside)
//     └─ Account A-child (nested)
//   Account B
//   …
//
// Phantom parent rows (no own opps) appear when an opp's parent isn't in
// the dataset, per the user's "show empty parents as grouping headers"
// product decision.

import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useAccountHierarchy } from "../../hooks/useAccountHierarchy";
import { nestOppsByAccount } from "../../lib/nestOppsByAccount";
import { HierarchyList } from "../HierarchyList";
import { OpportunityCard } from "./OpportunityCard";
import { formatCurrency } from "../../utils/format";
import { fetchAccountArrBatch } from "../../services/api";
import type { Opportunity, RequiredAction } from "../../types/renewal";

interface Props {
  opps: Opportunity[];
  mode: "closed-won" | "closed-lost" | "active" | "overdue";
  // Optional: caller-controlled OpportunityCard expansion state. If omitted,
  // each tree manages its own. Useful when the outer view wants to remember
  // which opp is open across re-renders.
  expandedOppId?: string | null;
  setExpandedOppId?: (id: string | null) => void;
  // Optional sub-header for each account body (e.g., to surface a CSM name
  // when in ByCSM view, or a month label when in Monthly view).
  renderAccountSubheader?: (group: { accountId: string; opps: Opportunity[] }) => ReactNode;
  // Optional: callback for the "Draft Email" button on active-mode cards.
  // When omitted, OpportunityCard suppresses the button. Wire to
  // useEmailComposer().openComposer to restore the R-6/R-3 email flow.
  onDraftEmail?: (opp: Opportunity, action: RequiredAction) => void;
}

export function RenewalAccountTree({
  opps,
  mode,
  expandedOppId: externalOppId,
  setExpandedOppId: externalSetOppId,
  renderAccountSubheader,
  onDraftEmail,
}: Props) {
  const { hierarchy } = useAccountHierarchy();
  const accountTree = useMemo(() => nestOppsByAccount(opps, hierarchy), [opps, hierarchy]);

  // Bulk-fetch current ARR for every account in view so each opp card can
  // show "current ARR" alongside the renewal opp Amount. One call per
  // distinct accountId set per mount; cached server-side for 10 min.
  const accountIds = useMemo(() => {
    const ids = new Set<string>();
    for (const opp of opps) if (opp.accountId) ids.add(opp.accountId);
    return Array.from(ids);
  }, [opps]);
  const [arrByAccount, setArrByAccount] = useState<Record<string, number>>({});
  useEffect(() => {
    if (accountIds.length === 0) return;
    let cancelled = false;
    fetchAccountArrBatch(accountIds)
      .then((data) => {
        if (!cancelled) setArrByAccount(data);
      })
      .catch(() => {
        // Quiet fallback — empty map means cards just won't show ARR.
      });
    return () => {
      cancelled = true;
    };
  }, [accountIds]);

  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const toggleAccount = useCallback(
    (id: string) =>
      setExpandedAccounts((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );

  const [internalOppId, setInternalOppId] = useState<string | null>(null);
  const expandedOppId = externalOppId !== undefined ? externalOppId : internalOppId;
  const setExpandedOppId = externalSetOppId || setInternalOppId;

  return (
    <HierarchyList
      roots={accountTree}
      renderItem={(group, { depth }) => {
        const isExpanded = expandedAccounts.has(group.accountId);
        const isChild = depth > 0;
        return (
          <div className={`renewal-account-card${group.isPhantom ? " is-phantom" : ""}${isChild ? " is-child" : ""}`}>
            <button
              type="button"
              className="renewal-account-header"
              onClick={() => toggleAccount(group.accountId)}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="renewal-account-name">{group.accountName}</span>
              {isChild && <span className="child-account-pill">child</span>}
              {group.isPhantom ? (
                <span className="renewal-account-phantom-tag" title="No opportunities for this account itself; shown to anchor its children">parent (no own opps)</span>
              ) : (
                <span className="renewal-account-meta">
                  <span>{group.oppCount} {group.oppCount === 1 ? "opp" : "opps"}</span>
                  <span className="renewal-account-amount">{formatCurrency(group.totalAmount)}</span>
                </span>
              )}
            </button>
            {isExpanded && group.opps.length > 0 && (
              <div className="renewal-account-opps">
                {renderAccountSubheader?.({ accountId: group.accountId, opps: group.opps })}
                {group.opps.map((opp, idx) => (
                  <OpportunityCard
                    key={opp.id}
                    opp={opp}
                    index={idx}
                    expanded={expandedOppId === opp.id}
                    onToggle={() => setExpandedOppId(expandedOppId === opp.id ? null : opp.id)}
                    mode={mode}
                    customerArr={opp.accountId ? arrByAccount[opp.accountId] : undefined}
                    onDraftEmail={onDraftEmail}
                  />
                ))}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
