import type { Opportunity, RequiredAction, RenewalMilestone, OverdueItem } from '../types/renewal';

// Stages that indicate the renewal is confirmed/invoiced/closed — no further action needed
const INVOICED_OR_DONE_STAGES = [
  '2 - Confirmed',
  '3 - Invoiced',
  '8 - Closed Won',
];

// Stages that indicate invoicing is at least in progress
const INVOICING_IN_PROGRESS_STAGES = [
  ...INVOICED_OR_DONE_STAGES,
  '2.5 Contracting',
];

// Stage indicating the renewal is paused at AE request
const ON_HOLD_STAGES = ['1 - On Hold'];

// Stage indicating the renewal was lost
const CLOSED_LOST_STAGES = ['9 - Closed Lost'];

// R-6 overdue items older than this are moved to Process Audit
const STALE_R6_THRESHOLD_DAYS = 150; // ~5 months

export function isInvoicedOrDone(stage: string): boolean {
  return INVOICED_OR_DONE_STAGES.includes(stage);
}

function isInvoicingInProgress(stage: string): boolean {
  return INVOICING_IN_PROGRESS_STAGES.includes(stage);
}

export function isOnHold(stage: string): boolean {
  return ON_HOLD_STAGES.includes(stage);
}

export function isClosedLost(stage: string): boolean {
  return CLOSED_LOST_STAGES.includes(stage);
}

export function getStageBadgeVariant(stage: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  if (isInvoicedOrDone(stage)) return 'success';
  if (isClosedLost(stage)) return 'danger';
  if (isInvoicingInProgress(stage)) return 'info';
  if (isOnHold(stage)) return 'warning';
  return 'default';
}

