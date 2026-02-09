import React, { useState, useEffect, useReducer, useMemo } from 'react';
import { Mail, AlertTriangle, CheckCircle, FileText, Phone, RefreshCw, User as UserIcon, DollarSign, Bell, X, Search, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { fetchRenewalOpportunities, RenewalOpportunity as ApiRenewalOpportunity } from '../services/api';

// TypeScript interfaces

interface Activity {
  type: 'email' | 'call' | 'escalation' | 'update';
  description: string;
  timestamp: string;
}

interface Opportunity {
  id: string;
  opportunityName: string;
  companyName: string;
  accountId: string;
  productName: string;
  renewalDate: string;
  amount: number;
  stage: string;
  primaryContact: boolean;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactVerified: boolean;
  email1Sent: boolean;
  email1Response: boolean;
  daysSinceEmail1?: number;
  requiresNewOrderForm?: boolean;
  orderFormSent?: boolean;
  requiresNewPO: boolean;
  poReceived: boolean;
  quoteSent?: boolean;
  quoteSentDate?: string;
  daysSinceQuoteSent?: number;
  invoiceReady?: boolean;
  invoiceNumber?: string;
  dueDate?: string;
  subscriptionPeriod?: string;
  customerRequestedChange?: boolean;
  changeRequiresAE?: boolean;
  aeInvolved?: boolean;
  aeInvolvementRequested?: boolean;
  aeResponded?: boolean;
  daysSinceAERequest?: number;
  daysSinceAEContact?: number;
  aeResponse?: boolean;
  daysSinceCustomerTeamContact?: number;
  contactResolved?: boolean;
  ae?: string;
  em?: string;
  tsa?: string;
  activeUsers?: number;
  testsRun?: number;
  issuesFound?: number;
  activities: Activity[];
}

interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface EmailQueueItem {
  id: string;
  opportunityId: string;
  template: string;
}

interface Escalation {
  id: number;
  opportunityId: string;
  type: string;
  timestamp: string;
}

interface State {
  opportunities: Opportunity[];
  activeOpportunity: Opportunity | null;
  notifications: Notification[];
  emailQueue: EmailQueueItem[];
  escalations: Escalation[];
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_OPPORTUNITIES'; payload: Opportunity[] }
  | { type: 'SELECT_OPPORTUNITY'; payload: Opportunity | null }
  | { type: 'UPDATE_OPPORTUNITY'; payload: Partial<Opportunity> & { id: string } }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'ADD_TO_EMAIL_QUEUE'; payload: EmailQueueItem }
  | { type: 'REMOVE_FROM_EMAIL_QUEUE'; payload: string }
  | { type: 'ADD_ESCALATION'; payload: Escalation }
  | { type: 'RESOLVE_ESCALATION'; payload: number }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

interface RequiredAction {
  type: string;
  priority: 'critical' | 'urgent' | 'high' | 'medium';
  description: string;
}

interface EscalationCheck {
  type: string;
  level: string;
  description: string;
}

interface EmailTemplate {
  subject: string;
  body: string;
}

type SortField = 'opportunityName' | 'productName' | 'stage' | 'amount' | 'renewalDate' | 'action' | 'companyName';
type SortDirection = 'asc' | 'desc' | null;

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// State management
const initialState: State = {
  opportunities: [],
  activeOpportunity: null,
  notifications: [],
  emailQueue: [],
  escalations: [],
  loading: true,
  error: null
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_OPPORTUNITIES':
      return { ...state, opportunities: action.payload, loading: false };
    case 'SELECT_OPPORTUNITY':
      return { ...state, activeOpportunity: action.payload };
    case 'UPDATE_OPPORTUNITY':
      return {
        ...state,
        opportunities: state.opportunities.map(opp =>
          opp.id === action.payload.id ? { ...opp, ...action.payload } : opp
        ),
        activeOpportunity: state.activeOpportunity?.id === action.payload.id
          ? { ...state.activeOpportunity, ...action.payload }
          : state.activeOpportunity
      };
    case 'ADD_NOTIFICATION':
      return { ...state, notifications: [action.payload, ...state.notifications].slice(0, 50) };
    case 'ADD_TO_EMAIL_QUEUE':
      return { ...state, emailQueue: [...state.emailQueue, action.payload] };
    case 'REMOVE_FROM_EMAIL_QUEUE':
      return { ...state, emailQueue: state.emailQueue.filter(e => e.id !== action.payload) };
    case 'ADD_ESCALATION':
      return { ...state, escalations: [...state.escalations, action.payload] };
    case 'RESOLVE_ESCALATION':
      return { ...state, escalations: state.escalations.filter(e => e.id !== action.payload) };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    default:
      return state;
  }
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
        if (!opportunity.contactVerified) {
          if (!opportunity.primaryContact) {
            actions.push({ type: 'CONTACT_AE', priority: 'high', description: 'No known contact - reach out to AE' });
          } else if (!opportunity.email1Sent) {
            actions.push({ type: 'SEND_EMAIL_1', priority: 'high', description: 'Send initial contact email with usage summary' });
          } else if (opportunity.email1Sent && !opportunity.email1Response && (opportunity.daysSinceEmail1 ?? 0) >= 7) {
            actions.push({ type: 'CONTACT_CUSTOMER_TEAM', priority: 'high', description: 'No response - contact EM, TSA, IE, or AE' });
          }
        }
        break;

      case 'R-4':
      case 'R-3':
        if (opportunity.requiresNewOrderForm && !opportunity.orderFormSent) {
          actions.push({ type: 'GENERATE_ORDER_FORM', priority: 'high', description: 'Generate and send new order form' });
        }
        if (opportunity.requiresNewPO) {
          if (!opportunity.quoteSent) {
            actions.push({ type: 'SEND_QUOTE', priority: 'high', description: 'Send quote with PO request' });
          } else if (!opportunity.poReceived) {
            const daysSinceQuote = opportunity.daysSinceQuoteSent || 0;
            if (daysSinceQuote >= 14) {
              actions.push({ type: 'CALL_CUSTOMER', priority: 'urgent', description: 'Call customer - 2 weeks without PO' });
            } else if (daysSinceQuote >= 7) {
              actions.push({ type: 'SEND_EMAIL_3', priority: 'high', description: 'Send PO reminder to procurement' });
            }
          }
        }
        if (opportunity.customerRequestedChange) {
          if (opportunity.changeRequiresAE && !opportunity.aeInvolved) {
            actions.push({ type: 'INVOLVE_AE', priority: 'high', description: 'AE involvement needed for requested changes' });
          } else {
            actions.push({ type: 'GENERATE_NEW_ORDER_FORM', priority: 'medium', description: 'Generate updated order form' });
          }
        }
        break;

      case 'R-2':
        if (!opportunity.invoiceReady) {
          actions.push({ type: 'ESCALATE_MISSING_INFO', priority: 'urgent', description: 'Missing info for invoice - escalate to EM/Sales leaders' });
        } else if (opportunity.stage !== 'Ready for Invoicing') {
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
          actions.push({ type: 'ESCALATE_TO_EM_LEADER', priority: 'critical', description: 'Escalate to EM leader internally' });
        }
        break;
    }

    return actions;
  },

  checkEscalations: (opportunity: Opportunity): EscalationCheck[] => {
    const escalations: EscalationCheck[] = [];

    if ((opportunity.daysSinceAEContact ?? 0) >= 7 && !opportunity.aeResponse) {
      escalations.push({ type: 'AE_NO_RESPONSE', level: 'manager', description: 'AE not responding after 1 week' });
    }
    if ((opportunity.daysSinceCustomerTeamContact ?? 0) >= 14 && !opportunity.contactResolved) {
      escalations.push({ type: 'NO_CONTACT_RESOLVED', level: 'leadership', description: 'Contact not resolved - escalate to EM and Sales leaders' });
    }

    if (opportunity.aeInvolvementRequested && (opportunity.daysSinceAERequest ?? 0) >= 3 && !opportunity.aeResponded) {
      escalations.push({ type: 'AE_CHANGE_NO_RESPONSE', level: 'sales_leader', description: 'AE not responding to change request - 3 days' });
    }

    if (WorkflowEngine.getMilestone(opportunity.renewalDate) === 'R-2' && !opportunity.invoiceReady) {
      escalations.push({ type: 'MISSING_INVOICE_INFO', level: 'leadership', description: 'Missing information for invoice at R-2' });
    }

    return escalations;
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

// Milestone tracker component
const MilestoneTracker: React.FC<{ currentMilestone: string }> = ({ currentMilestone }) => {
  const milestones = ['R-6', 'R-4', 'R-3', 'R-2', 'R-1', 'R'];
  const currentIndex = milestones.indexOf(currentMilestone);

  return (
    <div className="renewal-milestones">
      {milestones.map((milestone, index) => {
        const isPast = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <React.Fragment key={milestone}>
            <div className={`renewal-milestone ${isPast ? 'past' : isCurrent ? 'current' : 'future'}`}>
              {isPast ? <CheckCircle size={16} /> : milestone}
            </div>
            {index < milestones.length - 1 && (
              <div className={`renewal-milestone-line ${index < currentIndex ? 'past' : 'future'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Action card component (display only - execution is in PRS view)
interface ActionCardProps {
  action: RequiredAction;
}

const ActionCard: React.FC<ActionCardProps> = ({ action }) => {
  const priorityBadge: Record<string, 'danger' | 'warning' | 'info' | 'default'> = {
    critical: 'danger',
    urgent: 'warning',
    high: 'info',
    medium: 'default'
  };

  return (
    <div className={`renewal-action-card ${action.priority}`}>
      <div className="renewal-action-card-content">
        <div className="renewal-action-card-info">
          <div className="renewal-action-card-header">
            <Badge variant={priorityBadge[action.priority]}>{action.priority}</Badge>
            <span className="renewal-action-type">{action.type}</span>
          </div>
          <p className="renewal-action-description">{action.description}</p>
        </div>
      </div>
    </div>
  );
};

// Email preview modal (read-only in this view - execution is in PRS view)
interface EmailComposerProps {
  template: EmailTemplate | null;
  opportunity: Opportunity | null;
  onClose: () => void;
}

const EmailComposer: React.FC<EmailComposerProps> = ({ template, opportunity, onClose }) => {
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

      const formattedQuoteDate = opportunity.quoteSentDate
        ? new Date(opportunity.quoteSentDate).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })
        : new Date().toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });

      const formattedDueDate = opportunity.dueDate
        ? new Date(opportunity.dueDate).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })
        : formattedRenewalDate;

      const invoiceNumber = opportunity.invoiceNumber || `INV-${opportunity.id.substring(0, 8).toUpperCase()}`;

      const replacements: Record<string, string | number> = {
        '{{contact_name}}': opportunity.contactName || opportunity.ae || 'Customer',
        '{{product_name}}': opportunity.productName || 'axe DevTools',
        '{{renewal_date}}': formattedRenewalDate,
        '{{active_users}}': opportunity.activeUsers || 'N/A',
        '{{tests_run}}': opportunity.testsRun || 'N/A',
        '{{issues_found}}': opportunity.issuesFound || 'N/A',
        '{{prs_name}}': 'Product Renewal Specialist',
        '{{subscription_period}}': opportunity.subscriptionPeriod || '12 months',
        '{{amount}}': opportunity.amount ? formatCurrency(opportunity.amount) : 'As quoted',
        '{{company_name}}': opportunity.companyName,
        '{{quote_date}}': formattedQuoteDate,
        '{{invoice_number}}': invoiceNumber,
        '{{due_date}}': formattedDueDate
      };

      Object.entries(replacements).forEach(([key, value]) => {
        processedSubject = processedSubject.replace(new RegExp(key, 'g'), String(value));
        processedBody = processedBody.replace(new RegExp(key, 'g'), String(value));
      });

      setSubject(processedSubject);
      setBody(processedBody);
    }
  }, [template, opportunity]);

  const toEmail = opportunity?.contactEmail || '';
  const toName = opportunity?.contactName || opportunity?.ae || 'Customer';

  return (
    <div className="renewal-email-modal">
      <div className="renewal-email-content">
        <div className="renewal-email-header">
          <h3 className="renewal-email-title">Email Preview</h3>
          <button onClick={onClose} className="renewal-close-btn">
            <X size={20} />
          </button>
        </div>
        <div className="renewal-email-body">
          <div className="renewal-email-warning">
            <AlertTriangle size={16} />
            <span>This is a preview only. To send emails, use the "By PRS (QBR View)" tab.</span>
          </div>
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
            <label>Subject</label>
            <input
              type="text"
              value={subject}
              readOnly
              className="renewal-email-input readonly"
            />
          </div>
          <div className="renewal-email-field">
            <label>Body</label>
            <textarea
              value={body}
              readOnly
              rows={12}
              className="renewal-email-textarea readonly"
            />
          </div>
        </div>
        <div className="renewal-email-footer">
          <button className="renewal-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// Timeline/Activity log
const ActivityLog: React.FC<{ activities: Activity[] }> = ({ activities }) => (
  <div className="renewal-timeline">
    {activities.map((activity, index) => (
      <div key={index} className="renewal-timeline-item">
        <div className="renewal-timeline-icon-col">
          <div className={`renewal-timeline-icon ${activity.type}`}>
            {activity.type === 'email' && <Mail size={14} />}
            {activity.type === 'call' && <Phone size={14} />}
            {activity.type === 'escalation' && <AlertTriangle size={14} />}
            {activity.type === 'update' && <RefreshCw size={14} />}
          </div>
          {index < activities.length - 1 && <div className="renewal-timeline-line" />}
        </div>
        <div className="renewal-timeline-content">
          <p className="renewal-timeline-text">{activity.description}</p>
          <p className="renewal-timeline-time">{activity.timestamp}</p>
        </div>
      </div>
    ))}
  </div>
);

// Opportunity detail panel (read-only in this view - execution is in PRS view)
interface OpportunityDetailProps {
  opportunity: Opportunity;
  onClose: () => void;
}

const OpportunityDetail: React.FC<OpportunityDetailProps> = ({ opportunity, onClose }) => {
  const [activeTab, setActiveTab] = useState('actions');
  const milestone = WorkflowEngine.getMilestone(opportunity.renewalDate);
  const requiredActions = WorkflowEngine.getRequiredActions(opportunity);
  const escalations = WorkflowEngine.checkEscalations(opportunity);

  const tabs = [
    { id: 'actions', label: 'Required Actions', count: requiredActions.length },
    { id: 'timeline', label: 'Activity', count: opportunity.activities?.length || 0 },
    { id: 'details', label: 'Details', count: null }
  ];

  return (
    <div className="renewal-detail">
      <div className="renewal-detail-header">
        <div className="renewal-detail-top">
          <div>
            <h2 className="renewal-detail-title">{opportunity.opportunityName}</h2>
            <p className="renewal-detail-subtitle">{opportunity.companyName} · {opportunity.productName}</p>
          </div>
          <button onClick={onClose} className="renewal-close-btn">
            <X size={20} />
          </button>
        </div>

        <MilestoneTracker currentMilestone={milestone} />

        <div className="renewal-detail-grid">
          <div className="renewal-detail-item">
            <p className="renewal-detail-label">Renewal Date</p>
            <p className="renewal-detail-value">{new Date(opportunity.renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div className="renewal-detail-item">
            <p className="renewal-detail-label">Total Price</p>
            <p className="renewal-detail-value">{formatCurrency(opportunity.amount || 0)}</p>
          </div>
          <div className="renewal-detail-item">
            <p className="renewal-detail-label">Stage</p>
            <p className="renewal-detail-value">{opportunity.stage}</p>
          </div>
        </div>

        {escalations.length > 0 && (
          <div className="renewal-escalation-alert">
            <AlertTriangle size={16} />
            <span>{escalations.length} escalation(s) required</span>
          </div>
        )}
      </div>

      <div className="renewal-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`renewal-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
            {tab.count !== null && tab.count > 0 && (
              <span className="renewal-tab-count">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="renewal-tab-content">
        {activeTab === 'actions' && (
          <div className="renewal-actions-list">
            {requiredActions.length > 0 ? (
              requiredActions.map((action, index) => (
                <ActionCard key={index} action={action} />
              ))
            ) : (
              <div className="renewal-no-actions">
                <CheckCircle size={32} className="renewal-no-actions-icon" />
                <p>No actions required at this time</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <ActivityLog activities={opportunity.activities || []} />
        )}

        {activeTab === 'details' && (
          <div className="renewal-details-section">
            <div className="renewal-details-group">
              <h4>Contact Information</h4>
              <div className="renewal-details-box">
                <div className="renewal-details-row">
                  <span>Primary Contact</span>
                  <span>{opportunity.contactName || 'Not set'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>Email</span>
                  <span>{opportunity.contactEmail || 'Not set'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>Phone</span>
                  <span>{opportunity.contactPhone || 'Not set'}</span>
                </div>
              </div>
            </div>

            <div className="renewal-details-group">
              <h4>Account Team</h4>
              <div className="renewal-details-box">
                <div className="renewal-details-row">
                  <span>AE</span>
                  <span>{opportunity.ae || 'Not assigned'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>EM</span>
                  <span>{opportunity.em || 'Not assigned'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>TSA</span>
                  <span>{opportunity.tsa || 'Not assigned'}</span>
                </div>
              </div>
            </div>

            <div className="renewal-details-group">
              <h4>Renewal Details</h4>
              <div className="renewal-details-box">
                <div className="renewal-details-row">
                  <span>Requires New Order Form</span>
                  <span>{opportunity.requiresNewOrderForm ? 'Yes' : 'No'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>Requires New PO</span>
                  <span>{opportunity.requiresNewPO ? 'Yes' : 'No'}</span>
                </div>
                <div className="renewal-details-row">
                  <span>PO Received</span>
                  <span>{opportunity.poReceived ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Dashboard stats
const DashboardStats: React.FC<{ opportunities: Opportunity[] }> = ({ opportunities }) => {
  const totalValue = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
  const urgentCount = opportunities.filter(opp => {
    const actions = WorkflowEngine.getRequiredActions(opp);
    return actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
  }).length;
  const uniqueAccounts = new Set(opportunities.map(opp => opp.accountId)).size;

  const stats = [
    { label: 'Total Renewals', value: opportunities.length, icon: FileText, colorClass: 'slate' },
    { label: 'Accounts', value: uniqueAccounts, icon: UserIcon, colorClass: 'blue' },
    { label: 'Total Value', value: formatCurrency(totalValue), icon: DollarSign, colorClass: 'green' },
    { label: 'Urgent Actions', value: urgentCount, icon: AlertTriangle, colorClass: 'red' }
  ];

  return (
    <div className="renewal-stats-grid">
      {stats.map((stat, index) => (
        <div key={index} className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className={`renewal-stat-icon ${stat.colorClass}`}>
              <stat.icon size={20} />
            </div>
            <div>
              <p className="renewal-stat-value">{stat.value}</p>
              <p className="renewal-stat-label">{stat.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
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
    primaryContact: !!apiOpp.contactName,
    contactName: apiOpp.contactName,
    contactEmail: apiOpp.contactEmail,
    contactVerified: false,
    email1Sent: false,
    email1Response: false,
    requiresNewPO: true,
    poReceived: false,
    ae: apiOpp.ownerName,
    activities: []
  };
}

// Days options for the picker
const DAYS_OPTIONS = [60, 90, 120, 180] as const;

// Main App
export default function RenewalAgent() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [currentEmailTemplate, setCurrentEmailTemplate] = useState<EmailTemplate | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'renewalDate', direction: 'asc' });
  const [daysAhead, setDaysAhead] = useState<number>(60);

  // Fetch renewal opportunities from API
  useEffect(() => {
    async function loadOpportunities() {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        const response = await fetchRenewalOpportunities(daysAhead);
        const opportunities = response.opportunities.map(transformApiOpportunity);
        dispatch({ type: 'SET_OPPORTUNITIES', payload: opportunities });
      } catch (error) {
        console.error('Failed to fetch renewal opportunities:', error);
        dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to load renewals' });
      }
    }
    loadOpportunities();
  }, [daysAhead]);

  // Handle sorting
  const handleSort = (field: SortField) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        // Cycle through: asc -> desc -> null
        if (prev.direction === 'asc') return { field, direction: 'desc' };
        if (prev.direction === 'desc') return { field, direction: null };
        return { field, direction: 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  // Filter and sort opportunities (flat list, no grouping)
  const sortedOpportunities = useMemo(() => {
    // Filter opportunities
    let filtered = state.opportunities.filter(opp => {
      const matchesSearch = opp.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.opportunityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            opp.productName.toLowerCase().includes(searchQuery.toLowerCase());

      if (filter === 'all') return matchesSearch;
      if (filter === 'urgent') {
        const actions = WorkflowEngine.getRequiredActions(opp);
        return matchesSearch && actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
      }
      return matchesSearch;
    });

    // Sort opportunities
    if (sortConfig.direction) {
      filtered = [...filtered].sort((a, b) => {
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
    }

    return filtered;
  }, [state.opportunities, searchQuery, filter, sortConfig]);

  // Loading state
  if (state.loading) {
    return (
      <div className="renewal-loading">
        <div className="renewal-loading-content">
          <div className="renewal-spinner" />
          <p className="renewal-loading-text">Loading renewal opportunities...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div className="renewal-error">
        <div className="renewal-error-content">
          <AlertTriangle size={48} className="renewal-error-icon" />
          <h2 className="renewal-error-title">Failed to Load Renewals</h2>
          <p className="renewal-error-message">{state.error}</p>
          <button onClick={() => window.location.reload()} className="renewal-retry-btn">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="renewal-agent">
      {/* Header */}
      <header className="renewal-header">
        <div className="renewal-header-content">
          <div className="renewal-logo">
            <div className="renewal-logo-icon">
              <RefreshCw size={18} />
            </div>
            <div>
              <h1 className="renewal-title">Renewal Agent</h1>
              <p className="renewal-subtitle">Subscription Management Automation</p>
            </div>
          </div>

          <div className="renewal-header-actions">
            <div className="renewal-notification-btn">
              <Bell size={20} />
              {state.notifications.length > 0 && (
                <span className="renewal-notification-badge">
                  {state.notifications.length}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="renewal-main">
        {/* Stats */}
        <DashboardStats opportunities={state.opportunities} />

        {/* Search and Filter */}
        <div className="renewal-card">
          <div className="renewal-filter-bar">
            <div className="renewal-search-wrapper">
              <Search size={16} className="renewal-search-icon" />
              <input
                type="text"
                placeholder="Search renewals by account, opportunity, or product..."
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
                All ({state.opportunities.length})
              </button>
              <button
                onClick={() => setFilter('urgent')}
                className={`renewal-filter-btn urgent ${filter === 'urgent' ? 'active' : ''}`}
              >
                Urgent
              </button>
            </div>
          </div>
        </div>

        {/* Renewals Table */}
        <div className="renewal-card">
          <div style={{ overflowX: 'auto' }}>
            <table className="renewal-table">
              <thead>
                <tr>
                  <SortHeader label="Account" field="companyName" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Opportunity Name" field="opportunityName" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Product Name" field="productName" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Stage" field="stage" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Total Price" field="amount" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Renewal Date" field="renewalDate" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Action Needed" field="action" sortConfig={sortConfig} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedOpportunities.map(opp => {
                  const actions = WorkflowEngine.getRequiredActions(opp);
                  const primaryAction = actions[0];
                  const isUrgent = actions.some(a => a.priority === 'critical' || a.priority === 'urgent');

                  return (
                    <tr
                      key={opp.id}
                      className={`renewal-opp-row ${isUrgent ? 'urgent' : ''}`}
                    >
                      <td className="renewal-account-cell">{opp.companyName}</td>
                      <td>
                        <button
                          className="renewal-opp-name-btn"
                          onClick={() => dispatch({ type: 'SELECT_OPPORTUNITY', payload: opp })}
                        >
                          {opp.opportunityName}
                        </button>
                      </td>
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
                          <button
                            onClick={() => dispatch({ type: 'SELECT_OPPORTUNITY', payload: opp })}
                            className={`renewal-action-link ${primaryAction.priority}`}
                          >
                            {isUrgent && <AlertTriangle size={14} />}
                            <span>{primaryAction.description}</span>
                            {actions.length > 1 && (
                              <span className="renewal-action-more">(+{actions.length - 1})</span>
                            )}
                          </button>
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
            {sortedOpportunities.length === 0 && (
              <div className="renewal-empty">
                <FileText size={48} className="renewal-empty-icon" />
                <p>No renewal opportunities found</p>
              </div>
            )}
          </div>
        </div>

        {/* Opportunity Detail Modal */}
        {state.activeOpportunity && (
          <div className="renewal-modal-overlay">
            <div className="renewal-modal">
              <OpportunityDetail
                opportunity={state.activeOpportunity}
                onClose={() => dispatch({ type: 'SELECT_OPPORTUNITY', payload: null })}
              />
            </div>
          </div>
        )}

        {/* Workflow rules reference */}
        <div className="renewal-card">
          <div className="renewal-workflow-rules">
            <h3 className="renewal-workflow-title">Workflow Rules Reference</h3>
            <div className="renewal-workflow-grid">
              <div className="renewal-workflow-item">
                <h4 className="renewal-workflow-header">
                  <span className="renewal-workflow-badge">R-6</span>
                  Contact Phase
                </h4>
                <ul className="renewal-workflow-list">
                  <li>• Send Email #1 with usage data</li>
                  <li>• Verify renewal contact</li>
                  <li>• Escalate if no contact in SF</li>
                </ul>
              </div>
              <div className="renewal-workflow-item">
                <h4 className="renewal-workflow-header">
                  <span className="renewal-workflow-badge">R-3/4</span>
                  Documentation Phase
                </h4>
                <ul className="renewal-workflow-list">
                  <li>• Generate order form if required</li>
                  <li>• Send quote, request PO</li>
                  <li>• Handle change requests</li>
                </ul>
              </div>
              <div className="renewal-workflow-item">
                <h4 className="renewal-workflow-header">
                  <span className="renewal-workflow-badge">R-2</span>
                  Invoice Phase
                </h4>
                <ul className="renewal-workflow-list">
                  <li>• Generate and send invoice</li>
                  <li>• Follow up after 2 weeks</li>
                  <li>• Track confirmation</li>
                </ul>
              </div>
              <div className="renewal-workflow-item warning">
                <h4 className="renewal-workflow-header">
                  <span className="renewal-workflow-badge">R-1</span>
                  Warning Phase
                </h4>
                <ul className="renewal-workflow-list">
                  <li>• Send payment reminder</li>
                  <li>• Warn of service disruption</li>
                </ul>
              </div>
              <div className="renewal-workflow-item danger">
                <h4 className="renewal-workflow-header">
                  <span className="renewal-workflow-badge">R</span>
                  Critical Phase
                </h4>
                <ul className="renewal-workflow-list">
                  <li>• Final reminder sent</li>
                  <li>• 30-day grace period</li>
                  <li>• Escalate to EM leader</li>
                </ul>
              </div>
              <div className="renewal-workflow-item purple">
                <h4 className="renewal-workflow-header">Escalation Rules</h4>
                <ul className="renewal-workflow-list">
                  <li>• No AE response: 1 week → manager</li>
                  <li>• No contact: 2 weeks → leadership</li>
                  <li>• Missing info at R-2 → leadership</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Email preview modal (read-only in this view) */}
      {showEmailComposer && (
        <EmailComposer
          template={currentEmailTemplate}
          opportunity={state.activeOpportunity}
          onClose={() => {
            setShowEmailComposer(false);
            setCurrentEmailTemplate(null);
          }}
        />
      )}
    </div>
  );
}
