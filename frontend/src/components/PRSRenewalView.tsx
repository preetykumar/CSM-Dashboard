import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Clock, FileText, User as UserIcon, DollarSign, X, Search, ChevronRight, XCircle } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Opportunity, RequiredAction, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine, getStageBadgeVariant, isClosedLost, isClosedWon } from '../services/workflow-engine';
import { RENEWAL_EMAIL_TEMPLATES, getTemplateForAction } from '../services/email-templates';
import { formatCurrency } from '../utils/format';
import { Badge } from './renewal/Badge';
import { EmailComposer } from './renewal/EmailComposer';
import { OpportunityCard } from './renewal/OpportunityCard';
import { useChurnedAccounts } from '../hooks/useChurnedAccounts';

interface PRSPortfolio {
  prsName: string;
  prsEmail: string;
  opportunities: Opportunity[];
  totalValue: number;
  urgentCount: number;
}

// Group opportunities by PRS
function groupByPRS(opportunities: Opportunity[]): PRSPortfolio[] {
  const prsMap = new Map<string, Opportunity[]>();

  for (const opp of opportunities) {
    const key = opp.prsEmail || opp.prsName || 'Unassigned';
    const existing = prsMap.get(key) || [];
    existing.push(opp);
    prsMap.set(key, existing);
  }

  return Array.from(prsMap.entries())
    .map(([email, opps]) => {
      const prsName = opps[0]?.prsName || (email === 'Unassigned' ? 'Unassigned' : email);
      const totalValue = opps.reduce((sum, o) => sum + (o.amount || 0), 0);
      const urgentCount = opps.filter(o => WorkflowEngine.getRequiredActions(o).length > 0).length;

      return { prsName, prsEmail: email, opportunities: opps, totalValue, urgentCount };
    })
    .sort((a, b) => a.prsName.localeCompare(b.prsName));
}

// PRS Card component
interface PRSCardProps {
  portfolio: PRSPortfolio;
  expanded: boolean;
  onToggle: () => void;
  isCurrentUser: boolean;
  onDraftEmail: (opp: Opportunity, action: RequiredAction) => void;
  sortConfig: SortConfig;
}

