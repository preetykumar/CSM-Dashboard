import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle, Search, DollarSign, FileText } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { isClosedWon } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { Badge } from './renewal/Badge';
import { SortHeader } from './renewal/SortHeader';

export const ClosedWonView: React.FC = () => {
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
      setOpportunities(transformed.filter(opp => isClosedWon(opp.stage)));
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

  const totalWonValue = useMemo(() => opportunities.reduce((sum, opp) => sum + opp.amount, 0), [opportunities]);

  function handleSort(field: SortField) {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc'
    }));
  }

  if (loading) {
    return <div className="renewal-loading"><div className="loading-spinner" /><p>Loading closed won renewals...</p></div>;
  }
  if (error) {
    return <div className="renewal-loading"><p>Error: {error}</p><button onClick={loadData} className="btn btn-primary">Retry</button></div>;
  }

  return (
    <div className="renewal-view">
      {/* Header */}
      <div className="renewal-filter-bar">
        <div className="renewal-search-wrapper">
          <Search size={16} className="renewal-search-icon" />
          <input
            type="text"
            placeholder="Search accounts, AEs, CSMs..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="renewal-search-input"
          />
        </div>
        <div className="renewal-filter-buttons">
          <label>Lookahead:</label>
          <select value={daysAhead} onChange={e => setDaysAhead(Number(e.target.value))} className="renewal-search-input" style={{ width: 'auto', paddingLeft: '12px' }}>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="renewal-stats-grid">
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon green"><CheckCircle size={20} /></div>
            <div>
              <p className="renewal-stat-value">{opportunities.length}</p>
              <p className="renewal-stat-label">Closed Won</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon green"><DollarSign size={20} /></div>
            <div>
              <p className="renewal-stat-value">{formatCurrency(totalWonValue)}</p>
              <p className="renewal-stat-label">Total Won Value</p>
            </div>
          </div>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="renewal-empty-state">
          <FileText size={32} />
          <p>No closed won renewals found in the selected time range.</p>
        </div>
      ) : (
        <div className="renewal-table-container">
          <table className="renewal-table">
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
                  <td className="renewal-cell-account">{opp.companyName}</td>
                  <td>{opp.ownerName || '-'}</td>
                  <td className="renewal-cell-opp-name">{opp.opportunityName}</td>
                  <td>{opp.productName}</td>
                  <td>{opp.csmName || '-'}</td>
                  <td>{opp.prsName || '-'}</td>
                  <td><Badge variant="success">{opp.stage}</Badge></td>
                  <td className="renewal-cell-amount">{formatCurrency(opp.amount)}</td>
                  <td className="renewal-cell-date">{new Date(opp.renewalDate).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
