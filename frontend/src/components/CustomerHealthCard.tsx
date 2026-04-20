import { useEffect, useState } from "react";
import { fetchHealthScore, type HealthScoreResponse, type DimensionScore } from "../services/api";

type Signal = "green" | "yellow" | "red";

interface Props {
  accountName: string;
  compact?: boolean;
}

const SIGNAL_COLORS: Record<Signal, string> = {
  green: "#16a34a",
  yellow: "#ca8a04",
  red: "#dc2626",
};

const SIGNAL_BG: Record<Signal, string> = {
  green: "#dcfce7",
  yellow: "#fef3c7",
  red: "#fee2e2",
};

const SIGNAL_LABELS: Record<Signal, string> = {
  green: "Healthy",
  yellow: "Needs Attention",
  red: "At Risk",
};

// What each signal measures and the thresholds
const DIMENSION_INFO: Record<string, { title: string; description: string; thresholds: Array<{ label: string; green: string; yellow: string; red: string }> }> = {
  adoption: {
    title: "Product Adoption",
    description: "Is the customer realizing value from our products?",
    thresholds: [
      { label: "Seat Activation", green: "\u226570% assigned", yellow: "40\u201370%", red: "<40%" },
      { label: "Product Breadth", green: "3+ products", yellow: "2 products", red: "1 or none" },
    ],
  },
  engagement: {
    title: "Customer Engagement",
    description: "Is the relationship real and multi-threaded?",
    thresholds: [
      { label: "Executive Sponsor", green: "Named in Salesforce", yellow: "\u2014", red: "None identified" },
      { label: "Stakeholder Breadth", green: "3+ contacts, 2+ roles", yellow: "2 contacts", red: "1 or none" },
      { label: "Last Contact", green: "<30 days", yellow: "30\u201390 days", red: ">90 days" },
    ],
  },
  support: {
    title: "Support",
    description: "Is using our products painful for this customer?",
    thresholds: [
      { label: "Ticket Volume", green: "Weighted <20", yellow: "20\u201350", red: ">50" },
      { label: "Escalations", green: "0\u20131/quarter", yellow: "2\u20133", red: "4+" },
      { label: "Bug:How-to Ratio", green: "<40% bugs", yellow: "40\u201360%", red: ">60%" },
    ],
  },
};

function SignalDot({ signal, size = 14 }: { signal: Signal; size?: number }) {
  return (
    <span
      className="health-dot"
      style={{ width: size, height: size, backgroundColor: SIGNAL_COLORS[signal] }}
      aria-label={SIGNAL_LABELS[signal]}
    />
  );
}

function SignalPill({ signal }: { signal: Signal }) {
  return (
    <span className="health-signal-pill" style={{ backgroundColor: SIGNAL_BG[signal], color: SIGNAL_COLORS[signal] }}>
      {SIGNAL_LABELS[signal]}
    </span>
  );
}