const PRSCard: React.FC<PRSCardProps> = ({
  portfolio, expanded, onToggle, isCurrentUser, onDraftEmail, sortConfig
}) => {
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
          const priorityA = actionsA[0] ? priorityOrder[actionsA[0].priority] : 4;
          const priorityB = actionsB[0] ? priorityOrder[actionsB[0].priority] : 4;
          comparison = priorityA - priorityB;
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
              {portfolio.prsName}
              {isCurrentUser && <span className="prs-you-badge">You</span>}
            </h3>
            <p className="prs-email">{portfolio.prsEmail}</p>
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
                onDraftEmail={onDraftEmail}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DAYS_OPTIONS = [30, 60, 90, 120, 180] as const;

export function PRSRenewalView() {
  const { user, isAdmin } = useAuth();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [currentTemplateKey, setCurrentTemplateKey] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(60);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPRS, setExpandedPRS] = useState<string | null>(null);
  const [showNeedsActionModal, setShowNeedsActionModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'overdue' | 'churn'>('active');
  const [overdueOpportunities, setOverdueOpportunities] = useState<Opportunity[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedOverdueOpp, setExpandedOverdueOpp] = useState<string | null>(null);
  const [expandedChurnOpp, setExpandedChurnOpp] = useState<string | null>(null);
  const churnData = useChurnedAccounts();

  const currentUserEmail = user?.email?.toLowerCase() || '';
  const userName = user?.name || user?.email?.split('@')[0] || 'PRS User';


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

  useEffect(() => {
    if (activeTab !== 'overdue' || overdueOpportunities.length > 0) return;
    async function loadOverdue() {
      try {
        setOverdueLoading(true);
        const response = await fetchRenewalOpportunities(365);
        const today = new Date().toISOString().split('T')[0];
        const opps = response.opportunities
          .map(transformApiOpportunity)
          .filter(opp =>
            opp.renewalDate < today &&
            !isClosedLost(opp.stage) &&
            !isClosedWon(opp.stage)
          );
        setOverdueOpportunities(opps);
      } catch (err) {
        console.error('Failed to fetch overdue renewals:', err);
      } finally {
        setOverdueLoading(false);
      }
    }
    loadOverdue();
  }, [activeTab, overdueOpportunities.length]);

  const prsPortfolios = useMemo(() => {
    let filtered = opportunities.filter(opp => {
      const matchesSearch = opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (opp.prsName || '').toLowerCase().includes(searchQuery.toLowerCase());
      if (filter === 'all') return matchesSearch;
      if (filter === 'urgent') {
        return matchesSearch && WorkflowEngine.getRequiredActions(opp).length > 0;
      }
      return matchesSearch;
    });
    return groupByPRS(filtered);
  }, [opportunities, searchQuery, filter]);

  const overdueStageGroups = useMemo(() => {
    const filtered = overdueOpportunities.filter(opp =>
      opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (opp.prsName || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
    const groups = new Map<string, Opportunity[]>();
    for (const opp of filtered) {
      const key = opp.stage || 'Unknown';
      const existing = groups.get(key) || [];
      existing.push(opp);
      groups.set(key, existing);
    }
    // Stage display order — earlier stages = more concerning when overdue
    const stageOrder = ['Discovery', 'Qualification', 'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed Lost'];
    const orderIndex = (s: string) => {
      const idx = stageOrder.findIndex(t => s.toLowerCase().includes(t.toLowerCase()));
      return idx === -1 ? 99 : idx;
    };
    return Array.from(groups.entries())
      .map(([stage, opps]) => ({
        stage,
        opps: opps.sort((a, b) => new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime()),
        count: opps.length,
        totalValue: opps.reduce((sum, o) => sum + (o.amount || 0), 0),
      }))
      .sort((a, b) => orderIndex(a.stage) - orderIndex(b.stage));
  }, [overdueOpportunities, searchQuery]);

  const overdueStats = useMemo(() => {
    const totalCount = overdueOpportunities.length;
    const totalValue = overdueOpportunities.reduce((sum, o) => sum + (o.amount || 0), 0);
    const accounts = new Set(overdueOpportunities.map(o => o.accountId)).size;
    return { totalCount, totalValue, accounts };
  }, [overdueOpportunities]);

  const churnQuarterGroups = useMemo(() => {
    const filtered = churnData.opportunities.filter(opp =>
      opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (opp.prsName || '').toLowerCase().includes(searchQuery.toLowerCase())
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

  const handleDraftEmail = useCallback((opp: Opportunity, action: RequiredAction) => {
    setSelectedOpportunity(opp);
    const templateKey = getTemplateForAction(action.type);
    setCurrentTemplateKey(templateKey);
    setShowEmailComposer(true);
  }, []);

  const { totalValue, urgentCount, uniqueAccounts, needsActionOpportunities } = useMemo(() => {
    const total = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const needsAction = opportunities.filter(opp => WorkflowEngine.getRequiredActions(opp).length > 0);
    const accounts = new Set(opportunities.map(opp => opp.accountId)).size;
    return {
      totalValue: total,
      urgentCount: needsAction.length,
      uniqueAccounts: accounts,
      needsActionOpportunities: needsAction,
    };
  }, [opportunities]);

  if (loading) {
    return (
      <div className="prs-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading renewal opportunities...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (<div className="prs-view"><div className="error">{error}</div></div>);
  }

  return (
    <div className="prs-view">

      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {prsPortfolios.length} PRS portfolios</span>
        </div>
      )}

      <div className="prs-tab-bar" role="tablist" aria-label="Renewal Specialist views">
        <button
          role="tab"
          aria-selected={activeTab === 'active'}
          className={`prs-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          <FileText size={16} /> Active Renewals
          <span className="prs-tab-count">{opportunities.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'overdue'}
          className={`prs-tab ${activeTab === 'overdue' ? 'active' : ''} ${overdueStats.totalCount > 0 ? 'has-alert' : ''}`}
          onClick={() => setActiveTab('overdue')}
        >
          <Clock size={16} /> Overdue
          {overdueStats.totalCount > 0 && (
            <span className="prs-tab-count overdue">{overdueStats.totalCount}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'churn'}
          className={`prs-tab ${activeTab === 'churn' ? 'active' : ''}`}
          onClick={() => setActiveTab('churn')}
        >
          <XCircle size={16} /> Churn (last 2Q)
          {churnStats.totalCount > 0 && (
            <span className="prs-tab-count overdue">{churnStats.totalCount}</span>
          )}
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
                    <input type="text" placeholder="Search churn by account, opportunity, product, or PRS..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="renewal-search-input" />
                  </div>
                </div>
              </div>

              <div className="overdue-stage-list">
                {churnQuarterGroups.every(g => g.count === 0) ? (
                  <div className="renewal-empty">
                    <CheckCircle size={48} className="renewal-empty-icon success" />
                    <p>No churn in the last 2 quarters.</p>
                  </div>
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
      ) : activeTab === 'overdue' ? (
        <>
          {overdueLoading ? (
            <div className="usage-loading-spinner"><div className="spinner" /><span className="spinner-text">Loading overdue renewals...</span></div>
          ) : (
            <>
              <div className="renewal-stats-grid">
                <div className="renewal-stat-card at-risk">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon red"><Clock size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{overdueStats.totalCount}</p>
                      <p className="renewal-stat-label">Overdue Renewals</p>
                    </div>
                  </div>
                </div>
                <div className="renewal-stat-card">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon blue"><UserIcon size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{overdueStats.accounts}</p>
                      <p className="renewal-stat-label">Accounts</p>
                    </div>
                  </div>
                </div>
                <div className="renewal-stat-card">
                  <div className="renewal-stat-content">
                    <div className="renewal-stat-icon orange"><DollarSign size={20} /></div>
                    <div>
                      <p className="renewal-stat-value">{formatCurrency(overdueStats.totalValue)}</p>
                      <p className="renewal-stat-label">Total Value at Risk</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="renewal-card">
                <div className="renewal-filter-bar">
                  <div className="renewal-search-wrapper">
                    <Search size={16} className="renewal-search-icon" />
                    <input type="text" placeholder="Search overdue by account, opportunity, product, or PRS..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="renewal-search-input" />
                  </div>
                </div>
              </div>

              <div className="overdue-stage-list">
                {overdueStageGroups.length === 0 ? (
                  <div className="renewal-empty">
                    <CheckCircle size={48} className="renewal-empty-icon success" />
                    <p>No overdue renewals.</p>
                  </div>
                ) : (
                  overdueStageGroups.map(({ stage, opps, count, totalValue }) => {
                    const isExpanded = expandedStage === stage;
                    return (
                      <div key={stage} className={`overdue-stage-card ${isExpanded ? 'expanded' : ''}`}>
                        <div
                          className="overdue-stage-header"
                          onClick={() => setExpandedStage(isExpanded ? null : stage)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedStage(isExpanded ? null : stage); } }}
                          aria-expanded={isExpanded}
                        >
                          <div className="overdue-stage-info">
                            <ChevronRight className={`prs-chevron ${isExpanded ? 'expanded' : ''}`} size={18} />
                            <Badge variant={getStageBadgeVariant(stage)}>{stage}</Badge>
                            <span className="overdue-stage-stats">
                              {count} renewal{count !== 1 ? 's' : ''} &middot; {formatCurrency(totalValue)}
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
                                  expanded={expandedOverdueOpp === opp.id}
                                  onToggle={() => setExpandedOverdueOpp(expandedOverdueOpp === opp.id ? null : opp.id)}
                                  mode="overdue"
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

          {showEmailComposer && selectedOpportunity && (
            <EmailComposer
              template={currentTemplateKey ? RENEWAL_EMAIL_TEMPLATES[currentTemplateKey] : null}
              opportunity={selectedOpportunity}
              prsName={userName}
              onClose={() => { setShowEmailComposer(false); setCurrentTemplateKey(null); setSelectedOpportunity(null); }}
            />
          )}
        </>
      ) : (
      <>
      <div className="renewal-stats-grid">
        <div className={`renewal-stat-card clickable ${filter === 'all' ? 'active-filter' : ''}`} onClick={() => setFilter('all')} style={{ cursor: 'pointer' }}>
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon slate"><FileText size={20} /></div>
            <div>
              <p className="renewal-stat-value">{opportunities.length}</p>
              <p className="renewal-stat-label">Total Renewals</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon blue"><UserIcon size={20} /></div>
            <div>
              <p className="renewal-stat-value">{uniqueAccounts}</p>
              <p className="renewal-stat-label">Accounts</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon green"><DollarSign size={20} /></div>
            <div>
              <p className="renewal-stat-value">{formatCurrency(totalValue)}</p>
              <p className="renewal-stat-label">Total Value</p>
            </div>
          </div>
        </div>
        <div
          className={`renewal-stat-card clickable ${urgentCount > 0 ? 'at-risk' : ''}`}
          onClick={() => urgentCount > 0 && setShowNeedsActionModal(true)}
          style={{ cursor: urgentCount > 0 ? 'pointer' : 'default' }}
        >
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><AlertTriangle size={20} /></div>
            <div>
              <p className="renewal-stat-value">{urgentCount}</p>
              <p className="renewal-stat-label">Needs Action</p>
            </div>
          </div>
        </div>
      </div>

      <div className="renewal-card">
        <div className="renewal-filter-bar">
          <div className="renewal-search-wrapper">
            <Search size={16} className="renewal-search-icon" />
            <input type="text" placeholder="Search by account, opportunity, product, or PRS name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="renewal-search-input" />
          </div>
          <div className="renewal-days-picker">
            <span className="renewal-days-label">Next</span>
            {DAYS_OPTIONS.map(days => (
              <button key={days} onClick={() => setDaysAhead(days)} className={`renewal-days-btn ${daysAhead === days ? 'active' : ''}`}>
                {days} days
              </button>
            ))}
          </div>
          <div className="renewal-sort-control">
            <label htmlFor="prs-sort-field" className="renewal-sort-label">Sort by</label>
            <select
              id="prs-sort-field"
              className="renewal-sort-select"
              value={sortConfig.field}
              onChange={(e) => setSortConfig({ field: e.target.value as SortField, direction: 'asc' })}
            >
              <option value="renewalDate">Renewal Date</option>
              <option value="companyName">Account</option>
              <option value="amount">Amount</option>
              <option value="stage">Stage</option>
              <option value="action">Action Priority</option>
              <option value="opportunityName">Opportunity</option>
              <option value="productName">Product</option>
            </select>
            <button
              type="button"
              className="renewal-sort-direction"
              onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'desc' ? 'asc' : 'desc' }))}
              title={sortConfig.direction === 'desc' ? 'Descending — click to switch to ascending' : 'Ascending — click to switch to descending'}
              aria-label={`Toggle sort direction, currently ${sortConfig.direction || 'asc'}`}
            >
              {sortConfig.direction === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          <div className="renewal-filter-buttons">
            <button onClick={() => setFilter('all')} className={`renewal-filter-btn ${filter === 'all' ? 'active' : ''}`}>
              All ({opportunities.length})
            </button>
            <button onClick={() => setFilter('urgent')} className={`renewal-filter-btn urgent ${filter === 'urgent' ? 'active' : ''}`}>
              Needs Action ({urgentCount})
            </button>
          </div>
        </div>
      </div>

      <div className="prs-list">
        {prsPortfolios.map(portfolio => {
          const isCurrentUser = portfolio.prsEmail.toLowerCase() === currentUserEmail;
          return (
            <PRSCard
              key={portfolio.prsEmail}
              portfolio={portfolio}
              expanded={expandedPRS === portfolio.prsEmail}
              onToggle={() => setExpandedPRS(expandedPRS === portfolio.prsEmail ? null : portfolio.prsEmail)}
              isCurrentUser={isCurrentUser}
              onDraftEmail={handleDraftEmail}
              sortConfig={sortConfig}
            />
          );
        })}
        {prsPortfolios.length === 0 && (
          <div className="renewal-empty">
            <FileText size={48} className="renewal-empty-icon" />
            <p>No renewal opportunities found</p>
          </div>
        )}
      </div>

      {showEmailComposer && selectedOpportunity && (
        <EmailComposer
          template={currentTemplateKey ? RENEWAL_EMAIL_TEMPLATES[currentTemplateKey] : null}
          opportunity={selectedOpportunity}
          prsName={userName}
          onClose={() => { setShowEmailComposer(false); setCurrentTemplateKey(null); setSelectedOpportunity(null); }}
        />
      )}

      {showNeedsActionModal && (
        <div className="renewal-email-modal">
          <div className="renewal-email-content at-risk-modal">
            <div className="renewal-email-header">
              <h3 className="renewal-email-title">
                <AlertTriangle size={20} className="at-risk-icon" />
                Renewals Needing Action ({urgentCount})
              </h3>
              <button onClick={() => setShowNeedsActionModal(false)} className="renewal-close-btn"><X size={20} /></button>
            </div>
            <div className="at-risk-body">
              <table className="renewal-table at-risk-table">
                <thead>
                  <tr>
                    <th>Account</th><th>Opportunity</th><th>Product</th><th>PRS</th>
                    <th>Required Actions</th>
                    <th>Amount</th><th>Renewal Date</th>
                  </tr>
                </thead>
                <tbody>
                  {needsActionOpportunities.map(opp => {
                    const actions = WorkflowEngine.getRequiredActions(opp);
                    return (
                      <tr key={opp.id} className="renewal-opp-row urgent">
                        <td className="renewal-account-cell" data-label="Account">{opp.companyName}</td>
                        <td data-label="Opportunity">{opp.opportunityName}</td>
                        <td data-label="Product">{opp.productName}</td>
                        <td data-label="PRS">{opp.prsName || 'Unassigned'}</td>
                        <td data-label="Required Actions">
                          {actions.map((a, i) => (
                            <Badge key={i} variant={a.priority === 'critical' || a.priority === 'urgent' ? 'danger' : a.priority === 'high' ? 'warning' : 'default'}>{a.description}</Badge>
                          ))}
                        </td>
                        <td className="renewal-amount-cell" data-label="Amount">{formatCurrency(opp.amount || 0)}</td>
                        <td data-label="Renewal Date">{new Date(opp.renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {needsActionOpportunities.length === 0 && (
                <div className="renewal-empty"><CheckCircle size={48} className="renewal-empty-icon success" /><p>No renewals currently need action</p></div>
              )}
            </div>
            <div className="renewal-email-footer">
              <button className="renewal-btn secondary" onClick={() => setShowNeedsActionModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
