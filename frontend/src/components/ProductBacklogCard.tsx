import { useState } from "react";
import type { ProductBacklog, ModuleSummary, Ticket } from "../types";

interface ProductBacklogCardProps {
  backlog: ProductBacklog;
  onModuleClick: (productName: string, moduleName: string, tickets: Ticket[]) => void;
}

export function ProductBacklogCard({ backlog, onModuleClick }: ProductBacklogCardProps) {
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
}

function ModuleRow({ module, onClick }: ModuleRowProps) {
  const featurePercent = module.features.total > 0
    ? Math.round((module.features.completed / module.features.total) * 100)
    : 0;

  return (
    <div className="module-row" onClick={onClick}>
      <div className="module-header">
        <span className="module-name">{module.moduleName}</span>
        <span className={`module-status status-${module.status.toLowerCase().replace(/\s+/g, "-")}`}>
          {module.status}
        </span>
      </div>

      <div className="module-metrics">
        <div className="module-metric features-metric">
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

        <div className="module-metric bugs-metric">
          <span className="metric-label">Bugs:</span>
          <span className="bug-stats">
            <span className="bug-critical" title="Critical bugs fixed">
              {module.bugHealth.criticalFixed} critical ✓
            </span>
            <span className="bug-separator">|</span>
            <span className="bug-minor" title="Minor bugs pending">
              {module.bugHealth.minorPending} minor pending
            </span>
            {module.bugHealth.blockers > 0 && (
              <>
                <span className="bug-separator">|</span>
                <span className="bug-blockers" title="Blockers">
                  {module.bugHealth.blockers} blockers
                </span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
