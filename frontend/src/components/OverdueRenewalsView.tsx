import { useState, useEffect, useMemo } from "react";
import { fetchRenewalOpportunities } from "../services/api";
import { transformApiOpportunity, type Opportunity } from "../types/renewal";
import { Badge } from "./renewal/Badge";
import { getStageBadgeVariant } from "../services/workflow-engine";
import { formatCurrency } from "../utils/format";

export function OverdueRenewalsView() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

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

  // Group by month
  const monthlyGroups = useMemo(() => {
    const groups = new Map<string, Opportunity[]>();
    for (const opp of overdueOpps) {
      const month = opp.renewalDate.substring(0, 7); // YYYY-MM
      const existing = groups.get(month) || [];
      existing.push(opp);
      groups.set(month, existing);
    }
    // Sort months descending (most recent first)
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, opps]) => ({
        month,
        label: formatMonth(month),
        opps: opps.sort((a, b) => (b.amount || 0) - (a.amount || 0)),
        totalValue: opps.reduce((sum, o) => sum + (o.amount || 0), 0),
        count: opps.length,
      }));
  }, [overdueOpps]);

  // Summary stats
  const totalOverdue = overdueOpps.length;
  const totalValue = overdueOpps.reduce((sum, o) => sum + (o.amount || 0), 0);

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
      <div className="renewal-header">
        <h2>Overdue Renewals</h2>
        <p className="renewal-subtitle">Renewals past their close date that have not been closed won or lost</p>
      </div>

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
            <div><p className="renewal-stat-value">{monthlyGroups.length}</p><p className="renewal-stat-label">Months with Overdue</p></div>
          </div>
        </div>
      </div>

      {monthlyGroups.length === 0 ? (
        <div className="renewal-empty">
          <p>No overdue renewals found.</p>
        </div>
      ) : (
        <div className="overdue-months">
          {monthlyGroups.map(({ month, label, opps, totalValue: monthValue, count }) => {
            const isExpanded = expandedMonth === month;
            return (
              <div key={month} className={`overdue-month-card ${isExpanded ? "expanded" : ""}`}>
                <div
                  className="overdue-month-header"
                  onClick={() => setExpandedMonth(isExpanded ? null : month)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedMonth(isExpanded ? null : month); } }}
                  aria-expanded={isExpanded}
                >
                  <div className="overdue-month-info">
                    <h3>{label}</h3>
                    <span className="overdue-month-stats">
                      {count} renewal{count !== 1 ? "s" : ""} &middot; {formatCurrency(monthValue)}
                    </span>
                  </div>
                  <span className="expand-icon">{isExpanded ? "\u25BC" : "\u25B6"}</span>
                </div>

                {isExpanded && (
                  <div className="overdue-month-body">
                    <div className="renewal-table-container">
                      <table className="renewal-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Account</th>
                            <th>AE</th>
                            <th>Opportunity</th>
                            <th>Product</th>
                            <th>CSM</th>
                            <th>Stage</th>
                            <th>Amount</th>
                            <th>Renewal Date</th>
                            <th>Days Overdue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opps.map((opp, idx) => {
                            const daysOverdue = Math.floor((Date.now() - new Date(opp.renewalDate).getTime()) / (1000 * 60 * 60 * 24));
                            return (
                              <tr key={opp.id} className="renewal-opp-row">
                                <td className="row-number-cell">{idx + 1}</td>
                                <td className="renewal-account-cell">{opp.companyName}</td>
                                <td>{opp.ownerName || "-"}</td>
                                <td>{opp.opportunityName}</td>
                                <td>{opp.productName}</td>
                                <td>{opp.csmName || "Unassigned"}</td>
                                <td><Badge variant={getStageBadgeVariant(opp.stage)}>{opp.stage}</Badge></td>
                                <td className="renewal-amount-cell">{formatCurrency(opp.amount || 0)}</td>
                                <td>{new Date(opp.renewalDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                                <td><span className={`overdue-days ${daysOverdue > 30 ? "critical" : daysOverdue > 14 ? "warning" : ""}`}>{daysOverdue}d</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split("-");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[parseInt(month) - 1]} ${year}`;
}
