import { useState, useEffect } from "react";
import { fetchSyncStatus, triggerDeltaSync, SyncStatus } from "../services/api";

interface SyncButtonProps {
  className?: string;
}

export function SyncButton({ className }: SyncButtonProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Fetch sync status on mount and periodically while syncing
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await fetchSyncStatus();
        setSyncStatus(status);
      } catch (err) {
        console.error("Failed to fetch sync status:", err);
      }
    };

    fetchStatus();

    // Poll for status while syncing
    const interval = setInterval(async () => {
      const status = await fetchSyncStatus().catch(() => null);
      if (status) {
        setSyncStatus(status);
        // Stop polling if sync is complete
        if (!status.inProgress && loading) {
          setLoading(false);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [loading]);

  const handleSync = async () => {
    if (loading || syncStatus?.inProgress) return;

    setLoading(true);
    setError(null);

    try {
      await triggerDeltaSync();
      // Refresh status after triggering
      const status = await fetchSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setLoading(false);
    }
  };

  // Check if any sync is in progress (from status items or API flag)
  const ticketStatus = syncStatus?.status?.find(s => s.type === "tickets");
  const isTicketSyncing = ticketStatus?.status === "in_progress";
  const isInProgress = loading || syncStatus?.inProgress || isTicketSyncing;

  // Format last sync time
  const getLastSyncTime = () => {
    if (!syncStatus?.status) return null;
    const ticketSync = syncStatus.status.find(s => s.type === "tickets");
    if (ticketSync?.last_sync) {
      const date = new Date(ticketSync.last_sync);
      return date.toLocaleString();
    }
    return null;
  };

  const lastSync = getLastSyncTime();

  // Get current sync progress
  const getSyncProgress = () => {
    if (ticketStatus?.status === "in_progress" && ticketStatus.record_count > 0) {
      return `${ticketStatus.record_count.toLocaleString()} tickets fetched...`;
    }
    return null;
  };

  const syncProgress = getSyncProgress();

  return (
    <div
      className={`sync-button-container ${className || ""}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        className={`sync-button ${isInProgress ? "syncing" : ""}`}
        onClick={handleSync}
        disabled={isInProgress}
        aria-label={isInProgress ? "Sync in progress" : "Refresh data"}
        title={isInProgress ? "Sync in progress..." : "Refresh data (delta sync)"}
      >
        <span className={`sync-icon ${isInProgress ? "spinning" : ""}`}>
          {/* Refresh/sync icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </span>
        <span className="sync-text">
          {isInProgress ? (syncProgress || "Syncing...") : "Sync"}
        </span>
      </button>

      {showTooltip && syncStatus?.status && (
        <div className="sync-tooltip">
          <div className="sync-tooltip-content">
            {lastSync && <div><strong>Last sync:</strong> {lastSync}</div>}
            {isTicketSyncing && <div className="sync-progress-text">Sync in progress...</div>}
            {syncStatus.status.map(s => (
              <div key={s.type} className="sync-status-item">
                <span className={`status-dot ${s.status}`}></span>
                {s.type}: {s.record_count.toLocaleString()} records
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="sync-error" role="alert">
          {error}
        </div>
      )}

      <style>{`
        .sync-button-container {
          position: relative;
          display: inline-block;
        }

        .sync-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--button-bg, #2563eb);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .sync-button:hover:not(:disabled) {
          background: var(--button-hover-bg, #1d4ed8);
        }

        .sync-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .sync-button.syncing {
          background: var(--button-active-bg, #3b82f6);
        }

        .sync-icon {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sync-icon.spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .sync-tooltip {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          z-index: 1000;
        }

        .sync-tooltip-content {
          background: var(--tooltip-bg, #1f2937);
          color: white;
          padding: 12px;
          border-radius: 8px;
          font-size: 12px;
          min-width: 200px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .sync-status-item {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          text-transform: capitalize;
        }

        .sync-progress-text {
          color: #f59e0b;
          font-weight: 500;
          margin: 4px 0;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-dot.success {
          background: #22c55e;
        }

        .status-dot.error {
          background: #ef4444;
        }

        .status-dot.in_progress {
          background: #f59e0b;
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .sync-error {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          background: #fef2f2;
          color: #dc2626;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          border: 1px solid #fecaca;
          white-space: nowrap;
        }

        @media (max-width: 640px) {
          .sync-text {
            display: none;
          }

          .sync-button {
            padding: 8px;
          }
        }
      `}</style>
    </div>
  );
}
