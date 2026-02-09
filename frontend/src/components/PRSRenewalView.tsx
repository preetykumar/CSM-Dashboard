import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle, FileText, Send, User as UserIcon, DollarSign, X, ChevronUp, ChevronDown, ChevronsUpDown, Search, ChevronRight } from 'lucide-react';
import { fetchRenewalOpportunities, RenewalOpportunity as ApiRenewalOpportunity } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// TypeScript interfaces
interface Opportunity {
  id: string;
  opportunityName: string;
  companyName: string;
  accountId: string;
  productName: string;
  renewalDate: string;
  amount: number;
  stage: string;
  ownerName: string;
  ownerEmail: string;
  contactName?: string;
  contactEmail?: string;
  // PRS from Product Success object
  prsName?: string;
  prsEmail?: string;
  // Additional renewal fields
  renewalStatus?: string;
  accountingRenewalStatus?: string;
  poRequired?: boolean;
  poReceivedDate?: string;
  atRisk?: boolean;
}

interface PRSPortfolio {
  prsName: string;
  prsEmail: string;
  opportunities: Opportunity[];
  totalValue: number;
  urgentCount: number;
}

interface RequiredAction {
  type: string;
  priority: 'critical' | 'urgent' | 'high' | 'medium';
  description: string;
}

interface EmailTemplate {
  subject: string;
  body: string;
}

type SortField = 'opportunityName' | 'productName' | 'stage' | 'amount' | 'renewalDate' | 'action' | 'companyName' | 'renewalStatus' | 'accountingRenewalStatus' | 'poRequired';
type SortDirection = 'asc' | 'desc' | null;

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// PRS users configuration - these users can execute email actions
const PRS_USER_EMAILS = ['rashi@deque.com', 'brandi@deque.com'];

// Email templates
const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  SEND_INVOICE_REMINDER: {
    subject: 'Reminder: Invoice Payment Required',
    body: `Dear {{contact_name}},

This is a reminder that payment is required for your {{product_name}} renewal.

Invoice number: {{invoice_number}}
Amount due: {{amount}}
Due date: {{due_date}}

Please ensure payment is processed to avoid any service disruption.

Best regards,
{{prs_name}}
Product Renewal Specialist`
  },
  SEND_FINAL_REMINDER: {
    subject: 'URGENT: Payment Required - Service Disruption Warning',
    body: `Dear {{contact_name}},

Your {{product_name}} subscription renewal payment is overdue.

Invoice number: {{invoice_number}}
Amount due: {{amount}}

Please note: A 30-day grace period is now in effect. Service will be disrupted at the end of this grace period if payment is not received.

Please contact us immediately if you have any questions or concerns.

Best regards,
{{prs_name}}
Product Renewal Specialist`
  }
};

// Format currency with proper comma delimiters
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// Workflow rules engine
const WorkflowEngine = {
  getMilestone: (renewalDate: string): string => {
    const today = new Date();
    const renewal = new Date(renewalDate);
    const weeksUntilRenewal = Math.ceil((renewal.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));

    if (weeksUntilRenewal > 6) return 'R-6+';
    if (weeksUntilRenewal > 4) return 'R-6';
    if (weeksUntilRenewal > 3) return 'R-4';
    if (weeksUntilRenewal > 2) return 'R-3';
    if (weeksUntilRenewal > 1) return 'R-2';
    if (weeksUntilRenewal > 0) return 'R-1';
    return 'R';
  },

  getRequiredActions: (opportunity: Opportunity): RequiredAction[] => {
    const milestone = WorkflowEngine.getMilestone(opportunity.renewalDate);
    const actions: RequiredAction[] = [];

    switch (milestone) {
      case 'R-6':
        actions.push({ type: 'SEND_EMAIL_1', priority: 'high', description: 'Send initial contact email with usage summary' });
        break;
      case 'R-4':
      case 'R-3':
        actions.push({ type: 'SEND_QUOTE', priority: 'high', description: 'Send quote with PO request' });
        break;
      case 'R-2':
        if (opportunity.stage !== 'Ready for Invoicing') {
          actions.push({ type: 'MARK_READY_FOR_INVOICING', priority: 'high', description: 'Mark opportunity as Ready for Invoicing' });
        }
        break;
      case 'R-1':
        if (opportunity.stage !== 'Invoice confirmed') {
          actions.push({ type: 'SEND_INVOICE_REMINDER', priority: 'urgent', description: 'Send payment reminder with service disruption warning' });
        }
        break;
      case 'R':
        if (opportunity.stage !== 'Invoice confirmed') {
          actions.push({ type: 'SEND_FINAL_REMINDER', priority: 'critical', description: 'Send final reminder - 30-day grace period starts' });
        }
        break;
    }

    return actions;
  }
};

