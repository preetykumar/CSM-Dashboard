import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, FileText, Calendar, DollarSign, Search } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine, isClosedLost, isClosedWon } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { RenewalAccountTree } from './renewal/RenewalAccountTree';
import { useEmailComposer } from '../hooks/useEmailComposer';

const DAYS_OPTIONS = [30, 60, 90, 120, 180] as const;

export function MonthlyRenewalView() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(180);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);
  const { openComposer, composer } = useEmailComposer();


  useEffect(() => {
    async function loadOpportunities() {
      try {
        setLoading(true);
        const response = await fetchRenewalOpportunities(daysAhead);
        const opps = response.opportunities.map(transformApiOpportunity)
          .filter(opp => !isClosedLost(opp.stage) && !isClosedWon(opp.stage));
        setOpportunities(opps);
      } catch (err) {
        console.error('Failed to fetch renewal opportunities:', err);
        setError(err instanceof Error ? err.message : 'Failed to load renewals');
      } finally {
        setLoading(false);
      }
    }
    loadOpportunities();
  }, [daysAhead]);

  // Apply search + urgent filter. Per the hierarchy redesign, accounts are
  // now the primary grouping; the previous month grouping is dropped in
  // favor of per-account opp rows. Opps inside each account stay sorted
  // by close date so the time-ordering signal isn't lost.
  const filteredOpps = useMemo(() => {
    const filtered = opportunities.filter(opp => {
      const matchesSearch = opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (opp.csmName || '').toLowerCase().includes(searchQuery.toLowerCase());
      if (filter === 'all') return matchesSearch;
      if (filter === 'urgent') {
        return matchesSearch && WorkflowEngine.getRequiredActions(opp).length > 0;
      }
      return matchesSearch;
    });
    return [...filtered].sort((a, b) =>
      new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime()
    );
  }, [opportunities, searchQuery, filter]);

  const { totalValue, urgentCount, uniqueAccounts } = useMemo(() => {
    const total = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const urgent = opportunities.filter(opp => WorkflowEngine.getRequiredActions(opp).length > 0).length;
    const accounts = new Set(opportunities.map(opp => opp.accountId)).size;
    return {
      totalValue: total, urgentCount: urgent, uniqueAccounts: accounts,
    };
  }, [opportunities]);

  if (loading) {
    return (<div className="prs-view"><div className="usage-loading-spinner"><div className="spinner" /><span className="spinner-text">Loading renewal opportunities...</span></div></div>);
  }
  if (error) {
    return (<div className="prs-view"><div className="error">{error}</div></div>);
  }

  return (
    <div className="prs-view">

      <div className="renewal-stats-grid">
        <div className={`renewal-stat-card clickable ${filter === 'all' ? 'active-filter' : ''}`} onClick={() => setFilter('all')} style={{ cursor: 'pointer' }}><div className="renewal-stat-content"><div className="renewal-stat-icon slate"><FileText size={20} /></div><div><p className="renewal-stat-value">{opportunities.length}</p><p className="renewal-stat-label">Total Renewals</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon blue"><Calendar size={20} /></div><div><p className="renewal-stat-value">{uniqueAccounts}</p><p className="renewal-stat-label">Accounts</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon green"><DollarSign size={20} /></div><div><p className="renewal-stat-value">{formatCurrency(totalValue)}</p><p className="renewal-stat-label">Total Value</p></div></div></div>
        <div className={`renewal-stat-card clickable ${filter === 'urgent' ? 'active-filter' : ''}`} onClick={() => setFilter('urgent')} style={{ cursor: 'pointer' }}><div className="renewal-stat-content"><div className="renewal-stat-icon red"><AlertTriangle size={20} /></div><div><p className="renewal-stat-value">{urgentCount}</p><p className="renewal-stat-label">Needs Action</p></div></div></div>
      </div>

      <div className="renewal-card">
        <div className="renewal-filter-bar">
          <div className="renewal-search-wrapper">
            <Search size={16} className="renewal-search-icon" />
            <input type="text" placeholder="Search by account, opportunity, product, or CSM name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="renewal-search-input" />
          </div>
          <div className="renewal-days-picker">
            <span className="renewal-days-label">Next</span>
            {DAYS_OPTIONS.map(days => (<button key={days} onClick={() => setDaysAhead(days)} className={`renewal-days-btn ${daysAhead === days ? 'active' : ''}`}>{days} days</button>))}
          </div>
          <div className="renewal-sort-control">
            <label htmlFor="monthly-sort-field" className="renewal-sort-label">Sort by</label>
            <select id="monthly-sort-field" className="renewal-sort-select" value={sortConfig.field} onChange={(e) => setSortConfig({ field: e.target.value as SortField, direction: 'asc' })}>
              <option value="renewalDate">Renewal Date</option>
              <option value="companyName">Account</option>
              <option value="amount">Amount</option>
              <option value="stage">Stage</option>
              <option value="action">Action Priority</option>
            </select>
            <button type="button" className="renewal-sort-direction" onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'desc' ? 'asc' : 'desc' }))} aria-label={`Toggle sort direction, currently ${sortConfig.direction || 'asc'}`}>
              {sortConfig.direction === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          <div className="renewal-filter-buttons">
            <button onClick={() => setFilter('all')} className={`renewal-filter-btn ${filter === 'all' ? 'active' : ''}`}>All ({opportunities.length})</button>
            <button onClick={() => setFilter('urgent')} className={`renewal-filter-btn urgent ${filter === 'urgent' ? 'active' : ''}`}>Needs Action ({urgentCount})</button>
          </div>
        </div>
      </div>

      <div className="renewal-opp-list">
        {filteredOpps.length === 0 ? (
          <div className="renewal-empty"><FileText size={48} className="renewal-empty-icon" /><p>No renewal opportunities found</p></div>
        ) : (
          <RenewalAccountTree
            opps={filteredOpps}
            mode="active"
            expandedOppId={expandedOppId}
            setExpandedOppId={setExpandedOppId}
            onDraftEmail={openComposer}
          />
        )}
      </div>
      {composer}
    </div>
  );
}
