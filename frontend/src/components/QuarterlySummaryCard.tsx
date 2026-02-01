import type { QuarterlySummary } from "../types";

interface QuarterlySummaryCardProps {
  currentQuarter: QuarterlySummary;
  previousQuarter: QuarterlySummary;
  onBugsClick?: (quarter: "current" | "previous") => void;
  onFeaturesClick?: (quarter: "current" | "previous") => void;
  onTotalClick?: (quarter: "current" | "previous") => void;
}

export function QuarterlySummaryCard({
  currentQuarter,
  previousQuarter,
  onBugsClick,
  onFeaturesClick,
  onTotalClick,
}: QuarterlySummaryCardProps) {
  return (
    <div className="quarterly-summary-container">
      <h5 className="quarterly-header">Quarterly Summary</h5>
      <div className="quarterly-cards">
        <QuarterCard
          quarter={currentQuarter}
          isCurrent={true}
          onBugsClick={() => onBugsClick?.("current")}
          onFeaturesClick={() => onFeaturesClick?.("current")}
          onTotalClick={() => onTotalClick?.("current")}
        />
        <QuarterCard
          quarter={previousQuarter}
          isCurrent={false}
          onBugsClick={() => onBugsClick?.("previous")}
          onFeaturesClick={() => onFeaturesClick?.("previous")}
          onTotalClick={() => onTotalClick?.("previous")}
        />
      </div>
    </div>
  );
}

interface QuarterCardProps {
  quarter: QuarterlySummary;
  isCurrent: boolean;
  onBugsClick?: () => void;
  onFeaturesClick?: () => void;
  onTotalClick?: () => void;
}

function QuarterCard({
  quarter,
  isCurrent,
  onBugsClick,
  onFeaturesClick,
  onTotalClick,
}: QuarterCardProps) {
  return (
    <div className={`quarter-card ${isCurrent ? "current" : "previous"}`}>
      <div className="quarter-label">
        <span className="quarter-name">{quarter.quarter}</span>
        <span className="quarter-period">{quarter.period}</span>
      </div>
      <div className="quarter-stats">
        <div
          className="quarter-stat total clickable"
          onClick={onTotalClick}
        >
          <span className="stat-value">{quarter.totalClosed}</span>
          <span className="stat-label">Total Closed</span>
        </div>
        <div
          className="quarter-stat bugs clickable"
          onClick={onBugsClick}
        >
          <span className="stat-value">{quarter.bugsFixed}</span>
          <span className="stat-label">Bugs Fixed</span>
        </div>
        <div
          className="quarter-stat features clickable"
          onClick={onFeaturesClick}
        >
          <span className="stat-value">{quarter.featuresCompleted}</span>
          <span className="stat-label">Features</span>
        </div>
      </div>
    </div>
  );
}
