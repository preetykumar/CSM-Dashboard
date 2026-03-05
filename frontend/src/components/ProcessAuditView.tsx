import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Search, FileText } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, OverdueItem } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function groupByPRS(items: OverdueItem[]): [string, OverdueItem[]][] {
  const groups = new Map<string, OverdueItem[]>();
  for (const item of items) {
    const prs = item.opportunity.prsName || 'Unassigned';
    if (!groups.has(prs)) groups.set(prs, []);
    groups.get(prs)!.push(item);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}

export const ProcessAuditView: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [daysAhead, setDaysAhead] = useState(365);

  useEffect(() => {
    loadData();
  }, [daysAhead]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRenewalOpportunities(daysAhead);
      setOpportunities(response.opportunities.map(transformApiOpportunity));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  const auditItems = useMemo(() => {
    const items: OverdueItem[] = [];
    for (const opp of opportunities) {
      items.push(...WorkflowEngine.getStaleAuditItems(opp));
    }
    return items;
  }, [opportunities]);

  const filtered = useMemo(() => {
    if (!searchTerm) return auditItems;
    const term = searchTerm.toLowerCase();
    return auditItems.filter(item =>
      item.opportunity.companyName.toLowerCase().includes(term) ||
      item.opportunity.ownerName.toLowerCase().includes(term) ||
      (item.opportunity.prsName || '').toLowerCase().includes(term) ||
      item.opportunity.productName.toLowerCase().includes(term)
    );
  }, [auditItems, searchTerm]);

  const prsGroups = useMemo(() => groupByPRS(filtered), [filtered]);

  const totalAuditValue = useMemo(
    () => auditItems.reduce((sum, item) => sum + item.opportunity.amount, 0),
    [auditItems]
  );

  if (loading) {
    return <div className="prs-loading"><div className="loading-spinner" /><p>Loading process audit data...</p></div>;
  }
  if (error) {
    return <div className="prs-error"><p>Error: {error}</p><button onClick={loadData} className="prs-retry-btn">Retry</button></div>;
  }

  return (
    <div className="prs-renewal-view">
      {/* Header */}
      <div className="prs-controls">
        <div className="prs-search-container">
          <Search size={16} className="prs-search-icon" />
          <input
            type="text"
            placeholder="Search accounts, AEs, PRS..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="prs-search-input"
          />
        </div>
        <div className="prs-filter-group">
          <label>Lookahead:</label>
          <select value={daysAhead} onChange={e => setDaysAhead(Number(e.target.value))} className="prs-select">
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="prs-stats-row">
        <div className="prs-stat">
          <AlertTriangle size={16} />
          <span className="prs-stat-value">{auditItems.length}</span>
          <span className="prs-stat-label">Stale R-6 Actions (&gt;5 months overdue)</span>
        </div>
        <div className="prs-stat">
          <span className="prs-stat-value">{formatCurrency(totalAuditValue)}</span>
          <span className="prs-stat-label">Total Value at Risk</span>
        </div>
      </div>

      <p className="prs-hint" style={{ margin: '0 0 16px', color: '#666', fontSize: '13px' }}>
        These renewals missed the R-6 email milestone more than 5 months ago. They are excluded from the
        actionable overdue banner and listed here for process review.
      </p>

      {auditItems.length === 0 ? (
        <div className="prs-empty">
          <FileText size={32} />
          <p>No stale audit items found. All R-6 actions are within the actionable window.</p>
        </div>
      ) : (
        prsGroups.map(([prsName, items]) => (
          <div key={prsName} className="prs-group" style={{ marginBottom: '24px' }}>
            <div className="prs-group-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: '2px solid #e5e7eb' }}>
              <span style={{ fontWeight: 600 }}>{prsName}</span>
              <span style={{ color: '#666', fontSize: '13px' }}>{items.length} audit items</span>
            </div>
            <div className="prs-table-container">
              <table className="prs-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>AE</th>
                    <th>Product</th>
                    <th>Milestone</th>
                    <th>Description</th>
                    <th>Due Date</th>
                    <th>Days Past Due</th>
                    <th>Total Price</th>
                    <th>Renewal Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={`${item.opportunity.id}-${idx}`}>
                      <td className="prs-cell-account">{item.opportunity.companyName}</td>
                      <td>{item.opportunity.ownerName || '-'}</td>
                      <td>{item.opportunity.productName}</td>
                      <td><span className="overdue-milestone R-6">{item.milestone}</span></td>
                      <td>{item.action.description}</td>
                      <td className="prs-cell-date">{formatDate(item.dueDate)}</td>
                      <td><span className="overdue-days severe">{item.daysPastDue} days</span></td>
                      <td className="prs-cell-amount">{formatCurrency(item.opportunity.amount)}</td>
                      <td className="prs-cell-date">{new Date(item.opportunity.renewalDate).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
