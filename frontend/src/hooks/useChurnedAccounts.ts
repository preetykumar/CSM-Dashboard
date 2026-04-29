import { useEffect, useMemo, useState } from "react";
import { fetchRenewalOpportunities } from "../services/api";
import { transformApiOpportunity, type Opportunity } from "../types/renewal";
import { isClosedLost, isClosedWon } from "../services/workflow-engine";

export interface QuarterRange {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  startISO: string;
  endISO: string;
}

export function getLastTwoQuarters(today: Date = new Date()): QuarterRange[] {
  const month = today.getMonth();
  const year = today.getFullYear();
  const currentQ = Math.floor(month / 3);

  const ranges: QuarterRange[] = [];
  for (let i = 2; i >= 1; i--) {
    let q = currentQ - i;
    let y = year;
    while (q < 0) {
      q += 4;
      y -= 1;
    }
    const startMonth = q * 3;
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 3, 0);
    ranges.push({
      year: y,
      quarter: (q + 1) as 1 | 2 | 3 | 4,
      label: `Q${q + 1} ${y}`,
      startISO: start.toISOString().split("T")[0],
      endISO: end.toISOString().split("T")[0],
    });
  }
  return ranges;
}

export interface UseChurnedAccountsResult {
  loading: boolean;
  error: string | null;
  opportunities: Opportunity[];
  quarters: QuarterRange[];
  churnedAccountIds: Set<string>;
  churnedAccountNames: Set<string>;
}

export function useChurnedAccounts(): UseChurnedAccountsResult {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const quarters = useMemo(() => getLastTwoQuarters(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const response = await fetchRenewalOpportunities(365);
        const transformed = response.opportunities.map(transformApiOpportunity);
        const earliest = quarters[0].startISO;
        const latest = quarters[quarters.length - 1].endISO;

        // Account is churned only if it has a Closed Lost renewal in the
        // last-2-quarters window AND no Closed Won renewal anywhere in the
        // fetched data (which spans 2026-01-01 onward + 365 days). This nets
        // out cases like a "DevTools for Web Increase" expansion that closed
        // lost while the core renewal closed won shortly after.
        const wonAccountIds = new Set<string>();
        const wonAccountNames = new Set<string>();
        for (const opp of transformed) {
          if (isClosedWon(opp.stage)) {
            if (opp.accountId) wonAccountIds.add(opp.accountId);
            if (opp.companyName) wonAccountNames.add(opp.companyName.toLowerCase());
          }
        }

        const churn = transformed.filter((opp) => {
          if (!isClosedLost(opp.stage)) return false;
          if (opp.renewalDate < earliest || opp.renewalDate > latest) return false;
          const renewedById = opp.accountId && wonAccountIds.has(opp.accountId);
          const renewedByName =
            opp.companyName && wonAccountNames.has(opp.companyName.toLowerCase());
          return !renewedById && !renewedByName;
        });
        if (!cancelled) setOpportunities(churn);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load churn data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [quarters]);

  const { churnedAccountIds, churnedAccountNames } = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const opp of opportunities) {
      if (opp.accountId) ids.add(opp.accountId);
      if (opp.companyName) names.add(opp.companyName.toLowerCase());
    }
    return { churnedAccountIds: ids, churnedAccountNames: names };
  }, [opportunities]);

  return { loading, error, opportunities, quarters, churnedAccountIds, churnedAccountNames };
}
