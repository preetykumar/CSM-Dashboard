import { useState } from "react";
import type { ProductBacklog, ModuleSummary, Ticket } from "../types";

interface ProductBacklogCardProps {
  backlog: ProductBacklog;
  onModuleClick: (productName: string, moduleName: string, tickets: Ticket[]) => void;
  onFeaturesClick?: (productName: string, moduleName: string, tickets: Ticket[]) => void;
  onBugsClick?: (productName: string, moduleName: string, tickets: Ticket[]) => void;
}

export function ProductBacklogCard({ backlog, onModuleClick, onFeaturesClick, onBugsClick }: ProductBacklogCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="product-backlog-card">
      <div
        className="product-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="product-expand-icon">{expanded ? "▼" : "▶"}</span>
        <span className="product-name">{backlog.productName}</span>
        <span className="product-ticket-count">({backlog.totalOpenTickets} open)</span>
      </div>

      {expanded && (
        <div className="product-modules">
          {backlog.modules.map((module) => (
            <ModuleRow
              key={module.moduleName}
              module={module}
              productName={backlog.productName}
              onClick={() => onModuleClick(backlog.productName, module.moduleName, module.tickets)}
              onFeaturesClick={onFeaturesClick ? () => onFeaturesClick(backlog.productName, module.moduleName, module.features.tickets) : undefined}
              onBugsClick={onBugsClick ? () => onBugsClick(backlog.productName, module.moduleName, module.bugs.tickets) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ModuleRowProps {
  module: ModuleSummary;
  productName: string;
  onClick: () => void;
  onFeaturesClick?: () => void;
  onBugsClick?: () => void;
}

function ModuleRow({ module, onClick, onFeaturesClick, onBugsClick }: ModuleRowProps) {
  const featurePercent = module.features.total > 0
    ? Math.round((module.features.completed / module.features.total) * 100)
    : 0;

  const handleFeaturesClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onFeaturesClick) {
      onFeaturesClick();
    } else {
      onClick();
    }
  };

  const handleBugsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onBugsClick) {
      onBugsClick();
    } else {
      onClick();
    }
  };

  return (
    <div className="module-row" onClick={onClick}>
      <div className="module-header">
        <span className="module-name">{module.moduleName}</span>
        <span className={`module-status status-${module.status.toLowerCase().replace(/\s+/g, "-")}`}>
          {module.status}
        </span>
      </div>

      <div className="module-metrics">
        <div className="module-metric features-metric clickable" onClick={handleFeaturesClick}>
          <span className="metric-label">Features:</span>
          <div className="progress-bar-container">
            <div
              className="progress-bar-fill"
              style={{ width: `${featurePercent}%` }}
            />
          </div>
          <span className="metric-value">
            {module.features.completed}/{module.features.total}
          </span>
        </div>

        <div className="module-metric bugs-metric clickable" onClick={handleBugsClick}>
          <span className="metric-label">Bugs:</span>
          <span className="bug-stats">
            <span className="bug-total" title="Total bugs">
              {module.bugs.total} total
            </span>
            <span className="bug-separator">|</span>
            <span className="bug-open" title="Open bugs">
              {module.bugs.open} open
            </span>
            <span className="bug-separator">|</span>
            <span className="bug-fixed" title="Fixed bugs">
              {module.bugs.fixed} fixed
            </span>
            {module.bugs.blockers > 0 && (
              <>
                <span className="bug-separator">|</span>
                <span className="bug-blockers" title="Blockers">
                  {module.bugs.blockers} blockers
                </span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