export const WorkflowEngine = {
  getMilestone: (renewalDate: string): RenewalMilestone => {
    const today = new Date();
    const renewal = new Date(renewalDate);
    // Calculate months difference using calendar months
    const monthsUntilRenewal =
      (renewal.getFullYear() - today.getFullYear()) * 12 +
      (renewal.getMonth() - today.getMonth());

    if (monthsUntilRenewal > 6) return 'R-6+';
    if (monthsUntilRenewal > 4) return 'R-6';   // 5-6 months out: initial contact window
    if (monthsUntilRenewal > 3) return 'R-4';   // ~4 months out: preparing quote
    if (monthsUntilRenewal > 2) return 'R-3';   // ~3 months out: send quote, request PO
    if (monthsUntilRenewal > 1) return 'R-2';   // ~2 months out: invoicing
    if (monthsUntilRenewal > 0) return 'R-1';   // ~1 month out: payment reminder
    return 'R';                                    // at or past renewal date
  },

  getRequiredActions: (opportunity: Opportunity): RequiredAction[] => {
    const milestone = WorkflowEngine.getMilestone(opportunity.renewalDate);
    const actions: RequiredAction[] = [];

    // Confirmed/Invoiced/Closed Won — no further action needed
    if (isInvoicedOrDone(opportunity.stage)) return actions;

    // Closed Lost — no action needed
    if (isClosedLost(opportunity.stage)) return actions;

    // On Hold: suppress standard PRS email actions; generate AE sync actions only
    if (isOnHold(opportunity.stage)) {
      if (milestone === 'R-2' || milestone === 'R-1') {
        actions.push({
          type: 'SYNC_WITH_AE',
          priority: 'medium',
          description: 'Sync with AE on on-hold renewal status'
        });
      }
      if (milestone === 'R') {
        actions.push({
          type: 'INFORM_SALES_LEADERSHIP',
          priority: 'critical',
          description: 'Inform sales leadership of on-hold status past renewal date'
        });
      }
      return actions;
    }

    switch (milestone) {
      case 'R-6':
        // R-6 Contact: Send Email #1 with usage info, verify renewal contact
        if (!opportunity.r6Notes) {
          actions.push({
            type: 'SEND_EMAIL_1',
            priority: 'high',
            description: 'Send Email #1: Usage check-in & verify renewal contact'
          });
        }
        break;

      case 'R-4':
      case 'R-3':
        // R-3/R-4 Contact: Quote and PO handling (only if R3 Notes not filled)
        if (!opportunity.r3Notes) {
          if (opportunity.poRequired && !opportunity.poReceivedDate) {
            actions.push({
              type: 'SEND_EMAIL_2',
              priority: 'high',
              description: 'Send Email #2: Quote with PO request to procurement'
            });
          } else if (!opportunity.poRequired) {
            actions.push({
              type: 'SEND_EMAIL_2',
              priority: 'high',
              description: 'Send Email #2: Quote as intimation for upcoming invoice'
            });
          }
        }
        break;

      case 'R-2':
        // R-2 Contact: Accounting generates invoice for "Ready for Invoicing" opps
        if (!isInvoicingInProgress(opportunity.stage)) {
          actions.push({
            type: 'MARK_READY_FOR_INVOICING',
            priority: 'high',
            description: 'Mark as Ready for Invoicing (escalate to EM/Sales if blocked)'
          });
        }
        break;

      case 'R-1':
        // R-1 Contact: If not invoiced/confirmed, send automated payment reminder
        if (!isInvoicedOrDone(opportunity.stage)) {
          actions.push({
            type: 'SEND_R1_EMAIL',
            priority: 'urgent',
            description: 'Send R-1 email: Payment reminder & service disruption warning'
          });
        }
        break;

      case 'R':
        // R Contact: If not invoiced/confirmed, send final reminder with grace period
        if (!isInvoicedOrDone(opportunity.stage)) {
          actions.push({
            type: 'SEND_R_EMAIL',
            priority: 'critical',
            description: 'Send R email: 30-day grace period warning, escalate to EM leader'
          });
        }
        break;
    }

    return actions;
  },

  getOverdueActions: (opportunity: Opportunity): OverdueItem[] => {
    const overdue: OverdueItem[] = [];

    // Confirmed/Invoiced/Closed Won — nothing overdue
    if (isInvoicedOrDone(opportunity.stage)) return overdue;

    // Closed Lost — nothing overdue
    if (isClosedLost(opportunity.stage)) return overdue;

    const today = new Date();
    const renewal = new Date(opportunity.renewalDate);
    const monthsUntilRenewal =
      (renewal.getFullYear() - today.getFullYear()) * 12 +
      (renewal.getMonth() - today.getMonth());

    // Helper: compute the date a milestone action was due (renewal date minus N months)
    const milestoneDueDate = (monthsBefore: number): string => {
      const due = new Date(renewal);
      due.setMonth(due.getMonth() - monthsBefore);
      return due.toISOString();
    };

    // On Hold: different overdue rules — AE-managed, not PRS email-driven
    if (isOnHold(opportunity.stage)) {
      // At R-2 or closer but before R: AE sync needed
      if (monthsUntilRenewal <= 1 && monthsUntilRenewal > 0) {
        const r2Due = new Date(milestoneDueDate(2));
        const daysPastDue = Math.max(0, Math.round((today.getTime() - r2Due.getTime()) / (24 * 60 * 60 * 1000)));
        overdue.push({
          opportunity,
          milestone: 'R-2',
          action: { type: 'SYNC_WITH_AE', priority: 'medium', description: 'On Hold — sync with AE on renewal status' },
          daysPastDue,
          dueDate: r2Due.toISOString(),
          stageCategory: 'on-hold-sync'
        });
      }
      // Past renewal date: critical escalation
      if (monthsUntilRenewal <= 0) {
        const daysPastDue = Math.max(0, Math.round((today.getTime() - renewal.getTime()) / (24 * 60 * 60 * 1000)));
        overdue.push({
          opportunity,
          milestone: 'R',
          action: { type: 'INFORM_SALES_LEADERSHIP', priority: 'critical', description: 'On Hold — past renewal date, inform sales leadership' },
          daysPastDue,
          dueDate: renewal.toISOString(),
          stageCategory: 'on-hold-past-r'
        });
      }
      return overdue;
    }

    // If we're at R-3 or closer but stage hasn't progressed, prior milestones are overdue
    // R-6 actions should have been done when 5-6 months out
    // Skip stale R-6 items (>5 months overdue) — those go to Process Audit
    if (monthsUntilRenewal <= 4) {
      // Past R-6 window — if R6 Notes is empty, Email #1 was not sent
      if (!opportunity.r6Notes) {
        const r6Due = new Date(milestoneDueDate(6));
        const daysPastDue = Math.max(0, Math.round((today.getTime() - r6Due.getTime()) / (24 * 60 * 60 * 1000)));
        if (daysPastDue <= STALE_R6_THRESHOLD_DAYS) {
          overdue.push({
            opportunity,
            milestone: 'R-6',
            action: { type: 'SEND_EMAIL_1', priority: 'high', description: 'Email #1 (usage check-in) was not sent at R-6 — R6 Notes is empty' },
            daysPastDue,
            dueDate: milestoneDueDate(6),
            stageCategory: 'critical'
          });
        }
      }
    }

    // R-3 actions should have been done when 3-4 months out
    if (monthsUntilRenewal <= 2) {
      if (!opportunity.r3Notes && !isInvoicedOrDone(opportunity.stage)) {
        const r3Due = new Date(milestoneDueDate(3));
        const daysPastDue = Math.max(0, Math.round((today.getTime() - r3Due.getTime()) / (24 * 60 * 60 * 1000)));
        overdue.push({
          opportunity,
          milestone: 'R-3',
          action: { type: 'SEND_EMAIL_2', priority: 'urgent', description: 'Quote/PO action overdue from R-3 — R3 Notes is empty' },
          daysPastDue,
          dueDate: milestoneDueDate(3),
          stageCategory: 'critical'
        });
      }
    }

    // R-2 actions: should be at "Ready for Invoicing" by now
    if (monthsUntilRenewal <= 1) {
      if (!isInvoicingInProgress(opportunity.stage)) {
        const r2Due = new Date(milestoneDueDate(2));
        const daysPastDue = Math.max(0, Math.round((today.getTime() - r2Due.getTime()) / (24 * 60 * 60 * 1000)));
        overdue.push({
          opportunity,
          milestone: 'R-2',
          action: { type: 'MARK_READY_FOR_INVOICING', priority: 'urgent', description: 'Not at "Ready for Invoicing" — overdue from R-2' },
          daysPastDue,
          dueDate: milestoneDueDate(2),
          stageCategory: 'critical'
        });
      }
    }

    // At or past renewal date and still not confirmed
    if (monthsUntilRenewal <= 0 && !isInvoicedOrDone(opportunity.stage)) {
      const daysPastDue = Math.max(0, Math.round((today.getTime() - renewal.getTime()) / (24 * 60 * 60 * 1000)));
      overdue.push({
        opportunity,
        milestone: 'R',
        action: { type: 'SEND_R_EMAIL', priority: 'critical', description: 'Past renewal date — invoice not confirmed, grace period active' },
        daysPastDue,
        dueDate: renewal.toISOString(),
        stageCategory: 'critical'
      });
    }

    return overdue;
  },

  /** Returns R-6 overdue items that are too old to action (>5 months overdue) — for Process Audit */
  getStaleAuditItems: (opportunity: Opportunity): OverdueItem[] => {
    const audit: OverdueItem[] = [];

    if (isInvoicedOrDone(opportunity.stage)) return audit;
    if (isClosedLost(opportunity.stage)) return audit;
    if (isOnHold(opportunity.stage)) return audit;

    const today = new Date();
    const renewal = new Date(opportunity.renewalDate);
    const monthsUntilRenewal =
      (renewal.getFullYear() - today.getFullYear()) * 12 +
      (renewal.getMonth() - today.getMonth());

    const milestoneDueDate = (monthsBefore: number): string => {
      const due = new Date(renewal);
      due.setMonth(due.getMonth() - monthsBefore);
      return due.toISOString();
    };

    if (monthsUntilRenewal <= 4 && !opportunity.r6Notes) {
      const r6Due = new Date(milestoneDueDate(6));
      const daysPastDue = Math.max(0, Math.round((today.getTime() - r6Due.getTime()) / (24 * 60 * 60 * 1000)));
      if (daysPastDue > STALE_R6_THRESHOLD_DAYS) {
        audit.push({
          opportunity,
          milestone: 'R-6',
          action: { type: 'SEND_EMAIL_1', priority: 'high', description: 'Email #1 (usage check-in) was not sent at R-6 — stale, process audit needed' },
          daysPastDue,
          dueDate: milestoneDueDate(6),
          stageCategory: 'critical'
        });
      }
    }

    return audit;
  }
};
