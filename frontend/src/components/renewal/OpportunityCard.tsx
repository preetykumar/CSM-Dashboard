import React from 'react';
import { AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react';
import type { Opportunity, RequiredAction } from '../../types/renewal';
import { WorkflowEngine, getStageBadgeVariant } from '../../services/workflow-engine';
import { formatCurrency } from '../../utils/format';
import { Badge } from './Badge';

export type OpportunityCardMode = 'active' | 'overdue' | 'closed-lost' | 'closed-won';

interface OpportunityCardProps {
  opp: Opportunity;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onDraftEmail?: (opp: Opportunity, action: RequiredAction) => void;
  mode?: OpportunityCardMode;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export const OpportunityCard: React.FC<OpportunityCardProps> = ({
  opp,
  index,
  expanded,
  onToggle,
  onDraftEmail,
  mode = 'active',
}) => {
  const actions = WorkflowEngine.getRequiredActions(opp);
  const primaryAction = actions[0];
  const isUrgent = mode === 'active' && actions.some(a => a.priority === 'critical' || a.priority === 'urgent');
  const isOverdue = mode === 'overdue';
  const isLost = mode === 'closed-lost';
  const isWon = mode === 'closed-won';
  const dateLabel = formatDate(opp.renewalDate);
  const overdueDays = isOverdue ? daysSince(opp.renewalDate) : 0;
  const overdueClass = overdueDays > 30 ? 'critical' : overdueDays > 14 ? 'warning' : '';
  const showDraftEmail = mode === 'active' && primaryAction && onDraftEmail;

  return (
    <div
      className={`renewal-opp-card ${expanded ? 'expanded' : ''} ${isUrgent ? 'urgent' : ''} ${isLost ? 'lost' : ''} ${isWon ? 'won' : ''}`}
    >
      <div
        className="renewal-opp-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-expanded={expanded}
      >
        <div className="renewal-opp-header-main">
          <ChevronRight className={`prs-chevron ${expanded ? 'expanded' : ''}`} size={18} />
          <span className="renewal-opp-index">{index + 1}</span>
          <div className="renewal-opp-account">
            <span className="renewal-opp-account-name">{opp.companyName}</span>
            <div className="renewal-opp-meta">
              <Badge variant={getStageBadgeVariant(opp.stage)}>{opp.stage}</Badge>
              {mode === 'active' && (
                primaryAction ? (
                  <span className={`renewal-action-text ${primaryAction.priority}`}>
                    {isUrgent && <AlertTriangle size={12} />}
                    {primaryAction.description}
                  </span>
                ) : (
                  <span className="renewal-no-action"><CheckCircle size={12} /> No action needed</span>
                )
              )}
              {isOverdue && (
                <span className={`overdue-days ${overdueClass}`}>{overdueDays}d overdue</span>
              )}
              {opp.opportunityName && (
                <span className="renewal-opp-name-inline" title={opp.opportunityName}>{opp.opportunityName}</span>
              )}
            </div>
          </div>
        </div>
        <div className="renewal-opp-header-right">
          <span className="renewal-opp-amount">{formatCurrency(opp.amount || 0)}</span>
          <span className="renewal-opp-date">{dateLabel}</span>
        </div>
      </div>

      {expanded && (
        <div className="renewal-opp-body">
          <dl className="renewal-opp-fields">
            <div className="renewal-opp-field">
              <dt>AE</dt>
              <dd>{opp.ownerName || '-'}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>CSM</dt>
              <dd>{opp.csmName || 'Unassigned'}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>PRS</dt>
              <dd>{opp.prsName || 'Unassigned'}</dd>
            </div>
            <div className="renewal-opp-field renewal-opp-field-wide">
              <dt>Opportunity</dt>
              <dd>{opp.opportunityName || '-'}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Product</dt>
              <dd>{opp.productName || '-'}</dd>
            </div>
            {mode === 'active' && (
              <>
                <div className="renewal-opp-field">
                  <dt>Renewal Status</dt>
                  <dd>
                    {opp.renewalStatus ? (
                      <Badge variant={opp.renewalStatus.toLowerCase().includes('complete') ? 'success' : opp.renewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>
                        {opp.renewalStatus}
                      </Badge>
                    ) : '-'}
                  </dd>
                </div>
                <div className="renewal-opp-field">
                  <dt>Accounting Status</dt>
                  <dd>
                    {opp.accountingRenewalStatus ? (
                      <Badge variant={opp.accountingRenewalStatus.toLowerCase().includes('complete') ? 'success' : opp.accountingRenewalStatus.toLowerCase().includes('pending') ? 'warning' : 'default'}>
                        {opp.accountingRenewalStatus}
                      </Badge>
                    ) : '-'}
                  </dd>
                </div>
                <div className="renewal-opp-field">
                  <dt>PO Required</dt>
                  <dd>
                    {opp.poRequired ? (
                      <div className="po-status">
                        <Badge variant={opp.poReceivedDate ? 'success' : 'warning'}>
                          {opp.poReceivedDate ? 'Received' : 'Required'}
                        </Badge>
                        {opp.poReceivedDate && (
                          <span className="po-date">
                            {new Date(opp.poReceivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="po-not-required">Not Required</span>
                    )}
                  </dd>
                </div>
                <div className="renewal-opp-field">
                  <dt>Risk Status</dt>
                  <dd>
                    {opp.leadershipRiskStatus ? (
                      <Badge variant={opp.leadershipRiskStatus.toLowerCase().includes('resolved') ? 'success' : opp.leadershipRiskStatus.toLowerCase().includes('monitor') ? 'warning' : 'danger'}>
                        {opp.leadershipRiskStatus}
                      </Badge>
                    ) : '-'}
                  </dd>
                </div>
              </>
            )}
            {isOverdue && (
              <div className="renewal-opp-field">
                <dt>Days Overdue</dt>
                <dd>
                  <span className={`overdue-days ${overdueClass}`}>{overdueDays}d</span>
                </dd>
              </div>
            )}
          </dl>

          {opp.leadershipNotes && (
            <div className="renewal-opp-notes">
              <strong>Leadership Notes</strong>
              <p>{opp.leadershipNotes}</p>
            </div>
          )}

          {showDraftEmail && primaryAction && (
            <div className="renewal-opp-actions">
              <button className="renewal-btn primary sm" onClick={() => onDraftEmail!(opp, primaryAction)}>
                Draft Email
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