// Transform API response to internal Opportunity format
function transformApiOpportunity(apiOpp: ApiRenewalOpportunity): Opportunity {
  return {
    id: apiOpp.id,
    opportunityName: apiOpp.name,
    companyName: apiOpp.accountName,
    accountId: apiOpp.accountId,
    productName: apiOpp.productName || 'axe DevTools',
    renewalDate: apiOpp.renewalDate,
    amount: apiOpp.amount,
    stage: apiOpp.stageName,
    ownerName: apiOpp.ownerName,
    ownerEmail: apiOpp.ownerEmail,
    contactName: apiOpp.contactName,
    contactEmail: apiOpp.contactEmail,
    // PRS from Product Success object
    prsName: apiOpp.prsName,
    prsEmail: apiOpp.prsEmail,
    // Additional renewal fields
    renewalStatus: apiOpp.renewalStatus,
    accountingRenewalStatus: apiOpp.accountingRenewalStatus,
    poRequired: apiOpp.poRequired,
    poReceivedDate: apiOpp.poReceivedDate,
    atRisk: apiOpp.atRisk
  };
}

// Group opportunities by PRS (Product Retention Specialist from Product Success object)
function groupByPRS(opportunities: Opportunity[]): PRSPortfolio[] {
  const prsMap = new Map<string, Opportunity[]>();

  for (const opp of opportunities) {
    // Use PRS from Product Success object, fall back to "Unassigned" if no PRS
    const key = opp.prsEmail || opp.prsName || 'Unassigned';
    const existing = prsMap.get(key) || [];
    existing.push(opp);
    prsMap.set(key, existing);
  }

  return Array.from(prsMap.entries())
    .map(([email, opps]) => {
      const prsName = opps[0]?.prsName || (email === 'Unassigned' ? 'Unassigned' : email);
      const totalValue = opps.reduce((sum, o) => sum + (o.amount || 0), 0);
      const urgentCount = opps.filter(o => {
        const actions = WorkflowEngine.getRequiredActions(o);
        return actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
      }).length;

      return {
        prsName,
        prsEmail: email,
        opportunities: opps,
        totalValue,
        urgentCount
      };
    })
    .sort((a, b) => a.prsName.localeCompare(b.prsName));
}

// Badge component
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
}

const Badge: React.FC<BadgeProps> = ({ children, variant = 'default' }) => {
  return (
    <span className={`renewal-badge ${variant}`}>
      {children}
    </span>
  );
};

// Sort header component
interface SortHeaderProps {
  label: string;
  field: SortField;
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
}

const SortHeader: React.FC<SortHeaderProps> = ({ label, field, sortConfig, onSort }) => {
  const isActive = sortConfig.field === field && sortConfig.direction !== null;

  return (
    <th
      className="renewal-sortable-header"
      onClick={() => onSort(field)}
    >
      <div className="renewal-header-content">
        <span>{label}</span>
        <span className={`renewal-sort-icon ${isActive ? 'active' : ''}`}>
          {sortConfig.field === field && sortConfig.direction === 'asc' ? (
            <ChevronUp size={14} />
          ) : sortConfig.field === field && sortConfig.direction === 'desc' ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronsUpDown size={14} />
          )}
        </span>
      </div>
    </th>
  );
};

// Email composer modal
interface EmailComposerProps {
  template: EmailTemplate | null;
  opportunity: Opportunity | null;
  prsName: string;
  onSend: (data: { subject: string; body: string }) => void;
  onClose: () => void;
  canSend: boolean;
}

