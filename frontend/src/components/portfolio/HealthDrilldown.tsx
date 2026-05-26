// Drilldown modal opened by clicking a health chip on a CustomerCard.
// Shows all three dimensions, their signals, current values, status, thresholds,
// and the plain-English calculation logic so users understand how the score is derived.

import { useEffect } from "react";
import { X } from "lucide-react";
import type { HealthScore, HealthDimension } from "../../data/portfolioMocks";

interface Props {
  accountName: string;
  health: HealthScore;
  onClose: () => void;
}

const DIMS: Array<{ key: keyof Pick<HealthScore, "adoption" | "engagement" | "support">; label: string; description: string }> = [
  { key: "adoption", label: "Product Adoption", description: "Is the customer realizing value from our products?" },
  { key: "engagement", label: "Customer Engagement", description: "Is the relationship real and multi-threaded?" },
  { key: "support", label: "Support", description: "Is using our products painful for this customer?" },
];

export function HealthDrilldown({ accountName, health, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="health-modal-backdrop" onClick={onClose} role="dialog" aria-modal>
      <div className="health-modal" onClick={(e) => e.stopPropagation()}>
        <header className="health-modal-header">
          <div>
            <h2>{accountName} — Customer Health</h2>
            <p className="health-modal-subtitle">
              Computed from Salesforce, Zendesk, and Amplitude signals. Each dimension follows the worst-signal-wins rule
              (any red signal makes the dimension red).
            </p>
          </div>
          <button type="button" className="health-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="health-modal-body">
          {DIMS.map((d) => (
            <DimensionPanel key={d.key} label={d.label} description={d.description} dim={health[d.key]} />
          ))}

          {health.manual && (
            <section className="health-dim-panel health-dim-manual">
              <header className="health-dim-header">
                <span className={`health-chip health-chip-${health.manual.status === "good" ? "green" : health.manual.status === "ok" ? "yellow" : "red"}`}>
                  M
                </span>
                <div>
                  <strong>Manual Health Score (Salesforce)</strong>
                  <p className="health-dim-description">Overrides or augments automated dimensions. Maintained by the CSM in Salesforce.</p>
                </div>
                <span className="health-dim-status">{health.manual.status === "good" ? "Good" : health.manual.status === "ok" ? "OK" : "At Risk"}</span>
              </header>
              <p className="health-manual-note">{health.manual.note}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function DimensionPanel({ label, description, dim }: { label: string; description: string; dim: HealthDimension }) {
  const status = dim.status;
  const statusLabel = status === "green" ? "Healthy" : status === "yellow" ? "Needs Attention" : status === "red" ? "At Risk" : "No data";
  return (
    <section className={`health-dim-panel health-dim-${status || "unknown"}`}>
      <header className="health-dim-header">
        <span className={`health-chip health-chip-${status || "unknown"}`}>{label[0]}</span>
        <div>
          <strong>{label}</strong>
          <p className="health-dim-description">{description}</p>
        </div>
        <span className="health-dim-status">{statusLabel}</span>
      </header>

      {dim.signals.length === 0 ? (
        <p className="health-dim-empty">No signals available for this account.</p>
      ) : (
        <table className="health-dim-table">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Current value</th>
              <th>Status</th>
              <th>Thresholds (green / yellow / red)</th>
            </tr>
          </thead>
          <tbody>
            {dim.signals.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.currentValue}</td>
                <td><span className={`health-chip-inline health-chip-${s.status}`}>{s.status}</span></td>
                <td className="health-thresholds">{s.thresholds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="health-dim-logic">
        <strong>How this is calculated:</strong> {dim.calculationLogic}
      </p>
    </section>
  );
}
