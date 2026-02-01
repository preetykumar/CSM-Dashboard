import type { VelocitySnapshot } from "../types";

interface VelocityBannerProps {
  velocity: VelocitySnapshot;
  onBugsFixedClick?: () => void;
  onFeaturesCompletedClick?: () => void;
  onClosedClick?: () => void;
}

export function VelocityBanner({
  velocity,
  onBugsFixedClick,
  onFeaturesCompletedClick,
  onClosedClick
}: VelocityBannerProps) {
  const { closedThisMonth, bugsFixed, featuresCompleted, period } = velocity;

  return (
    <div className="velocity-banner">
      <div className="velocity-header">
        <span className="velocity-period">{period}</span>
        <span
          className={`velocity-total ${onClosedClick ? 'clickable' : ''}`}
          onClick={onClosedClick}
        >
          Closed <strong>{closedThisMonth}</strong> tickets
        </span>
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
