import React, { useState, useEffect, useMemo } from 'react';
import { XCircle, Search, DollarSign, FileText } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { isClosedLost } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { Badge } from './renewal/Badge';
import { SortHeader } from './renewal/SortHeader';

export const ClosedLostView: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [daysAhead, setDaysAhead] = useState(365);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });

  useEffect(() => {
    loadData();
  }, [daysAhead]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRenewalOpportunities(daysAhead);
      const transformed = response.opportunities.map(transformApiOpportunity);
      setOpportunities(transformed.filter(opp => isClosedLost(opp.stage)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!searchTerm) return opportunities;
    const term = searchTerm.toLowerCase();
    return opportunities.filter(opp =>
      opp.companyName.toLowerCase().includes(term) ||
      opp.opportunityName.toLowerCase().includes(term) ||
      opp.ownerName.toLowerCase().includes(term) ||
      (opp.prsName || '').toLowerCase().includes(term) ||
      (opp.csmName || '').toLowerCase().includes(term)
    );
  }, [opportunities, searchTerm]);

  const sorted = useMemo(() => {
    if (!sortConfig.direction) return filtered;
    return [...filtered].sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      switch (sortConfig.field) {
        case 'companyName': return dir * a.companyName.localeCompare(b.companyName);
        case 'ownerName': return dir * a.ownerName.localeCompare(b.ownerName);
        case 'opportunityName': return dir * a.opportunityName.localeCompare(b.opportunityName);
        case 'productName': return dir * a.productName.localeCompare(b.productName);
        case 'amount': return dir * (a.amount - b.amount);
        case 'renewalDate': return dir * (new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime());
        default: return 0;
      }
    });
  }, [filtered, sortConfig]);

  const totalLostValue = useMemo(() => opportunities.reduce((sum, opp) => sum + opp.amount, 0), [opportunities]);

  function handleSort(field: SortField) {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc'
    }));
  }

  if (loading) {
    return <div className="prs-loading"><div className="loading-spinner" /><p>Loading closed lost renewals...</p></div>;
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
            placeholder="Search accounts, AEs, CSMs..."
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

      {/* Summary Stats */}
      <div className="prs-stats-row">
        <div className="prs-stat">
          <XCircle size={16} />
          <span className="prs-stat-value">{opportunities.length}</span>
          <span className="prs-stat-label">Closed Lost</span>
        </div>
        <div className="prs-stat">
          <DollarSign size={16} />
          <span className="prs-stat-value">{formatCurrency(totalLostValue)}</span>
          <span className="prs-stat-label">Total Lost Value</span>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="prs-empty">
          <FileText size={32} />
          <p>No closed lost renewals found in the selected time range.</p>
        </div>
      ) : (
        <div className="prs-table-container">
          <table className="prs-table">
            <thead>
              <tr>
                <SortHeader field="companyName" label="Account" sortConfig={sortConfig} onSort={handleSort} />
                <SortHeader field="ownerName" label="AE" sortConfig={sortConfig} onSort={handleSort} />
                <SortHeader field="opportunityName" label="Opp Name" sortConfig={sortConfig} onSort={handleSort} />
                <SortHeader field="productName" label="Product" sortConfig={sortConfig} onSort={handleSort} />
                <th>CSM</th>
                <th>PRS</th>
                <th>Stage</th>
                <SortHeader field="amount" label="Total Price" sortConfig={sortConfig} onSort={handleSort} />
                <SortHeader field="renewalDate" label="Renewal Date" sortConfig={sortConfig} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(opp => (
                <tr key={opp.id}>
                  <td className="prs-cell-account">{opp.companyName}</td>
                  <td>{opp.ownerName || '-'}</td>
                  <td className="prs-cell-opp-name">{opp.opportunityName}</td>
                  <td>{opp.productName}</td>
                  <td>{opp.csmName || '-'}</td>
                  <td>{opp.prsName || '-'}</td>
                  <td><Badge variant="danger">{opp.stage}</Badge></td>
                  <td className="prs-cell-amount">{formatCurrency(opp.amount)}</td>
                  <td className="prs-cell-date">{new Date(opp.renewalDate).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
