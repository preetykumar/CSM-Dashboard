import type { VelocitySnapshot } from "../types";

interface TicketStats {
  new: number;
  open: number;
  pending: number;
  hold: number;
}

interface VelocityBannerProps {
  velocity: VelocitySnapshot;
  ticketStats?: TicketStats;
  onBugsFixedClick?: () => void;
  onFeaturesCompletedClick?: () => void;
  onStatusClick?: (status: string) => void;
}

export function VelocityBanner({
  velocity,
  ticketStats,
  onBugsFixedClick,
  onFeaturesCompletedClick,
  onStatusClick,
}: VelocityBannerProps) {
  const { bugsFixed, featuresCompleted, period } = velocity;

  const handleStatusClick = (status: string) => {
    if (onStatusClick) {
      onStatusClick(status);
    }
  };

  // Monthly progress showing bugs fixed and features completed
  // Total closed/solved counts are shown in the quarterly QBR summaries instead
  return (
    <div className="velocity-banner">
      <div className="velocity-header">
        <span className="velocity-period">{period} Progress</span>
      </div>

      {/* Active ticket statuses with drill-down */}
      {ticketStats && (
        <div className="velocity-statuses">
          {ticketStats.new > 0 && (
            <span
              className={`velocity-status new ${onStatusClick ? 'clickable' : ''}`}
              onClick={() => handleStatusClick('new')}
            >
              <span className="velocity-count">{ticketStats.new}</span> new
            </span>
          )}
          {ticketStats.open > 0 && (
            <span
              className={`velocity-status open ${onStatusClick ? 'clickable' : ''}`}
              onClick={() => handleStatusClick('open')}
            >
              <span className="velocity-count">{ticketStats.open}</span> open
            </span>
          )}
          {ticketStats.pending > 0 && (
            <span
              className={`velocity-status pending ${onStatusClick ? 'clickable' : ''}`}
              onClick={() => handleStatusClick('pending')}
            >
              <span className="velocity-count">{ticketStats.pending}</span> pending
            </span>
          )}
          {ticketStats.hold > 0 && (
            <span
              className={`velocity-status hold ${onStatusClick ? 'clickable' : ''}`}
              onClick={() => handleStatusClick('hold')}
            >
              <span className="velocity-count">{ticketStats.hold}</span> on hold
            </span>
          )}
        </div>
      )}

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
