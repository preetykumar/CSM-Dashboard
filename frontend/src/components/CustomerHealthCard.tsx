import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const fetchOptions: RequestInit = { credentials: "include" as const };

type Signal = "green" | "yellow" | "red";

interface HealthSignal {
  signal: Signal;
  label: string;
  detail?: string;
}

interface DimensionScore {
  signal: Signal;
  signals: HealthSignal[];
}

interface HealthScoreResponse {
  accountName: string;
  adoption: DimensionScore;
  engagement: DimensionScore;
  support: DimensionScore;
  manualHealthScore?: string;
  manualHealthDescription?: string;
  riskDrivers?: string;
  interpretation?: string;
}

interface Props {
  accountName: string;
  compact?: boolean;
}

const SIGNAL_COLORS: Record<Signal, string> = {
  green: "#16a34a",
  yellow: "#ca8a04",
  red: "#dc2626",
};

const SIGNAL_LABELS: Record<Signal, string> = {
  green: "Healthy",
  yellow: "Needs Attention",
  red: "At Risk",
};

function SignalDot({ signal, size = 14 }: { signal: Signal; size?: number }) {
  return (
    <span
      className={`health-dot health-dot-${signal}`}
      style={{ width: size, height: size, backgroundColor: SIGNAL_COLORS[signal] }}
      aria-label={SIGNAL_LABELS[signal]}
    />
  );
}

function DimensionSection({ title, dimension, defaultExpanded = false }: { title: string; dimension: DimensionScore; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="health-dimension">
      <button
        className="health-dimension-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <SignalDot signal={dimension.signal} />
        <span className="health-dimension-title">{title}</span>
        <span className="health-dimension-label">{SIGNAL_LABELS[dimension.signal]}</span>
        <span className="expand-icon">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>
      {expanded && (
        <ul className="health-signals-list">
          {dimension.signals.map((s, i) => (
            <li key={i} className="health-signal-item">
              <SignalDot signal={s.signal} size={10} />
              <span className="health-signal-label">{s.label}</span>
              {s.detail && <span className="health-signal-detail">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerHealthCard({ accountName, compact }: Props) {
  const [data, setData] = useState<HealthScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/health/${encodeURIComponent(accountName)}`, fetchOptions)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load health score");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accountName]);

  if (loading) {
    return (
      <div className="health-card health-card-loading">
        <div className="spinner-small" />
        <span>Loading health score...</span>
      </div>
    );
  }

  if (error || !data) return null;

  // Compact mode: just 3 dots inline
  if (compact) {
    return (
      <div className="health-card-compact" title={`Adoption: ${SIGNAL_LABELS[data.adoption.signal]} | Engagement: ${SIGNAL_LABELS[data.engagement.signal]} | Support: ${SIGNAL_LABELS[data.support.signal]}`}>
        <span className="health-compact-label">Health</span>
        <SignalDot signal={data.adoption.signal} size={12} />
        <SignalDot signal={data.engagement.signal} size={12} />
        <SignalDot signal={data.support.signal} size={12} />
        {data.manualHealthScore && (
          <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
            {data.manualHealthScore}
          </span>
        )}
      </div>
    );
  }

  // Full mode
  return (
    <div className="health-card">
      <div className="health-card-header">
        <h4 className="health-card-title">Customer Health</h4>
        <div className="health-summary-dots">
          <span className="health-dot-group">
            <SignalDot signal={data.adoption.signal} />
            <SignalDot signal={data.engagement.signal} />
            <SignalDot signal={data.support.signal} />
          </span>
        </div>
      </div>

      {data.interpretation && (
        <p className="health-interpretation">{data.interpretation}</p>
      )}

      <DimensionSection title="Product Adoption" dimension={data.adoption} />
      <DimensionSection title="Customer Engagement" dimension={data.engagement} />
      <DimensionSection title="Support" dimension={data.support} />

      {data.manualHealthScore && (
        <div className="health-manual-section">
          <div className="health-manual-header">
            <span className="health-manual-label">Manual Health Score</span>
            <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
              {data.manualHealthScore}
            </span>
          </div>
          {data.manualHealthDescription && (
            <p className="health-manual-description">{data.manualHealthDescription}</p>
          )}
          {data.riskDrivers && (
            <p className="health-risk-drivers">
              <strong>Risk Drivers:</strong> {data.riskDrivers}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
