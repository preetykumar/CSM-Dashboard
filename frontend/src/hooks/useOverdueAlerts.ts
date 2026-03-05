import { useMemo, useEffect, useRef } from 'react';
import type { Opportunity, OverdueItem } from '../types/renewal';
import { WorkflowEngine } from '../services/workflow-engine';
import { useToast } from '../components/renewal/ToastProvider';

export function useOverdueAlerts(opportunities: Opportunity[]) {
  const { addToast } = useToast();
  const hasNotified = useRef(false);

  const overdueItems = useMemo(() => {
    const items: OverdueItem[] = [];
    for (const opp of opportunities) {
      const overdueForOpp = WorkflowEngine.getOverdueActions(opp);
      items.push(...overdueForOpp);
    }
    // Sort by daysPastDue descending (most overdue first)
    return items.sort((a, b) => b.daysPastDue - a.daysPastDue);
  }, [opportunities]);

  const hasOverdue = overdueItems.length > 0;

  // Fire toast notifications once per page load when overdue items are detected
  useEffect(() => {
    if (hasOverdue && !hasNotified.current) {
      hasNotified.current = true;

      const criticalItems = overdueItems.filter(i => i.action.priority === 'critical');
      const urgentItems = overdueItems.filter(i => i.action.priority === 'urgent');
      const highItems = overdueItems.filter(i => i.action.priority === 'high');

      if (criticalItems.length > 0) {
        addToast(
          `${criticalItems.length} renewal${criticalItems.length !== 1 ? 's' : ''} past renewal date — invoice not confirmed`,
          'error',
          12000
        );
      }
      if (urgentItems.length > 0) {
        addToast(
          `${urgentItems.length} missed milestone${urgentItems.length !== 1 ? 's' : ''} — quote/invoicing actions overdue (R-2, R-3)`,
          'warning',
          10000
        );
      }
      if (highItems.length > 0) {
        addToast(
          `${highItems.length} missed R-6 milestone${highItems.length !== 1 ? 's' : ''} — initial contact overdue`,
          'warning',
          8000
        );
      }
    }
  }, [hasOverdue, overdueItems, addToast]);

  return { overdueItems, hasOverdue };
}
