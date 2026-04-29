import React, { useState, useEffect, useMemo } from 'react';
import { XCircle, Search, DollarSign, FileText } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { isClosedLost } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { OpportunityCard } from './renewal/OpportunityCard';

export const ClosedLostView: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [daysAhead, setDaysAhead] = useState(365);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);

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

  if (loading) {
    return <div className="renewal-loading"><div className="loading-spinner" /><p>Loading closed lost renewals...</p></div>;
  }
  if (error) {
    return <div className="renewal-loading"><p>Error: {error}</p><button onClick={loadData} className="btn btn-primary">Retry</button></div>;
  }

  return (
    <div className="renewal-view">
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
        <div className="renewal-sort-control">
          <label htmlFor="closed-lost-sort-field" className="renewal-sort-label">Sort by</label>
          <select id="closed-lost-sort-field" className="renewal-sort-select" value={sortConfig.field} onChange={(e) => setSortConfig({ field: e.target.value as SortField, direction: 'asc' })}>
            <option value="renewalDate">Renewal Date</option>
            <option value="companyName">Account</option>
            <option value="amount">Amount</option>
            <option value="opportunityName">Opportunity</option>
            <option value="productName">Product</option>
          </select>
          <button type="button" className="renewal-sort-direction" onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'desc' ? 'asc' : 'desc' }))} aria-label={`Toggle sort direction, currently ${sortConfig.direction || 'asc'}`}>
            {sortConfig.direction === 'desc' ? '↓' : '↑'}
          </button>
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

      <div className="renewal-stats-grid">
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><XCircle size={20} /></div>
            <div>
              <p className="renewal-stat-value">{opportunities.length}</p>
              <p className="renewal-stat-label">Closed Lost</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><DollarSign size={20} /></div>
            <div>
              <p className="renewal-stat-value">{formatCurrency(totalLostValue)}</p>
              <p className="renewal-stat-label">Total Lost Value</p>
            </div>
          </div>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="renewal-empty-state">
          <FileText size={32} />
          <p>No closed lost renewals found in the selected time range.</p>
        </div>
      ) : (
        <div className="renewal-opp-list">
          {sorted.map((opp, idx) => (
            <OpportunityCard
              key={opp.id}
              opp={opp}
              index={idx}
              expanded={expandedOppId === opp.id}
              onToggle={() => setExpandedOppId(expandedOppId === opp.id ? null : opp.id)}
              mode="closed-lost"
            />
          ))}
        </div>
      )}
    </div>
  );
};
