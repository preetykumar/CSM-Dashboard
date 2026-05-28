import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle, Search, DollarSign, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { isClosedWon } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { OpportunityCard } from './renewal/OpportunityCard';
import { useAccountHierarchy } from '../hooks/useAccountHierarchy';
import { nestOppsByAccount } from '../lib/nestOppsByAccount';
import { HierarchyList } from './HierarchyList';

export const ClosedWonView: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [daysAhead, setDaysAhead] = useState(365);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const toggleAccount = (id: string) => setExpandedAccounts((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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

  // Account hierarchy nesting: opps grouped by account → accounts nested
  // by SF parent → child. Phantom parent rows (no own opps) appear when an
  // opp's parent isn't already in the filtered set, so the family tree is
  // always complete.
  const { hierarchy } = useAccountHierarchy();
  const accountTree = useMemo(() => nestOppsByAccount(sorted, hierarchy), [sorted, hierarchy]);

  if (loading) {
    return <div className="renewal-loading"><div className="loading-spinner" /><p>Loading closed won renewals...</p></div>;
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
          <label htmlFor="closed-won-sort-field" className="renewal-sort-label">Sort by</label>
          <select id="closed-won-sort-field" className="renewal-sort-select" value={sortConfig.field} onChange={(e) => setSortConfig({ field: e.target.value as SortField, direction: 'asc' })}>
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
        <div className="renewal-opp-list">
          <HierarchyList
            roots={accountTree}
            renderItem={(group, { depth }) => {
              const isExpanded = expandedAccounts.has(group.accountId);
              const isChild = depth > 0;
              return (
                <div className={`renewal-account-card${group.isPhantom ? ' is-phantom' : ''}${isChild ? ' is-child' : ''}`}>
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
                      <span className="renewal-account-phantom-tag" title="No closed-won opportunities for this account itself; shown to anchor its children">parent (no own opps)</span>
                    ) : (
                      <span className="renewal-account-meta">
                        <span>{group.oppCount} {group.oppCount === 1 ? 'opp' : 'opps'}</span>
                        <span className="renewal-account-amount">{formatCurrency(group.totalAmount)}</span>
                      </span>
                    )}
                  </button>
                  {isExpanded && group.opps.length > 0 && (
                    <div className="renewal-account-opps">
                      {group.opps.map((opp, idx) => (
                        <OpportunityCard
                          key={opp.id}
                          opp={opp}
                          index={idx}
                          expanded={expandedOppId === opp.id}
                          onToggle={() => setExpandedOppId(expandedOppId === opp.id ? null : opp.id)}
                          mode="closed-won"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
};
