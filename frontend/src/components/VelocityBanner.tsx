import type { VelocitySnapshot } from "../types";

interface VelocityBannerProps {
  velocity: VelocitySnapshot;
  onBugsFixedClick?: () => void;
  onFeaturesCompletedClick?: () => void;
}

export function VelocityBanner({
  velocity,
  onBugsFixedClick,
  onFeaturesCompletedClick,
}: VelocityBannerProps) {
  const { bugsFixed, featuresCompleted, period } = velocity;

  // Monthly progress showing bugs fixed and features completed
  // Total closed/solved counts are shown in the quarterly QBR summaries instead
  return (
    <div className="velocity-banner">
      <div className="velocity-header">
        <span className="velocity-period">{period} Progress</span>
      </div>
      <div className="velocity-breakdown">
        <span
          className={`velocity-bugs ${onBugsFixedClick ? 'clickable' : ''}`}
          onClick={onBugsFixedClick}
        >
          <span className="velocity-count">{bugsFixed}</span> bugs fixed
        </span>
        <span className="velocity-separator">|</span>
        <span
          className={`velocity-features ${onFeaturesCompletedClick ? 'clickable' : ''}`}
          onClick={onFeaturesCompletedClick}
        >
          <span className="velocity-count">{featuresCompleted}</span> features completed
        </span>
      </div>
    </div>
  );
}
