import { useState, useEffect, useMemo } from "react";
import { fetchRenewalOpportunities } from "../services/api";
import { transformApiOpportunity, type Opportunity } from "../types/renewal";
import { formatCurrency } from "../utils/format";
import { RenewalAccountTree } from "./renewal/RenewalAccountTree";

export function OverdueRenewalsView() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);

  useEffect(() => {
    fetchRenewalOpportunities(365)
      .then((data) => {
        const transformed = data.opportunities.map(transformApiOpportunity);
        setOpportunities(transformed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Filter to overdue: renewal date < today, not Closed Won, not Closed Lost
  const overdueOpps = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return opportunities.filter((o) => {
      const stage = o.stage.toLowerCase();
      return o.renewalDate < today && !stage.includes("closed won") && !stage.includes("closed lost");
    });
  }, [opportunities]);

  // Sort overdue opps by days-overdue desc (so the most stale percolate up
  // inside each account row when expanded).
  const sortedOverdueOpps = useMemo(
    () =>
      [...overdueOpps].sort(
        (a, b) => new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime()
      ),
    [overdueOpps]
  );

  // Summary stats
  const totalOverdue = overdueOpps.length;
  const totalValue = overdueOpps.reduce((sum, o) => sum + (o.amount || 0), 0);
  const uniqueAccounts = new Set(overdueOpps.map((o) => o.accountId || o.companyName)).size;

  if (loading) {
    return (
      <div className="renewal-view">
        <div className="renewal-loading"><div className="spinner" /><span>Loading renewals...</span></div>
      </div>
    );
  }

  if (error) {
    return <div className="renewal-view"><div className="error">{error}</div></div>;
  }

  return (
    <div className="renewal-view">
      {/* Title + subtitle live in App.tsx getHintText() so every Renewals
          sub-tab gets the same header treatment. No per-view <h2> here. */}

      <div className="renewal-stats-grid">
        <div className="renewal-stat-card at-risk">
          <div className="renewal-stat-content">
            <div><p className="renewal-stat-value">{totalOverdue}</p><p className="renewal-stat-label">Overdue Renewals</p></div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div><p className="renewal-stat-value">{formatCurrency(totalValue)}</p><p className="renewal-stat-label">Total Value at Risk</p></div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div><p className="renewal-stat-value">{uniqueAccounts}</p><p className="renewal-stat-label">Accounts</p></div>
          </div>
        </div>
      </div>

      {overdueOpps.length === 0 ? (
        <div className="renewal-empty">
          <p>No overdue renewals found.</p>
        </div>
      ) : (
        <div className="renewal-opp-list">
          <RenewalAccountTree
            opps={sortedOverdueOpps}
            mode="overdue"
            expandedOppId={expandedOppId}
            setExpandedOppId={setExpandedOppId}
          />
        </div>
      )}
    </div>
  );
}

