// Modal listing every opportunity in the current TSA's deployment tree
// that has no linked Kantata project. Surfaces from the warning banner
// on DeploymentsView ("X opportunities have no Kantata project yet").
//
// Each row shows account, opp name, close date, DEP-* $, the product
// codes, and a deep link to the SF opportunity. Searchable + CSV export.

import { useMemo, useState } from "react";
import { Search, X, ExternalLink, Download } from "lucide-react";
import type { DeploymentCustomerNode } from "../../services/api";

const SF_BASE_URL = "https://deque.my.salesforce.com";

interface FlatOpp {
  accountName: string;
  accountId: string;
  oppId: string;
  oppName: string;
  closeDate: string | null;
  totalDepDollars: number;
  productCodes: string[]; // distinct product codes for compact display
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Walk the customer tree (including nested children) and return every opp
// whose kantata is null, tagged with its parent account.
function flattenNoKantataOpps(customers: DeploymentCustomerNode[]): FlatOpp[] {
  const out: FlatOpp[] = [];
  const walk = (c: DeploymentCustomerNode) => {
    for (const o of c.opps) {
      if (o.kantata === null) {
        const codes = Array.from(new Set(o.products.map((p) => p.productCode)));
        out.push({
          accountName: c.accountName,
          accountId: c.accountId,
          oppId: o.oppId,
          oppName: o.oppName,
          closeDate: o.closeDate,
          totalDepDollars: o.totalDepDollars,
          productCodes: codes,
        });
      }
    }
    for (const child of c.children || []) walk(child);
  };
  for (const c of customers) walk(c);
  return out;
}

interface Props {
  customers: DeploymentCustomerNode[];
  onClose: () => void;
}

export function NoKantataModal({ customers, onClose }: Props) {
  const [search, setSearch] = useState("");

  const allOpps = useMemo(() => flattenNoKantataOpps(customers), [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOpps;
    return allOpps.filter(
      (o) =>
        o.accountName.toLowerCase().includes(q) ||
        o.oppName.toLowerCase().includes(q) ||
        o.productCodes.some((c) => c.toLowerCase().includes(q))
    );
  }, [allOpps, search]);

  // Sort by close date (oldest first — those needing attention) then account name
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dA = a.closeDate || "";
      const dB = b.closeDate || "";
      if (dA !== dB) return dA.localeCompare(dB);
      return a.accountName.localeCompare(b.accountName);
    });
  }, [filtered]);

  const totalValue = useMemo(() => sorted.reduce((s, o) => s + o.totalDepDollars, 0), [sorted]);

  const exportCsv = () => {
    const header = ["Account", "Opportunity", "Close Date", "DEP $", "Product Codes", "SF Opp ID"];
    const lines = [
      header.join(","),
      ...sorted.map((o) =>
        [
          o.accountName,
          o.oppName,
          o.closeDate || "",
          o.totalDepDollars,
          o.productCodes.join(" | "),
          o.oppId,
        ]
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opps-without-kantata-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="deployments-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="no-kantata-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="deployments-modal">
        <header className="deployments-modal-header">
          <div>
            <h2 id="no-kantata-modal-title">Opportunities with no Kantata project</h2>
            <p className="deployments-modal-subtitle">
              {sorted.length === allOpps.length
                ? `${allOpps.length} opp${allOpps.length === 1 ? "" : "s"} · ${fmtMoney(totalValue)} DEP-* booked`
                : `${sorted.length} of ${allOpps.length} opp${allOpps.length === 1 ? "" : "s"} · ${fmtMoney(totalValue)} filtered DEP-* booked`}
            </p>
          </div>
          <button
            type="button"
            className="deployments-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <div className="deployments-modal-toolbar">
          <div className="deployments-modal-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              placeholder="Search account, opp, or product code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter opportunities"
              autoFocus
            />
          </div>
          <button
            type="button"
            className="deployments-modal-btn"
            onClick={exportCsv}
            disabled={sorted.length === 0}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>

        <div className="deployments-modal-body">
          {sorted.length === 0 ? (
            <p className="deployments-modal-empty">No opps match “{search}”.</p>
          ) : (
            <table className="deployments-modal-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Opportunity</th>
                  <th>Close Date</th>
                  <th style={{ textAlign: "right" }}>DEP $</th>
                  <th>Product Codes</th>
                  <th><span className="visually-hidden">Open in Salesforce</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => (
                  <tr key={o.oppId}>
                    <td>{o.accountName}</td>
                    <td className="deployments-modal-opp-name" title={o.oppName}>
                      {o.oppName}
                    </td>
                    <td>{fmtDate(o.closeDate)}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(o.totalDepDollars)}</td>
                    <td className="deployments-modal-codes">
                      {o.productCodes.map((c) => (
                        <span key={c} className="deployments-modal-code">{c}</span>
                      ))}
                    </td>
                    <td>
                      <a
                        href={`${SF_BASE_URL}/${o.oppId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="deployments-modal-sf-link"
                        title="Open opportunity in Salesforce"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
