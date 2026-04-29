import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, FileText, User as UserIcon, DollarSign, X, Search, ChevronRight, XCircle, CheckCircle } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine, isClosedLost, isClosedWon } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { Badge } from './renewal/Badge';
import { OpportunityCard } from './renewal/OpportunityCard';
import { useChurnedAccounts } from '../hooks/useChurnedAccounts';

interface CSMRenewalPortfolio {
  csmName: string;
  csmEmail: string;
  opportunities: Opportunity[];
  totalValue: number;
  urgentCount: number;
}

function groupByCSM(opportunities: Opportunity[]): CSMRenewalPortfolio[] {
  const csmMap = new Map<string, Opportunity[]>();
  for (const opp of opportunities) {
    const key = opp.csmEmail || opp.csmName || 'Unassigned';
    const existing = csmMap.get(key) || [];
    existing.push(opp);
    csmMap.set(key, existing);
  }
  return Array.from(csmMap.entries())
    .map(([email, opps]) => {
      const csmName = opps[0]?.csmName || (email === 'Unassigned' ? 'Unassigned' : email);
      const totalValue = opps.reduce((sum, o) => sum + (o.amount || 0), 0);
      const urgentCount = opps.filter(o => WorkflowEngine.getRequiredActions(o).length > 0).length;
      return { csmName, csmEmail: email, opportunities: opps, totalValue, urgentCount };
    })
    .sort((a, b) => a.csmName.localeCompare(b.csmName));
}

interface CSMCardProps {
  portfolio: CSMRenewalPortfolio;
  expanded: boolean;
  onToggle: () => void;
  isCurrentUser: boolean;
  sortConfig: SortConfig;
}