const EmailComposer: React.FC<EmailComposerProps> = ({ template, opportunity, prsName, onSend, onClose, canSend }) => {
  const [subject, setSubject] = useState(template?.subject || '');
  const [body, setBody] = useState(template?.body || '');

  useEffect(() => {
    if (template && opportunity) {
      let processedSubject = template.subject;
      let processedBody = template.body;

      const formattedRenewalDate = opportunity.renewalDate
        ? new Date(opportunity.renewalDate).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })
        : 'TBD';

      const invoiceNumber = `INV-${opportunity.id.substring(0, 8).toUpperCase()}`;

      const replacements: Record<string, string | number> = {
        '{{contact_name}}': opportunity.contactName || opportunity.ownerName || 'Customer',
        '{{product_name}}': opportunity.productName || 'axe DevTools',
        '{{renewal_date}}': formattedRenewalDate,
        '{{prs_name}}': prsName,
        '{{amount}}': opportunity.amount ? formatCurrency(opportunity.amount) : 'As quoted',
        '{{company_name}}': opportunity.companyName,
        '{{invoice_number}}': invoiceNumber,
        '{{due_date}}': formattedRenewalDate
      };

      Object.entries(replacements).forEach(([key, value]) => {
        processedSubject = processedSubject.replace(new RegExp(key, 'g'), String(value));
        processedBody = processedBody.replace(new RegExp(key, 'g'), String(value));
      });

      setSubject(processedSubject);
      setBody(processedBody);
    }
  }, [template, opportunity, prsName]);

  const toEmail = opportunity?.contactEmail || opportunity?.ownerEmail || '';
  const toName = opportunity?.contactName || opportunity?.ownerName || 'Customer';

  return (
    <div className="renewal-email-modal">
      <div className="renewal-email-content">
        <div className="renewal-email-header">
          <h3 className="renewal-email-title">Compose Email</h3>
          <button onClick={onClose} className="renewal-close-btn">
            <X size={20} />
          </button>
        </div>
        <div className="renewal-email-body">
          {!canSend && (
            <div className="renewal-email-warning">
              <AlertTriangle size={16} />
              <span>Only authorized PRS users (Rashi, Brandi) can send emails. You can preview but not send.</span>
            </div>
          )}
          <div className="renewal-email-field">
            <label>To</label>
            <input
              type="text"
              value={toEmail ? `${toName} <${toEmail}>` : 'No email address on file'}
              readOnly
              className="renewal-email-input readonly"
            />
          </div>
          <div className="renewal-email-field">
            <label>From</label>
            <input
              type="text"
              value={`${prsName} <${prsName.toLowerCase().replace(/\s+/g, '.')}@deque.com>`}
              readOnly
              className="renewal-email-input readonly"
            />
          </div>
          <div className="renewal-email-field">
            <label>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="renewal-email-input"
            />
          </div>
          <div className="renewal-email-field">
            <label>Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="renewal-email-textarea"
            />
          </div>
        </div>
        <div className="renewal-email-footer">
          <button className="renewal-btn secondary" onClick={onClose}>Cancel</button>
          <button
            className={`renewal-btn primary ${!canSend ? 'disabled' : ''}`}
            onClick={() => canSend && onSend({ subject, body })}
            disabled={!canSend}
            title={!canSend ? 'Only Rashi or Brandi can send emails' : 'Send email'}
          >
            <Send size={16} /> {canSend ? 'Send Email' : 'Cannot Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

// PRS Card component - expandable card for each PRS owner
interface PRSCardProps {
  portfolio: PRSPortfolio;
  expanded: boolean;
  onToggle: () => void;
  isCurrentUser: boolean;
  canExecute: boolean;
  onExecuteAction: (opp: Opportunity, action: RequiredAction) => void;
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
}

const PRSCard: React.FC<PRSCardProps> = ({
  portfolio,
  expanded,
  onToggle,
  isCurrentUser,
  canExecute,
  onExecuteAction,
  sortConfig,
  onSort
}) => {
  // Sort opportunities within the card
  const sortedOpportunities = useMemo(() => {
    if (!sortConfig.direction) return portfolio.opportunities;

    return [...portfolio.opportunities].sort((a, b) => {
      let comparison = 0;

      switch (sortConfig.field) {
        case 'opportunityName':
          comparison = a.opportunityName.localeCompare(b.opportunityName);
          break;
        case 'productName':
          comparison = a.productName.localeCompare(b.productName);
          break;
        case 'stage':
          comparison = a.stage.localeCompare(b.stage);
          break;
        case 'renewalStatus':
          comparison = (a.renewalStatus || '').localeCompare(b.renewalStatus || '');
          break;
        case 'accountingRenewalStatus':
          comparison = (a.accountingRenewalStatus || '').localeCompare(b.accountingRenewalStatus || '');
          break;
        case 'poRequired':
          comparison = (a.poRequired ? 1 : 0) - (b.poRequired ? 1 : 0);
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'renewalDate':
          comparison = new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime();
          break;
        case 'companyName':
          comparison = a.companyName.localeCompare(b.companyName);
          break;
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
          <div className="prs-avatar">
            <UserIcon size={20} />
          </div>
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
          <table className="renewal-table">
            <thead>
              <tr>
                <SortHeader label="Account" field="companyName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Opportunity Name" field="opportunityName" sortConfig={sortConfig} onSort={onSort} />
                <SortHeader label="Product Name" field="productName" sortConfig={sortConfig} onSort={onSort} />
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
                    <td className="renewal-account-cell">{opp.companyName}</td>
                    <td>{opp.opportunityName}</td>
                    <td>{opp.productName}</td>
                    <td>
                      <Badge variant={
                        opp.stage === 'Invoice confirmed' ? 'success' :
                        opp.stage === 'Ready for Invoicing' ? 'info' :
                        'default'
                      }>
                        {opp.stage}
                      </Badge>
                    </td>
                    <td>
                      {opp.renewalStatus ? (
                        <Badge variant={
                          opp.renewalStatus.toLowerCase().includes('complete') ? 'success' :
                          opp.renewalStatus.toLowerCase().includes('pending') ? 'warning' :
                          'default'
                        }>
                          {opp.renewalStatus}
                        </Badge>
                      ) : '-'}
                    </td>
                    <td>
                      {opp.accountingRenewalStatus ? (
                        <Badge variant={
                          opp.accountingRenewalStatus.toLowerCase().includes('complete') ? 'success' :
                          opp.accountingRenewalStatus.toLowerCase().includes('pending') ? 'warning' :
                          'default'
                        }>
                          {opp.accountingRenewalStatus}
                        </Badge>
                      ) : '-'}
                    </td>
                    <td>
                      {opp.poRequired ? (
                        <div className="po-status">
                          <Badge variant={opp.poReceivedDate ? 'success' : 'warning'}>
                            {opp.poReceivedDate ? 'Received' : 'Required'}
                          </Badge>
                          {opp.poReceivedDate && (
                            <span className="po-date">
                              {new Date(opp.poReceivedDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric'
                              })}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="po-not-required">Not Required</span>
                      )}
                    </td>
                    <td className="renewal-amount-cell">
                      {formatCurrency(opp.amount || 0)}
                    </td>
                    <td>
                      {new Date(opp.renewalDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </td>
                    <td>
                      {primaryAction ? (
                        <div className="renewal-action-cell">
                          <span className={`renewal-action-text ${primaryAction.priority}`}>
                            {isUrgent && <AlertTriangle size={14} />}
                            {primaryAction.description}
                          </span>
                          {canExecute && (
                            <button
                              className="renewal-btn primary sm"
                              onClick={() => onExecuteAction(opp, primaryAction)}
                            >
                              Execute
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="renewal-no-action">
                          <CheckCircle size={14} /> No action needed
                        </span>
                      )}
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

// Days options for the picker - same as RenewalAgent
const DAYS_OPTIONS = [30, 60, 90, 120, 180] as const;

// Main component
export function PRSRenewalView() {
  const { user, isAdmin } = useAuth();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [currentEmailTemplate, setCurrentEmailTemplate] = useState<EmailTemplate | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(60); // Same default as RenewalAgent
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPRS, setExpandedPRS] = useState<string | null>(null);

  // Determine current user's PRS status
  const currentUserEmail = user?.email?.toLowerCase() || '';
  const isPRS = PRS_USER_EMAILS.some(email => email.toLowerCase() === currentUserEmail);
  const canExecute = isPRS || isAdmin;
  const userName = user?.name || user?.email?.split('@')[0] || 'PRS User';

  // Load renewal opportunities
  useEffect(() => {
    async function loadOpportunities() {
      try {
        setLoading(true);
        const response = await fetchRenewalOpportunities(daysAhead);
        const opps = response.opportunities.map(transformApiOpportunity);
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

  // Handle sorting
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

  // Filter opportunities first, then group by PRS
  const prsPortfolios = useMemo(() => {
    let filtered = opportunities.filter(opp => {
      const matchesSearch = opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (opp.prsName || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (filter === 'all') return matchesSearch;
      if (filter === 'urgent') {
        const actions = WorkflowEngine.getRequiredActions(opp);
        return matchesSearch && actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
      }
      return matchesSearch;
    });

    return groupByPRS(filtered);
  }, [opportunities, searchQuery, filter]);

  const handleExecuteAction = useCallback((opp: Opportunity, action: RequiredAction) => {
    setSelectedOpportunity(opp);

    if (action.type === 'SEND_INVOICE_REMINDER' || action.type === 'SEND_FINAL_REMINDER') {
      setCurrentEmailTemplate(EMAIL_TEMPLATES[action.type] || null);
      setShowEmailComposer(true);
    } else {
      console.log('Executing action:', action.type, 'for', opp.opportunityName);
    }
  }, []);

  const handleSendEmail = useCallback(({ subject, body }: { subject: string; body: string }) => {
    console.log('Sending email:', { subject, body, to: selectedOpportunity?.contactEmail });
    setShowEmailComposer(false);
    setCurrentEmailTemplate(null);
    setSelectedOpportunity(null);
  }, [selectedOpportunity]);

  // State for At Risk modal
  const [showAtRiskModal, setShowAtRiskModal] = useState(false);

  // Calculate overall stats - memoized to ensure proper updates when data changes
  const { totalValue, urgentCount, uniqueAccounts, atRiskOpportunities, atRiskCount, atRiskValue } = useMemo(() => {
    const total = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const urgent = opportunities.filter(opp => {
      const actions = WorkflowEngine.getRequiredActions(opp);
      return actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
    }).length;
    const accounts = new Set(opportunities.map(opp => opp.accountId)).size;
    const atRiskOpps = opportunities.filter(opp => opp.atRisk === true);
    const riskCount = atRiskOpps.length;
    const riskValue = atRiskOpps.reduce((sum, opp) => sum + (opp.amount || 0), 0);

    return {
      totalValue: total,
      urgentCount: urgent,
      uniqueAccounts: accounts,
      atRiskOpportunities: atRiskOpps,
      atRiskCount: riskCount,
      atRiskValue: riskValue
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
    return (
      <div className="prs-view">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="prs-view">
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {prsPortfolios.length} PRS portfolios</span>
        </div>
      )}

      {/* Stats summary */}
      <div className="renewal-stats-grid">
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon slate">
              <FileText size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{opportunities.length}</p>
              <p className="renewal-stat-label">Total Renewals</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon blue">
              <UserIcon size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{uniqueAccounts}</p>
              <p className="renewal-stat-label">Accounts</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon green">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{formatCurrency(totalValue)}</p>
              <p className="renewal-stat-label">Total Value</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{urgentCount}</p>
              <p className="renewal-stat-label">Urgent Actions</p>
            </div>
          </div>
        </div>
        <div
          className={`renewal-stat-card clickable ${atRiskCount > 0 ? 'at-risk' : ''}`}
          onClick={() => atRiskCount > 0 && setShowAtRiskModal(true)}
          style={{ cursor: atRiskCount > 0 ? 'pointer' : 'default' }}
        >
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon orange">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{atRiskCount}</p>
              <p className="renewal-stat-label">At Risk</p>
              {atRiskCount > 0 && (
                <p className="renewal-stat-subtext">{formatCurrency(atRiskValue)} value</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="renewal-card">
        <div className="renewal-filter-bar">
          <div className="renewal-search-wrapper">
            <Search size={16} className="renewal-search-icon" />
            <input
              type="text"
              placeholder="Search by account, opportunity, product, or PRS name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="renewal-search-input"
            />
          </div>
          <div className="renewal-days-picker">
            <span className="renewal-days-label">Next</span>
            {DAYS_OPTIONS.map(days => (
              <button
                key={days}
                onClick={() => setDaysAhead(days)}
                className={`renewal-days-btn ${daysAhead === days ? 'active' : ''}`}
              >
                {days} days
              </button>
            ))}
          </div>
          <div className="renewal-filter-buttons">
            <button
              onClick={() => setFilter('all')}
              className={`renewal-filter-btn ${filter === 'all' ? 'active' : ''}`}
            >
              All ({opportunities.length})
            </button>
            <button
              onClick={() => setFilter('urgent')}
              className={`renewal-filter-btn urgent ${filter === 'urgent' ? 'active' : ''}`}
            >
              Urgent ({urgentCount})
            </button>
          </div>
        </div>
      </div>

      {/* PRS Portfolios List */}
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
              canExecute={canExecute}
              onExecuteAction={handleExecuteAction}
              sortConfig={sortConfig}
              onSort={handleSort}
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

      {/* Email composer modal */}
      {showEmailComposer && selectedOpportunity && (
        <EmailComposer
          template={currentEmailTemplate}
          opportunity={selectedOpportunity}
          prsName={userName}
          onSend={handleSendEmail}
          onClose={() => {
            setShowEmailComposer(false);
            setCurrentEmailTemplate(null);
            setSelectedOpportunity(null);
          }}
          canSend={canExecute}
        />
      )}

      {/* At Risk Modal */}
      {showAtRiskModal && (
        <div className="renewal-email-modal">
          <div className="renewal-email-content at-risk-modal">
            <div className="renewal-email-header">
              <h3 className="renewal-email-title">
                <AlertTriangle size={20} className="at-risk-icon" />
                Renewals at Risk ({atRiskCount})
              </h3>
              <button onClick={() => setShowAtRiskModal(false)} className="renewal-close-btn">
                <X size={20} />
              </button>
            </div>
            <div className="at-risk-summary">
              <span className="at-risk-total-value">Total Value at Risk: {formatCurrency(atRiskValue)}</span>
            </div>
            <div className="at-risk-body">
              <table className="renewal-table at-risk-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Opportunity</th>
                    <th>Product</th>
                    <th>PRS</th>
                    <th>Renewal Status</th>
                    <th>Accounting Status</th>
                    <th>PO Status</th>
                    <th>Amount</th>
                    <th>Renewal Date</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskOpportunities.map(opp => (
                    <tr key={opp.id} className="renewal-opp-row at-risk">
                      <td className="renewal-account-cell">{opp.companyName}</td>
                      <td>{opp.opportunityName}</td>
                      <td>{opp.productName}</td>
                      <td>{opp.prsName || 'Unassigned'}</td>
                      <td>
                        {opp.renewalStatus ? (
                          <Badge variant={
                            opp.renewalStatus.toLowerCase().includes('complete') ? 'success' :
                            opp.renewalStatus.toLowerCase().includes('pending') ? 'warning' :
                            'default'
                          }>
                            {opp.renewalStatus}
                          </Badge>
                        ) : '-'}
                      </td>
                      <td>
                        {opp.accountingRenewalStatus ? (
                          <Badge variant={
                            opp.accountingRenewalStatus.toLowerCase().includes('complete') ? 'success' :
                            opp.accountingRenewalStatus.toLowerCase().includes('pending') ? 'warning' :
                            'default'
                          }>
                            {opp.accountingRenewalStatus}
                          </Badge>
                        ) : '-'}
                      </td>
                      <td>
                        {opp.poRequired ? (
                          <div className="po-status">
                            <Badge variant={opp.poReceivedDate ? 'success' : 'warning'}>
                              {opp.poReceivedDate ? 'Received' : 'Required'}
                            </Badge>
                            {opp.poReceivedDate && (
                              <span className="po-date">
                                {new Date(opp.poReceivedDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="po-not-required">Not Required</span>
                        )}
                      </td>
                      <td className="renewal-amount-cell">{formatCurrency(opp.amount || 0)}</td>
                      <td>
                        {new Date(opp.renewalDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {atRiskOpportunities.length === 0 && (
                <div className="renewal-empty">
                  <CheckCircle size={48} className="renewal-empty-icon success" />
                  <p>No renewals currently at risk</p>
                </div>
              )}
            </div>
            <div className="renewal-email-footer">
              <button className="renewal-btn secondary" onClick={() => setShowAtRiskModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
