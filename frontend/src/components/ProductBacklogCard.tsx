import { useState, useMemo } from "react";
import type { ProductBacklog, ModuleSummary, Ticket, GitHubDevelopmentStatus } from "../types";

interface ProductBacklogCardProps {
  backlog: ProductBacklog;
  onModuleClick: (productName: string, moduleName: string, tickets: Ticket[]) => void;
  onFeaturesClick?: (productName: string, moduleName: string, tickets: Ticket[]) => void;
  onBugsClick?: (productName: string, moduleName: string, tickets: Ticket[]) => void;
  githubStatusByTicketId?: Map<number, GitHubDevelopmentStatus[]>;
}

export function ProductBacklogCard({ backlog, onModuleClick, onFeaturesClick, onBugsClick, githubStatusByTicketId }: ProductBacklogCardProps) {
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
              githubStatusByTicketId={githubStatusByTicketId}
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
  githubStatusByTicketId?: Map<number, GitHubDevelopmentStatus[]>;
}

function ModuleRow({ module, onClick, onFeaturesClick, onBugsClick, githubStatusByTicketId }: ModuleRowProps) {
  const featurePercent = module.features.total > 0
    ? Math.round((module.features.completed / module.features.total) * 100)
    : 0;

  // Aggregate GitHub statuses for tickets in this module
  const githubStatuses = useMemo(() => {
    if (!githubStatusByTicketId) return [];

    const statuses: GitHubDevelopmentStatus[] = [];
    for (const ticket of module.tickets) {
      const ticketStatuses = githubStatusByTicketId.get(ticket.id);
      if (ticketStatuses) {
        statuses.push(...ticketStatuses);
      }
    }
    return statuses;
  }, [module.tickets, githubStatusByTicketId]);

  const hasGitHubStatus = githubStatuses.length > 0;

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
      </div>

      {/* Ticket Status Section */}
      <div className="ticket-status-section">
        <div className="ticket-status-header">Ticket Status</div>
        <div className="ticket-status-rows">
          <div className="status-row github-status">
            <span className="status-row-label">Development (GitHub):</span>
            {hasGitHubStatus ? (
              <GitHubStatusSummary statuses={githubStatuses} />
            ) : (
              <span className="no-github-links">No linked issues</span>
            )}
          </div>
        </div>
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

// GitHub Status Summary Component
interface GitHubStatusSummaryProps {
  statuses: GitHubDevelopmentStatus[];
}

function GitHubStatusSummary({ statuses }: GitHubStatusSummaryProps) {
  // Deduplicate by GitHub URL (same issue may appear multiple times)
  const uniqueStatuses = useMemo(() => {
    const seen = new Set<string>();
    return statuses.filter((s) => {
      const key = s.githubUrl || `${s.repoName}#${s.issueNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [statuses]);

  const handleLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering module row click
  };

  return (
    <span className="github-status-summary">
      <span className="github-issue-links">
        {uniqueStatuses.map((status, idx) => (
          <a
            key={status.githubUrl || `${status.repoName}-${status.issueNumber}-${idx}`}
            href={status.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`github-issue-link status-${(status.projectStatus || "unknown").toLowerCase().replace(/\s+/g, "-")}`}
            title={`${status.repoName}#${status.issueNumber}${status.sprint ? ` | ${status.sprint}` : ""}${status.projectStatus ? ` | ${status.projectStatus}` : ""}`}
            onClick={handleLinkClick}
          >
            <span className="github-issue-repo">{status.repoName}</span>
            <span className="github-issue-number">#{status.issueNumber}</span>
            {status.projectStatus && (
              <span className={`github-issue-status status-${status.projectStatus.toLowerCase().replace(/\s+/g, "-")}`}>
                {status.projectStatus}
              </span>
            )}
          </a>
        ))}
      </span>
    </span>
  );
}
