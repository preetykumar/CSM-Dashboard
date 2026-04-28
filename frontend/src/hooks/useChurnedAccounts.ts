import { useEffect, useMemo, useState } from "react";
import { fetchRenewalOpportunities } from "../services/api";
import { transformApiOpportunity, type Opportunity } from "../types/renewal";
import { isClosedLost } from "../services/workflow-engine";

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
        const churn = transformed.filter(
          (opp) =>
            isClosedLost(opp.stage) &&
            opp.renewalDate >= earliest &&
            opp.renewalDate <= latest
        );
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