const CSMCard: React.FC<CSMCardProps> = ({ portfolio, expanded, onToggle, isCurrentUser, sortConfig }) => {
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);
  const sortedOpportunities = useMemo(() => {
    if (!sortConfig.direction) return portfolio.opportunities;
    return [...portfolio.opportunities].sort((a, b) => {
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
  }, [portfolio.opportunities, sortConfig]);

  return (
    <div className={`prs-card ${expanded ? 'expanded' : ''} ${isCurrentUser ? 'current-user' : ''}`}>
      <div className="prs-card-header" onClick={onToggle}>
        <div className="prs-card-left">
          <ChevronRight className={`prs-chevron ${expanded ? 'expanded' : ''}`} size={20} />
          <div className="prs-avatar"><UserIcon size={20} /></div>
          <div className="prs-info">
            <h3 className="prs-name">
              {portfolio.csmName}
              {isCurrentUser && <span className="prs-you-badge">You</span>}
            </h3>
            <p className="prs-email">{portfolio.csmEmail !== 'Unassigned' ? portfolio.csmEmail : ''}</p>
          </div>
        </div>
        <div className="prs-card-stats">
          <div className="prs-stat">
            <span className="prs-stat-value">{portfolio.opportunities.length}</span>
            <span className="prs-stat-label">Renewals</span>
          </div>
          <div className="prs-stat">
            <span className="prs-stat-value">{formatCurrency(portfolio.totalValue)}</span>
            <span className="prs-stat-label">Total Value</span>
          </div>
          {portfolio.urgentCount > 0 && (
            <div className="prs-stat urgent">
              <span className="prs-stat-value">{portfolio.urgentCount}</span>
              <span className="prs-stat-label">Urgent</span>
            </div>
          )}
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

export function CSMRenewalView() {
  const { user, isAdmin } = useAuth();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(60);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCSM, setExpandedCSM] = useState<string | null>(null);
  const [showNeedsActionModal, setShowNeedsActionModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'churn'>('active');
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedChurnOpp, setExpandedChurnOpp] = useState<string | null>(null);
  const [expandedNeedsActionOpp, setExpandedNeedsActionOpp] = useState<string | null>(null);
  const churnData = useChurnedAccounts();

  const currentUserEmail = user?.email?.toLowerCase() || '';

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

  const csmPortfolios = useMemo(() => {
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
    return groupByCSM(filtered);
  }, [opportunities, searchQuery, filter]);

  const { totalValue, urgentCount, uniqueAccounts, needsActionOpportunities } = useMemo(() => {
    const total = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const needsAction = opportunities.filter(opp => WorkflowEngine.getRequiredActions(opp).length > 0);
    const accounts = new Set(opportunities.map(opp => opp.accountId)).size;
    return {
      totalValue: total, urgentCount: needsAction.length, uniqueAccounts: accounts,
      needsActionOpportunities: needsAction,
    };
  }, [opportunities]);

  const churnQuarterGroups = useMemo(() => {
    const filtered = churnData.opportunities.filter(opp =>
      opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (opp.csmName || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
    return churnData.quarters.map(quarter => {
      const opps = filtered.filter(opp =>
        opp.renewalDate >= quarter.startISO && opp.renewalDate <= quarter.endISO
      ).sort((a, b) => new Date(b.renewalDate).getTime() - new Date(a.renewalDate).getTime());
      return {
        key: `${quarter.year}-Q${quarter.quarter}`,
        label: quarter.label,
        opps,
        count: opps.length,
        totalValue: opps.reduce((sum, o) => sum + (o.amount || 0), 0),
      };
    }).reverse();
  }, [churnData.opportunities, churnData.quarters, searchQuery]);

  const churnStats = useMemo(() => {
    const totalCount = churnData.opportunities.length;
    const totalValue = churnData.opportunities.reduce((sum, o) => sum + (o.amount || 0), 0);
    const accounts = new Set(churnData.opportunities.map(o => o.accountId)).size;
    return { totalCount, totalValue, accounts };
  }, [churnData.opportunities]);

  if (loading) {
    return (<div className="prs-view"><div className="usage-loading-spinner"><div className="spinner" /><span className="spinner-text">Loading renewal opportunities...</span></div></div>);
  }
  if (error) {
    return (<div className="prs-view"><div className="error">{error}</div></div>);
  }

  return (
    <div className="prs-view">
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {csmPortfolios.length} CSM portfolios</span>
        </div>
      )}

      <div className="prs-tab-bar" role="tablist" aria-label="CSM renewal views">
        <button role="tab" aria-selected={activeTab === 'active'} className={`prs-tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <FileText size={16} /> Active Renewals
          <span className="prs-tab-count">{opportunities.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === 'churn'} className={`prs-tab ${activeTab === 'churn' ? 'active' : ''}`} onClick={() => setActiveTab('churn')}>
          <XCircle size={16} /> Churn (last 2Q)
          {churnStats.totalCount > 0 && <span className="prs-tab-count overdue">{churnStats.totalCount}</span>}
        </button>
      </div>

      {activeTab === 'churn' ? (
        <>
          {churnData.loading ? (
            <div className="usage-loading-spinner"><div className="spinner" /><span className="spinner-text">Loading churn data...</span></div>
          ) : churnData.error ? (
            <div className="error">{churnData.error}</div>
          ) : (
            <>
              <div className="renewal-stats-grid">
                <div className="renewal-stat-card at-risk">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon red"><XCircle size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{churnStats.totalCount}</p>
                      <p className="renewal-stat-label">Churned Renewals</p>
                    </div>
                  </div>
                </div>
                <div className="renewal-stat-card">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon blue"><UserIcon size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{churnStats.accounts}</p>
                      <p className="renewal-stat-label">Accounts</p>
                    </div>
                  </div>
                </div>
                <div className="renewal-stat-card">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon orange"><DollarSign size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{formatCurrency(churnStats.totalValue)}</p>
                      <p className="renewal-stat-label">Total Lost Value</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="renewal-card">
                <div className="renewal-filter-bar">
                  <div className="renewal-search-wrapper">
                    <Search size={16} className="renewal-search-icon" />
                    <input type="text" placeholder="Search churn by account, opportunity, product, or CSM..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="renewal-search-input" />
                  </div>
                </div>
              </div>

              <div className="overdue-stage-list">
                {churnQuarterGroups.every(g => g.count === 0) ? (
                  <div className="renewal-empty"><CheckCircle size={48} className="renewal-empty-icon success" /><p>No churn in the last 2 quarters.</p></div>
                ) : (
                  churnQuarterGroups.filter(g => g.count > 0).map(({ key, label, opps, count, totalValue }) => {
                    const isExpanded = expandedQuarter === key;
                    return (
                      <div key={key} className={`overdue-stage-card ${isExpanded ? 'expanded' : ''}`}>
                        <div
                          className="overdue-stage-header"
                          onClick={() => setExpandedQuarter(isExpanded ? null : key)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedQuarter(isExpanded ? null : key); } }}
                          aria-expanded={isExpanded}
                        >
                          <div className="overdue-stage-info">
                            <ChevronRight className={`prs-chevron ${isExpanded ? 'expanded' : ''}`} size={18} />
                            <Badge variant="danger">{label}</Badge>
                            <span className="overdue-stage-stats">
                              {count} churn{count !== 1 ? 's' : ''} &middot; {formatCurrency(totalValue)} lost
                            </span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="overdue-stage-body">
                            <div className="renewal-opp-list">
                              {opps.map((opp, idx) => (
                                <OpportunityCard
                                  key={opp.id}
                                  opp={opp}
                                  index={idx}
                                  expanded={expandedChurnOpp === opp.id}
                                  onToggle={() => setExpandedChurnOpp(expandedChurnOpp === opp.id ? null : opp.id)}
                                  mode="closed-lost"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      ) : (
      <>
      <div className="renewal-stats-grid">
        <div className={`renewal-stat-card clickable ${filter === 'all' ? 'active-filter' : ''}`} onClick={() => setFilter('all')} style={{ cursor: 'pointer' }}><div className="renewal-stat-content"><div className="renewal-stat-icon slate"><FileText size={20} /></div><div><p className="renewal-stat-value">{opportunities.length}</p><p className="renewal-stat-label">Total Renewals</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon blue"><UserIcon size={20} /></div><div><p className="renewal-stat-value">{uniqueAccounts}</p><p className="renewal-stat-label">Accounts</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon green"><DollarSign size={20} /></div><div><p className="renewal-stat-value">{formatCurrency(totalValue)}</p><p className="renewal-stat-label">Total Value</p></div></div></div>
        <div className={`renewal-stat-card clickable ${urgentCount > 0 ? 'at-risk' : ''}`} onClick={() => urgentCount > 0 && setShowNeedsActionModal(true)} style={{ cursor: urgentCount > 0 ? 'pointer' : 'default' }}><div className="renewal-stat-content"><div className="renewal-stat-icon red"><AlertTriangle size={20} /></div><div><p className="renewal-stat-value">{urgentCount}</p><p className="renewal-stat-label">Needs Action</p></div></div></div>
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
            <label htmlFor="csm-sort-field" className="renewal-sort-label">Sort by</label>
            <select id="csm-sort-field" className="renewal-sort-select" value={sortConfig.field} onChange={(e) => setSortConfig({ field: e.target.value as SortField, direction: 'asc' })}>
              <option value="renewalDate">Renewal Date</option>
              <option value="companyName">Account</option>
              <option value="amount">Amount</option>
              <option value="stage">Stage</option>
              <option value="action">Action Priority</option>
              <option value="opportunityName">Opportunity</option>
              <option value="productName">Product</option>
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
        {csmPortfolios.map(portfolio => (
          <CSMCard key={portfolio.csmEmail} portfolio={portfolio} expanded={expandedCSM === portfolio.csmEmail} onToggle={() => setExpandedCSM(expandedCSM === portfolio.csmEmail ? null : portfolio.csmEmail)} isCurrentUser={portfolio.csmEmail.toLowerCase() === currentUserEmail} sortConfig={sortConfig} />
        ))}
        {csmPortfolios.length === 0 && (<div className="renewal-empty"><FileText size={48} className="renewal-empty-icon" /><p>No renewal opportunities found</p></div>)}
      </div>
      </>
      )}

      {showNeedsActionModal && (
        <div className="renewal-email-modal">
          <div className="renewal-email-content at-risk-modal">
            <div className="renewal-email-header">
              <h3 className="renewal-email-title"><AlertTriangle size={20} className="at-risk-icon" />Renewals Needing Action ({urgentCount})</h3>
              <button onClick={() => setShowNeedsActionModal(false)} className="renewal-close-btn"><X size={20} /></button>
            </div>
            <div className="at-risk-body">
              <div className="renewal-opp-list">
                {needsActionOpportunities.map((opp, idx) => (
                  <OpportunityCard
                    key={opp.id}
                    opp={opp}
                    index={idx}
                    expanded={expandedNeedsActionOpp === opp.id}
                    onToggle={() => setExpandedNeedsActionOpp(expandedNeedsActionOpp === opp.id ? null : opp.id)}
                  />
                ))}
              </div>
              {needsActionOpportunities.length === 0 && (<div className="renewal-empty"><CheckCircle size={48} className="renewal-empty-icon success" /><p>No renewals currently need action</p></div>)}
            </div>
            <div className="renewal-email-footer"><button className="renewal-btn secondary" onClick={() => setShowNeedsActionModal(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