function DimensionDetail({ dimKey, dimension }: { dimKey: string; dimension: DimensionScore }) {
  const info = DIMENSION_INFO[dimKey];
  if (!info) return null;

  return (
    <div className="health-dim-detail">
      <div className="health-dim-detail-header">
        <SignalDot signal={dimension.signal} size={14} />
        <div className="health-dim-detail-title">
          <strong>{info.title}</strong>
          <span className="health-dim-description">{info.description}</span>
        </div>
        <SignalPill signal={dimension.signal} />
      </div>

      <table className="health-dim-detail-table">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Current Value</th>
            <th>Status</th>
            <th className="health-threshold-col">Thresholds: Green / Yellow / Red</th>
          </tr>
        </thead>
        <tbody>
          {dimension.signals.map((s, i) => {
            const threshold = info.thresholds[i];
            return (
              <tr key={i}>
                <td className="health-signal-name">{s.label}</td>
                <td className="health-current-value">{s.detail || "\u2014"}</td>
                <td><SignalPill signal={s.signal} /></td>
                <td className="health-threshold-cell">
                  {threshold ? (
                    <span className="health-threshold-text">
                      <span className="threshold-green">{threshold.green}</span>
                      {" / "}
                      <span className="threshold-yellow">{threshold.yellow}</span>
                      {" / "}
                      <span className="threshold-red">{threshold.red}</span>
                    </span>
                  ) : "\u2014"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HealthInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="health-info-panel">
      <div className="health-info-header">
        <h4>How Customer Health is Calculated</h4>
        <button className="health-info-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="health-info-body">
        <p className="health-info-intro">
          Each customer is scored across three dimensions. Each signal within a dimension is rated
          <span className="threshold-green"> Green (Healthy)</span>,
          <span className="threshold-yellow"> Yellow (Needs Attention)</span>, or
          <span className="threshold-red"> Red (At Risk)</span>.
          The overall dimension score is the worst-of: 2+ reds = red, 1 red or 2+ yellows = yellow, otherwise green.
        </p>

        {Object.entries(DIMENSION_INFO).map(([key, dim]) => (
          <div key={key} className="health-info-dimension">
            <h5>{dim.title}</h5>
            <p className="health-dim-description">{dim.description}</p>
            <table className="health-formula-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th style={{ color: SIGNAL_COLORS.green }}>Green</th>
                  <th style={{ color: SIGNAL_COLORS.yellow }}>Yellow</th>
                  <th style={{ color: SIGNAL_COLORS.red }}>Red</th>
                </tr>
              </thead>
              <tbody>
                {dim.thresholds.map((t, i) => (
                  <tr key={i}>
                    <td className="health-signal-name">{t.label}</td>
                    <td>{t.green}</td>
                    <td>{t.yellow}</td>
                    <td>{t.red}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="health-info-dimension">
          <h5>Signal Combination Guide</h5>
          <p className="health-dim-description">What the three signals together tell you about the account.</p>
          <table className="health-formula-table">
            <thead>
              <tr><th>Adoption</th><th>Engagement</th><th>Support</th><th>Interpretation</th></tr>
            </thead>
            <tbody>
              {[
                { a: "green", e: "green", s: "green", t: "Reference-able. Ask for expansion and a case study." },
                { a: "green", e: "red", s: "green", t: "Silent adopter / renewal risk. Classic surprise churn." },
                { a: "red", e: "green", s: "green", t: "Shelfware with a smile. Re-onboard." },
                { a: "green", e: "green", s: "red", t: "Engaged and struggling. Escalate to engineering." },
                { a: "red", e: "red", s: "red", t: "Write the save plan. Or the eulogy." },
                { a: "red", e: "green", s: "red", t: "Champion is loyal but can't drive usage. Org/change-management problem." },
              ].map((row, i) => (
                <tr key={i}>
                  <td><SignalDot signal={row.a as Signal} size={10} /></td>
                  <td><SignalDot signal={row.e as Signal} size={10} /></td>
                  <td><SignalDot signal={row.s as Signal} size={10} /></td>
                  <td>{row.t}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="health-info-dimension">
          <h5>Data Sources</h5>
          <ul className="health-info-sources">
            <li><strong>Adoption:</strong> Salesforce Enterprise Subscriptions (seat counts, product types)</li>
            <li><strong>Engagement:</strong> Salesforce Account Contact Roles, Account activity dates</li>
            <li><strong>Support:</strong> Zendesk tickets (priority, escalation, type)</li>
            <li><strong>Manual Score:</strong> CS_Health__c field in Salesforce (set by CSM)</li>
          </ul>
        </div>

        <p className="health-info-note">
          Zero tickets is not green. Often it means the product isn't being used deeply enough to generate friction.
          Always read Support against Adoption — the combination reveals whether silence is confidence or abandonment.
        </p>
      </div>
    </div>
  );
}

export function CustomerHealthCard({ accountName, compact }: Props) {
  const [data, setData] = useState<HealthScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchHealthScore(accountName)
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

  // Compact mode: 3 labeled dots inline
  if (compact) {
    return (
      <div className="health-card-compact" title={`Adoption: ${SIGNAL_LABELS[data.adoption.signal]} | Engagement: ${SIGNAL_LABELS[data.engagement.signal]} | Support: ${SIGNAL_LABELS[data.support.signal]}`}>
        <span className="health-compact-label">Health</span>
        <span className="health-compact-dim">
          <SignalDot signal={data.adoption.signal} size={10} />
          <span className="health-compact-dim-label">A</span>
        </span>
        <span className="health-compact-dim">
          <SignalDot signal={data.engagement.signal} size={10} />
          <span className="health-compact-dim-label">E</span>
        </span>
        <span className="health-compact-dim">
          <SignalDot signal={data.support.signal} size={10} />
          <span className="health-compact-dim-label">S</span>
        </span>
        {data.manualHealthScore && (
          <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
            {data.manualHealthScore}
          </span>
        )}
      </div>
    );
  }

  // Full mode — transparent breakdown
  return (
    <div className="health-card">
      <div className="health-card-header">
        <h4 className="health-card-title">
          Customer Health Score
          <button
            className="health-info-btn"
            onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
            aria-label="How health score is calculated"
            title="How health score is calculated"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/><text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="serif">i</text></svg>
          </button>
        </h4>
        <div className="health-summary-row">
          <span className="health-summary-dim">
            <SignalDot signal={data.adoption.signal} size={12} /> Adoption
          </span>
          <span className="health-summary-dim">
            <SignalDot signal={data.engagement.signal} size={12} /> Engagement
          </span>
          <span className="health-summary-dim">
            <SignalDot signal={data.support.signal} size={12} /> Support
          </span>
          {data.manualHealthScore && (
            <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
              Manual: {data.manualHealthScore}
            </span>
          )}
        </div>
      </div>

      {showInfo && <HealthInfoPanel onClose={() => setShowInfo(false)} />}

      {data.interpretation && (
        <p className="health-interpretation">{data.interpretation}</p>
      )}

      {/* All 3 dimensions with full transparency */}
      <DimensionDetail dimKey="adoption" dimension={data.adoption} />
      <DimensionDetail dimKey="engagement" dimension={data.engagement} />
      <DimensionDetail dimKey="support" dimension={data.support} />

      {/* Manual score from Salesforce */}
      {data.manualHealthScore && (
        <div className="health-manual-section">
          <div className="health-manual-header">
            <span className="health-manual-label">Manual Health Score (Salesforce)</span>
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
