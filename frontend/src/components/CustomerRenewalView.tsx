import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle, FileText, Briefcase, DollarSign, X, Search, ChevronRight } from 'lucide-react';
import { fetchRenewalOpportunities } from '../services/api';
import type { Opportunity, SortConfig, SortField } from '../types/renewal';
import { transformApiOpportunity } from '../types/renewal';
import { WorkflowEngine, getStageBadgeVariant, isClosedLost } from '../services/workflow-engine';
import { formatCurrency } from '../utils/format';
import { Badge } from './renewal/Badge';
import { SortHeader } from './renewal/SortHeader';
import { OverdueBanner } from './renewal/OverdueBanner';
import { useOverdueAlerts } from '../hooks/useOverdueAlerts';

interface AccountRenewalPortfolio {
  accountName: string;
  accountId: string;
  opportunities: Opportunity[];
  totalValue: number;
  urgentCount: number;
}

function groupByAccount(opportunities: Opportunity[]): AccountRenewalPortfolio[] {
  const accountMap = new Map<string, Opportunity[]>();
  for (const opp of opportunities) {
    const key = opp.accountId || opp.companyName || 'Unknown';
    const existing = accountMap.get(key) || [];
    existing.push(opp);
    accountMap.set(key, existing);
  }
  return Array.from(accountMap.entries())
    .map(([accountId, opps]) => {
      const accountName = opps[0]?.companyName || (accountId === 'Unknown' ? 'Unknown' : accountId);
      const totalValue = opps.reduce((sum, o) => sum + (o.amount || 0), 0);
      const urgentCount = opps.filter(o => {
        const actions = WorkflowEngine.getRequiredActions(o);
        return actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
      }).length;
      return { accountName, accountId, opportunities: opps, totalValue, urgentCount };
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

interface AccountCardProps {
  portfolio: AccountRenewalPortfolio;
  expanded: boolean;
  onToggle: () => void;
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
}

const AccountCard: React.FC<AccountCardProps> = ({ portfolio, expanded, onToggle, sortConfig, onSort }) => {
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
        case 'companyName': comparison = (a.csmName || '').localeCompare(b.csmName || ''); break;
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
    <div className={`prs-card ${expanded ? 'expanded' : ''}`}>
      <div className="prs-card-header" onClick={onToggle}>
        <div className="prs-card-left">
          <ChevronRight className={`prs-chevron ${expanded ? 'expanded' : ''}`} size={20} />
          <div className="prs-avatar"><Briefcase size={20} /></div>
          <div className="prs-info"><h3 className="prs-name">{portfolio.accountName}</h3></div>
        </div>
        <div className="prs-card-stats">
          <div className="prs-stat"><span className="prs-stat-value">{portfolio.opportunities.length}</span><span className="prs-stat-label">Renewals</span></div>
          <div className="prs-stat"><span className="prs-stat-value">{formatCurrency(portfolio.totalValue)}</span><span className="prs-stat-label">Total Value</span></div>
          {portfolio.urgentCount > 0 && (<div className="prs-stat urgent"><span className="prs-stat-value">{portfolio.urgentCount}</span><span className="prs-stat-label">Urgent</span></div>)}
        </div>
      </div>
      {expanded && (
        <div className="prs-card-content">
          <table className="renewal-table">
            <thead>
              <tr>
                <SortHeader label="Opportunity Name" field="opportunityName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Product Name" field="productName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="CSM" field="companyName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="AE" field="ownerName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Stage" field="stage" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Renewal Status" field="renewalStatus" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Accounting Status" field="accountingRenewalStatus" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="PO Required" field="poRequired" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Total Price" field="amount" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Renewal Date" field="renewalDate" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Action Needed" field="action" sortConfig={sortConfig} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {sortedOpportunities.map(opp => {
                const actions = WorkflowEngine.getRequiredActions(opp);
                const primaryAction = actions[0];
                const isUrgent = actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
                return (
                  <tr key={opp.id} className={`renewal-opp-row ${isUrgent ? 'urgent' : ''} ${opp.atRisk ? 'at-risk' : ''}`}>
                    <td>{opp.opportunityName}</td>
                    <td>{opp.productName}</td>
                    <td>{opp.csmName || 'Unassigned'}</td>
                    <td>{opp.ownerName || '-'}</td>
                    <td><Badge variant={getStageBadgeVariant(opp.stage)}>{opp.stage}</Badge></td>
                    <td>{opp.renewalStatus ? <Badge variant={opp.renewalStatus.toLowerCase().includes('complete') ? 'success' : opp.renewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>{opp.renewalStatus}</Badge> : '-'}</td>
                    <td>{opp.accountingRenewalStatus ? <Badge variant={opp.accountingRenewalStatus.toLowerCase().includes('complete') ? 'success' : opp.accountingRenewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>{opp.accountingRenewalStatus}</Badge> : '-'}</td>
                    <td>
                      {opp.poRequired ? (
                        <div className="po-status">
                          <Badge variant={opp.poReceivedDate ? 'success' : 'warning'}>{opp.poReceivedDate ? 'Received' : 'Required'}</Badge>
                          {opp.poReceivedDate && <span className="po-date">{new Date(opp.poReceivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                        </div>
                      ) : <span className="po-not-required">Not Required</span>}
                    </td>
                    <td className="renewal-amount-cell">{formatCurrency(opp.amount || 0)}</td>
                    <td>{new Date(opp.renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td>
                      {primaryAction ? (
                        <div className="renewal-action-cell">
                          <span className={`renewal-action-text ${primaryAction.priority}`}>{isUrgent && <AlertTriangle size={14} />}{primaryAction.description}</span>
                        </div>
                      ) : <span className="renewal-no-action"><CheckCircle size={14} /> No action needed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const DAYS_OPTIONS = [30, 60, 90, 120, 180] as const;

export function CustomerRenewalView() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(60);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [showAtRiskModal, setShowAtRiskModal] = useState(false);

  const { overdueItems } = useOverdueAlerts(opportunities);

  useEffect(() => {
    async function loadOpportunities() {
      try {
        setLoading(true);
        const response = await fetchRenewalOpportunities(daysAhead);
        const opps = response.opportunities.map(transformApiOpportunity)
          .filter(opp => !isClosedLost(opp.stage));
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

  const handleSort = (field: SortField) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        if (prev.direction === 'asc') return { field, direction: 'desc' };
        if (prev.direction === 'desc') return { field, direction: null };
        return { field, direction: 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const accountPortfolios = useMemo(() => {
    let filtered = opportunities.filter(opp => {
      const matchesSearch = opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (opp.csmName || '').toLowerCase().includes(searchQuery.toLowerCase());
      if (filter === 'all') return matchesSearch;
      if (filter === 'urgent') {
        const actions = WorkflowEngine.getRequiredActions(opp);
        return matchesSearch && actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
      }
      return matchesSearch;
    });
    return groupByAccount(filtered);
  }, [opportunities, searchQuery, filter]);

  const { totalValue, urgentCount, uniqueAccounts, atRiskOpportunities, atRiskCount, atRiskValue } = useMemo(() => {
    const total = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const urgent = opportunities.filter(opp => {
      const actions = WorkflowEngine.getRequiredActions(opp);
      return actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
    }).length;
    const accounts = new Set(opportunities.map(opp => opp.accountId)).size;
    const atRiskOpps = opportunities.filter(opp => opp.atRisk === true);
    return {
      totalValue: total, urgentCount: urgent, uniqueAccounts: accounts,
      atRiskOpportunities: atRiskOpps, atRiskCount: atRiskOpps.length,
      atRiskValue: atRiskOpps.reduce((sum, opp) => sum + (opp.amount || 0), 0)
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
      <OverdueBanner overdueItems={overdueItems} />

      <div className="renewal-stats-grid">
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon slate"><FileText size={20} /></div><div><p className="renewal-stat-value">{opportunities.length}</p><p className="renewal-stat-label">Total Renewals</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon blue"><Briefcase size={20} /></div><div><p className="renewal-stat-value">{uniqueAccounts}</p><p className="renewal-stat-label">Accounts</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon green"><DollarSign size={20} /></div><div><p className="renewal-stat-value">{formatCurrency(totalValue)}</p><p className="renewal-stat-label">Total Value</p></div></div></div>
        <div className="renewal-stat-card"><div className="renewal-stat-content"><div className="renewal-stat-icon red"><AlertTriangle size={20} /></div><div><p className="renewal-stat-value">{urgentCount}</p><p className="renewal-stat-label">Needs Action</p></div></div></div>
        <div className={`renewal-stat-card clickable ${atRiskCount > 0 ? 'at-risk' : ''}`} onClick={() => atRiskCount > 0 && setShowAtRiskModal(true)} style={{ cursor: atRiskCount > 0 ? 'pointer' : 'default' }}>
          <div className="renewal-stat-content"><div className="renewal-stat-icon orange"><AlertTriangle size={20} /></div><div><p className="renewal-stat-value">{atRiskCount}</p><p className="renewal-stat-label">At Risk</p>{atRiskCount > 0 && <p className="renewal-stat-subtext">{formatCurrency(atRiskValue)} value</p>}</div></div>
        </div>
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
          <div className="renewal-filter-buttons">
            <button onClick={() => setFilter('all')} className={`renewal-filter-btn ${filter === 'all' ? 'active' : ''}`}>All ({opportunities.length})</button>
            <button onClick={() => setFilter('urgent')} className={`renewal-filter-btn urgent ${filter === 'urgent' ? 'active' : ''}`}>Needs Action ({urgentCount})</button>
          </div>
        </div>
      </div>

      <div className="prs-list">
        {accountPortfolios.map(portfolio => (
          <AccountCard key={portfolio.accountId} portfolio={portfolio} expanded={expandedAccount === portfolio.accountId} onToggle={() => setExpandedAccount(expandedAccount === portfolio.accountId ? null : portfolio.accountId)} sortConfig={sortConfig} onSort={handleSort} />
        ))}
        {accountPortfolios.length === 0 && (<div className="renewal-empty"><FileText size={48} className="renewal-empty-icon" /><p>No renewal opportunities found</p></div>)}
      </div>

      {showAtRiskModal && (
        <div className="renewal-email-modal">
          <div className="renewal-email-content at-risk-modal">
            <div className="renewal-email-header">
              <h3 className="renewal-email-title"><AlertTriangle size={20} className="at-risk-icon" />Renewals at Risk ({atRiskCount})</h3>
              <button onClick={() => setShowAtRiskModal(false)} className="renewal-close-btn"><X size={20} /></button>
            </div>
            <div className="at-risk-summary"><span className="at-risk-total-value">Total Value at Risk: {formatCurrency(atRiskValue)}</span></div>
            <div className="at-risk-body">
              <table className="renewal-table at-risk-table">
                <thead><tr><th>Account</th><th>AE</th><th>Opportunity</th><th>Product</th><th>CSM</th><th>Renewal Status</th><th>Accounting Status</th><th>PO Status</th><th>Amount</th><th>Renewal Date</th></tr></thead>
                <tbody>
                  {atRiskOpportunities.map(opp => (
                    <tr key={opp.id} className="renewal-opp-row at-risk">
                      <td className="renewal-account-cell">{opp.companyName}</td><td>{opp.ownerName || '-'}</td><td>{opp.opportunityName}</td><td>{opp.productName}</td><td>{opp.csmName || 'Unassigned'}</td>
                      <td>{opp.renewalStatus ? <Badge variant={opp.renewalStatus.toLowerCase().includes('complete') ? 'success' : opp.renewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>{opp.renewalStatus}</Badge> : '-'}</td>
                      <td>{opp.accountingRenewalStatus ? <Badge variant={opp.accountingRenewalStatus.toLowerCase().includes('complete') ? 'success' : opp.accountingRenewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>{opp.accountingRenewalStatus}</Badge> : '-'}</td>
                      <td>{opp.poRequired ? (<div className="po-status"><Badge variant={opp.poReceivedDate ? 'success' : 'warning'}>{opp.poReceivedDate ? 'Received' : 'Required'}</Badge>{opp.poReceivedDate && <span className="po-date">{new Date(opp.poReceivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}</div>) : <span className="po-not-required">Not Required</span>}</td>
                      <td className="renewal-amount-cell">{formatCurrency(opp.amount || 0)}</td>
                      <td>{new Date(opp.renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {atRiskOpportunities.length === 0 && (<div className="renewal-empty"><CheckCircle size={48} className="renewal-empty-icon success" /><p>No renewals currently at risk</p></div>)}
            </div>
            <div className="renewal-email-footer"><button className="renewal-btn secondary" onClick={() => setShowAtRiskModal(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
