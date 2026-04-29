import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, FileText, Calendar, DollarSign, Search, ChevronRight } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine, isClosedLost, isClosedWon } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { OpportunityCard } from './renewal/OpportunityCard';

interface MonthlyRenewalGroup {
  monthKey: string;
  monthLabel: string;
  opportunities: Opportunity[];
  totalValue: number;
  urgentCount: number;
}

function groupByMonth(opportunities: Opportunity[]): MonthlyRenewalGroup[] {
  const monthMap = new Map<string, Opportunity[]>();
  for (const opp of opportunities) {
    const date = new Date(opp.renewalDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;
    const existing = monthMap.get(monthKey) || [];
    existing.push(opp);
    monthMap.set(monthKey, existing);
  }
  return Array.from(monthMap.entries())
    .map(([monthKey, opps]) => {
      const date = new Date(opps[0].renewalDate);
      const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const totalValue = opps.reduce((sum, o) => sum + (o.amount || 0), 0);
      const urgentCount = opps.filter(o => WorkflowEngine.getRequiredActions(o).length > 0).length;
      return { monthKey, monthLabel, opportunities: opps, totalValue, urgentCount };
    })
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

interface MonthCardProps {
  group: MonthlyRenewalGroup;
  expanded: boolean;
  onToggle: () => void;
  sortConfig: SortConfig;
}

const MonthCard: React.FC<MonthCardProps> = ({ group, expanded, onToggle, sortConfig }) => {
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);
  const sortedOpportunities = useMemo(() => {
    if (!sortConfig.direction) return group.opportunities;
    return [...group.opportunities].sort((a, b) => {
      let comparison = 0;
      switch (sortConfig.field) {
        case 'opportunityName': comparison = a.opportunityName.localeCompare(b.opportunityName); break;
        case 'productName': comparison = a.productName.localeCompare(b.productName); break;
        case 'stage': comparison = a.stage.localeCompare(b.stage); break;
        case 'renewalStatus': comparison = (a.renewalStatus || '').localeCompare(b.renewalStatus || ''); break;
        case 'accountingRenewalStatus': comparison = (a.accountingRenewalStatus || '').localeCompare(b.accountingRenewalStatus || ''); break;
        case 'poRequired': comparison = (a.poRequired ? 1 : 0) - (b.poRequired ? 1 : 0); break;
        case 'amount': comparison = (a.amount || 0) - (b.amount || 0); break;
        case 'renewalDate': comparison = new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime(); break;
        case 'companyName': comparison = a.companyName.localeCompare(b.companyName); break;
        case 'ownerName': comparison = (a.ownerName || '').localeCompare(b.ownerName || ''); break;
        case 'action': {
          const actionsA = WorkflowEngine.getRequiredActions(a);
          const actionsB = WorkflowEngine.getRequiredActions(b);
          const priorityOrder = { critical: 0, urgent: 1, high: 2, medium: 3 };
          comparison = (actionsA[0] ? priorityOrder[actionsA[0].priority] : 4) - (actionsB[0] ? priorityOrder[actionsB[0].priority] : 4);
          break;
        }
      }
      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  }, [group.opportunities, sortConfig]);

  return (
    <div className={`prs-card ${expanded ? 'expanded' : ''}`}>
      <div className="prs-card-header" onClick={onToggle}>
        <div className="prs-card-left">
          <ChevronRight className={`prs-chevron ${expanded ? 'expanded' : ''}`} size={20} />
          <div className="prs-avatar"><Calendar size={20} /></div>
          <div className="prs-info"><h3 className="prs-name">{group.monthLabel}</h3></div>
        </div>
        <div className="prs-card-stats">
          <div className="prs-stat"><span className="prs-stat-value">{group.opportunities.length}</span><span className="prs-stat-label">Renewals</span></div>
          <div className="prs-stat"><span className="prs-stat-value">{formatCurrency(group.totalValue)}</span><span className="prs-stat-label">Total Value</span></div>
          {group.urgentCount > 0 && (<div className="prs-stat urgent"><span className="prs-stat-value">{group.urgentCount}</span><span className="prs-stat-label">Urgent</span></div>)}
        </div>
      </div>
      {expanded && (
        <div className="prs-card-content">
          <div className="renewal-opp-list">
            {sortedOpportunities.map((opp, idx) => (
              <OpportunityCard
                key={opp.id}
                opp={opp}
                index={idx}
                expanded={expandedOppId === opp.id}
                onToggle={() => setExpandedOppId(expandedOppId === opp.id ? null : opp.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DAYS_OPTIONS = [30, 60, 90, 120, 180] as const;

export function MonthlyRenewalView() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(180);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);


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

  const monthlyGroups = useMemo(() => {
    let filtered = opportunities.filter(opp => {
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
    return groupByMonth(filtered);
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

      <div className="prs-list">
        {monthlyGroups.map(group => (
          <MonthCard key={group.monthKey} group={group} expanded={expandedMonth === group.monthKey} onToggle={() => setExpandedMonth(expandedMonth === group.monthKey ? null : group.monthKey)} sortConfig={sortConfig} />
        ))}
        {monthlyGroups.length === 0 && (<div className="renewal-empty"><FileText size={48} className="renewal-empty-icon" /><p>No renewal opportunities found</p></div>)}
      </div>

    </div>
  );
}
