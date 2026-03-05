import React, { useState, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { OverdueItem } from '../../types/renewal';

interface OverdueBannerProps {
  overdueItems: OverdueItem[];
}

const INITIAL_ITEMS = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function groupByPRS(items: OverdueItem[]): [string, OverdueItem[]][] {
  const groups = new Map<string, OverdueItem[]>();
  for (const item of items) {
    const prs = item.opportunity.prsName || 'Unassigned';
    if (!groups.has(prs)) groups.set(prs, []);
    groups.get(prs)!.push(item);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}

interface CategoryGroup {
  key: string;
  label: string;
  showIcon: boolean;
  cssClass: string;
  items: OverdueItem[];
  groupedByPRS: [string, OverdueItem[]][];
}

export const OverdueBanner: React.FC<OverdueBannerProps> = ({ overdueItems }) => {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const categories = useMemo((): CategoryGroup[] => {
    const critical = overdueItems.filter(i => i.stageCategory === 'critical' || !i.stageCategory);
    const onHoldSync = overdueItems.filter(i => i.stageCategory === 'on-hold-sync');
    const onHoldPastR = overdueItems.filter(i => i.stageCategory === 'on-hold-past-r');

    const result: CategoryGroup[] = [];

    if (critical.length > 0) {
      result.push({
        key: 'critical',
        label: 'Critical Actions — PRS / CSM Leadership',
        showIcon: true,
        cssClass: 'overdue-section-critical',
        items: critical,
        groupedByPRS: groupByPRS(critical),
      });
    }
    if (onHoldPastR.length > 0) {
      result.push({
        key: 'on-hold-past-r',
        label: 'On Hold — Past Renewal Date',
        showIcon: true,
        cssClass: 'overdue-section-on-hold-critical',
        items: onHoldPastR,
        groupedByPRS: groupByPRS(onHoldPastR),
      });
    }
    if (onHoldSync.length > 0) {
      result.push({
        key: 'on-hold-sync',
        label: 'On Hold — AE Sync Required',
        showIcon: false,
        cssClass: 'overdue-section-on-hold-sync',
        items: onHoldSync,
        groupedByPRS: groupByPRS(onHoldSync),
      });
    }

    return result;
  }, [overdueItems]);

  if (overdueItems.length === 0 || dismissed) return null;

  const criticalCount = overdueItems.filter(i => (i.stageCategory === 'critical' || !i.stageCategory) && (i.action.priority === 'critical' || i.action.priority === 'urgent')).length;
  const onHoldCount = overdueItems.filter(i => i.stageCategory === 'on-hold-sync' || i.stageCategory === 'on-hold-past-r').length;

  return (
    <div className="overdue-banner">
      <div className="overdue-banner-header" onClick={() => setExpanded(!expanded)}>
        <div className="overdue-banner-left">
          <AlertTriangle size={18} />
          <span className="overdue-banner-text">
            {overdueItems.length} missed milestone{overdueItems.length !== 1 ? 's' : ''} across all renewals
            {criticalCount > 0 && <span className="overdue-critical-badge">{criticalCount} critical</span>}
            {onHoldCount > 0 && <span className="overdue-on-hold-badge">{onHoldCount} on hold</span>}
          </span>
        </div>
        <div className="overdue-banner-right">
          <button className="overdue-dismiss-btn" onClick={(e) => { e.stopPropagation(); setDismissed(true); }}>
            Dismiss
          </button>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>
      {expanded && (
        <div className="overdue-banner-details">
          {categories.map(cat => (
            <div key={cat.key} className={`overdue-section ${cat.cssClass}`}>
              <div className="overdue-section-header">
                {cat.showIcon && <AlertTriangle size={16} />}
                <span className="overdue-section-label">{cat.label}</span>
                <span className="overdue-section-count">{cat.items.length}</span>
              </div>
              {cat.groupedByPRS.map(([prsName, items]) => {
                const visibleItems = showAll ? items : items.slice(0, INITIAL_ITEMS);
                const hasMore = !showAll && items.length > INITIAL_ITEMS;

                return (
                  <div key={prsName} className="overdue-prs-group">
                    <div className="overdue-prs-header">
                      <span className="overdue-prs-name">{prsName}</span>
                      <span className="overdue-prs-count">{items.length} overdue</span>
                    </div>
                    <table className="overdue-table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>AE</th>
                          <th>Product</th>
                          <th>Milestone</th>
                          <th>Overdue Action</th>
                          <th>Due Date</th>
                          <th>Days Past Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItems.map((item, idx) => (
                          <tr key={`${item.opportunity.id}-${item.milestone}-${idx}`} className={`overdue-row ${item.action.priority}`}>
                            <td>{item.opportunity.companyName}</td>
                            <td>{item.opportunity.ownerName || '-'}</td>
                            <td>{item.opportunity.productName}</td>
                            <td><span className={`overdue-milestone ${item.milestone}`}>{item.milestone}</span></td>
                            <td>{item.action.description}</td>
                            <td className="overdue-due-date">{formatDate(item.dueDate)}</td>
                            <td><span className={`overdue-days ${item.daysPastDue > 30 ? 'severe' : ''}`}>{item.daysPastDue} days</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hasMore && (
                      <button className="overdue-show-all-btn" onClick={() => setShowAll(true)}>
                        Show all {items.length} overdue actions for {prsName}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {!showAll && overdueItems.length > INITIAL_ITEMS && (
            <button className="overdue-show-all-btn" onClick={() => setShowAll(true)}>
              Show all {overdueItems.length} overdue actions
            </button>
          )}
          {showAll && overdueItems.length > INITIAL_ITEMS && (
            <button className="overdue-show-all-btn" onClick={() => setShowAll(false)}>
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
};
