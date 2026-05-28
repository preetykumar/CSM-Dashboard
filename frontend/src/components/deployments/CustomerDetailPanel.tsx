// Per-customer detail panel that opens under a CustomerNode in the
// Deployments tree. Currently just the Kantata summary — Health, Support,
// and Usage moved to the unified Customer page's drill-down. New
// Deployments-specific functionality will be added back here later.

import { ExternalLink } from "lucide-react";
import type { DeploymentCustomerNode, DeploymentOppNode } from "../../services/api";
import { Badge, EmptyState } from "../ui";

interface Props {
  customer: DeploymentCustomerNode;
}

export function CustomerDetailPanel({ customer }: Props) {
  return (
    <div className="deployments-detail-panel">
      <KantataTab opps={customer.opps} />
    </div>
  );
}

// ── Kantata budget summary ────────────────────────────────────────────────

function KantataTab({ opps }: { opps: DeploymentOppNode[] }) {
  const withKantata = opps.filter((o) => o.kantata);
  if (withKantata.length === 0) {
    return <EmptyState title="No Kantata workspace" detail="No active Kantata project is linked to this customer's deployment opps." />;
  }
  const totals = withKantata.reduce(
    (acc, o) => {
      const k = o.kantata!;
      acc.budget += k.budget || 0;
      acc.used += k.budgetUsed;
      return acc;
    },
    { budget: 0, used: 0 }
  );
  const remaining = totals.budget - totals.used;
  const pctUsed = totals.budget > 0 ? (totals.used / totals.budget) * 100 : 0;

  return (
    <div className="deployments-kantata-tab">
      <div className="deployments-kantata-summary">
        <div className="deployments-kantata-stat">
          <span className="label">Total budget</span>
          <span className="value">{fmtMoney(totals.budget)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">Used</span>
          <span className="value">{fmtMoney(totals.used)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">Remaining</span>
          <span className={`value ${remaining < 0 ? "negative" : ""}`}>{fmtMoney(remaining)}</span>
        </div>
        <div className="deployments-kantata-stat">
          <span className="label">% Used</span>
          <span className={`value ${pctUsed > 100 ? "negative" : ""}`}>{pctUsed.toFixed(0)}%</span>
        </div>
      </div>

      <table className="deployments-kantata-table">
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Status</th>
            <th>Budget</th>
            <th>Used</th>
            <th>Due date</th>
            <th><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {withKantata.map((o) => {
            const k = o.kantata!;
            return (
              <tr key={o.oppId}>
                <td>{o.oppName}</td>
                <td>
                  {k.status ? <Badge tone={k.overBudget ? "danger" : "info"}>{k.status}</Badge> : "—"}
                </td>
                <td>{fmtMoney(k.budget)}</td>
                <td>{fmtMoney(k.budgetUsed)}</td>
                <td>{k.effectiveDueDate ? new Date(k.effectiveDueDate).toLocaleDateString() : "—"}</td>
                <td>
                  {k.url ? (
                    <a href={k.url} target="_blank" rel="noopener noreferrer" aria-label="Open in Kantata">
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
