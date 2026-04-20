import { useEffect, useState, useMemo } from "react";
import {
  fetchOrganizations,
  fetchCSMPortfolios,
  fetchAccountsWithSubscriptions,
  fetchHealthScoresBatch,
  type HealthScoreResponse,
} from "../services/api";
import { Pagination, usePagination } from "./Pagination";
import type { Organization } from "../types";

type Signal = "green" | "yellow" | "red";

interface Props {
  mode: "csm" | "customer";
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

function SignalDot({ signal, size = 14 }: { signal: Signal; size?: number }) {
  return (
    <span
      className="health-dot"
      style={{ width: size, height: size, backgroundColor: SIGNAL_COLORS[signal] }}
      aria-label={SIGNAL_LABELS[signal]}
    />
  );
}

// Scoring formula definitions
const SCORING_FORMULAS: Record<string, { title: string; signals: Array<{ label: string; green: string; yellow: string; red: string }> }> = {
  adoption: {
    title: "Product Adoption — is value being realized?",
    signals: [
      {
        label: "Seat Activation %",
        green: "\u226570% of licensed seats assigned",
        yellow: "40\u201370% assigned",
        red: "<40% assigned",
      },
      {
        label: "Product Breadth",
        green: "3+ products licensed",
        yellow: "2 products",
        red: "1 product or none",
      },
    ],
  },
  engagement: {
    title: "Customer Engagement — is the relationship real?",
    signals: [
      {
        label: "Executive Sponsor",
        green: "Named in SF AccountContactRole",
        yellow: "\u2014",
        red: "None identified",
      },
      {
        label: "Stakeholder Breadth",
        green: "3+ contacts across 2+ roles",
        yellow: "2 contacts or single role",
        red: "1 or no contacts",
      },
      {
        label: "Last Contact",
        green: "<30 days ago",
        yellow: "30\u201390 days ago",
        red: ">90 days or never",
      },
    ],
  },
  support: {
    title: "Support — is using us painful?",
    signals: [
      {
        label: "Ticket Volume (90d)",
        green: "Weighted score <20 (urgent\u00D75, high\u00D72, normal\u00D71)",
        yellow: "Weighted score 20\u201350",
        red: "Weighted score >50",
      },
      {
        label: "Escalations",
        green: "0\u20131 per quarter",
        yellow: "2\u20133 per quarter",
        red: "4+ per quarter",
      },
      {
        label: "Bug:How-to Ratio",
        green: "<40% bugs (normal learning curve)",
        yellow: "40\u201360% bugs",
        red: ">60% bugs (product friction)",
      },
      {
        label: "Zero Tickets",
        green: "\u2014",
        yellow: "No tickets (self-sufficient if adoption is green)",
        red: "No tickets + low adoption = possible abandonment",
      },
    ],
  },
};

const COMBINATION_INTERPRETATIONS = [
  { a: "green", e: "green", s: "green", text: "Reference-able. Ask for expansion and a case study." },
  { a: "green", e: "red", s: "green", text: "Silent adopter / renewal risk. Using axe fine but no relationship. Classic surprise churn." },
  { a: "red", e: "green", s: "green", text: "Shelfware with a smile. Champion likes us but product isn't landing. Re-onboard." },
  { a: "green", e: "green", s: "red", text: "Engaged and struggling. Product/IGT friction \u2014 escalate to engineering, not CS." },
  { a: "red", e: "red", s: "red", text: "Write the save plan. Or the eulogy." },
  { a: "red", e: "green", s: "red", text: "Champion is loyal but can't drive usage. Usually an org/change-management problem." },
];

// Group organizations by SF account name
function consolidateOrganizations(orgs: Organization[]): { accountName: string; organizations: Organization[] }[] {
  const map = new Map<string, Organization[]>();
  for (const org of orgs) {
    const name = org.salesforce_account_name || org.name;
    const existing = map.get(name) || [];
    existing.push(org);
    map.set(name, existing);
  }
  return Array.from(map.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

// Full health drill-down for one account
function AccountHealthDrilldown({ data, onClose }: { data: HealthScoreResponse; onClose: () => void }) {
  return (
    <div className="health-drilldown">
      <div className="health-drilldown-header">
        <h3>{data.accountName}</h3>
        <div className="health-drilldown-summary">
          <SignalDot signal={data.adoption.signal} size={16} />
          <SignalDot signal={data.engagement.signal} size={16} />
          <SignalDot signal={data.support.signal} size={16} />
          {data.manualHealthScore && (
            <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
              Manual: {data.manualHealthScore}
            </span>
          )}
        </div>
        <button className="health-drilldown-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      {data.interpretation && (
        <p className="health-interpretation">{data.interpretation}</p>
      )}

      {/* Three dimension sections */}
      {(["adoption", "engagement", "support"] as const).map((dim) => {
        const dimension = data[dim];
        const formula = SCORING_FORMULAS[dim];
        return (
          <div key={dim} className="health-drilldown-dimension">
            <div className="health-drilldown-dim-header">
              <SignalDot signal={dimension.signal} size={14} />
              <h4>{formula.title}</h4>
              <span className="health-drilldown-dim-label" style={{ color: SIGNAL_COLORS[dimension.signal] }}>
                {SIGNAL_LABELS[dimension.signal]}
              </span>
            </div>

            {/* Actual signals from the API */}
            <table className="health-signals-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {dimension.signals.map((s, i) => (
                  <tr key={i}>
                    <td className="health-signal-name">{s.label}</td>
                    <td>
                      <span className="health-signal-pill" style={{ backgroundColor: SIGNAL_BG[s.signal], color: SIGNAL_COLORS[s.signal] }}>
                        {SIGNAL_LABELS[s.signal]}
                      </span>
                    </td>
                    <td className="health-signal-detail-cell">{s.detail || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Scoring formula reference */}
            <details className="health-formula-details">
              <summary>How this is scored</summary>
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
                  {formula.signals.map((f, i) => (
                    <tr key={i}>
                      <td className="health-signal-name">{f.label}</td>
                      <td>{f.green}</td>
                      <td>{f.yellow}</td>
                      <td>{f.red}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        );
      })}

      {/* Manual health score section */}
      {data.manualHealthScore && (
        <div className="health-drilldown-manual">
          <h4>Manual Health Score (from Salesforce)</h4>
          <div className="health-manual-header">
            <span className={`health-manual-badge manual-${data.manualHealthScore.toLowerCase()}`}>
              {data.manualHealthScore}
            </span>
            {data.riskDrivers && <span className="health-risk-tag">Risk Drivers: {data.riskDrivers}</span>}
          </div>
          {data.manualHealthDescription && (
            <p className="health-manual-description">{data.manualHealthDescription}</p>
          )}
        </div>
      )}

      {/* Interpretation guide */}
      <details className="health-formula-details">
        <summary>Signal combination guide</summary>
        <table className="health-formula-table">
          <thead>
            <tr>
              <th>Adoption</th>
              <th>Engagement</th>
              <th>Support</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {COMBINATION_INTERPRETATIONS.map((c, i) => (
              <tr key={i}>
                <td><SignalDot signal={c.a as Signal} size={12} /></td>
                <td><SignalDot signal={c.e as Signal} size={12} /></td>
                <td><SignalDot signal={c.s as Signal} size={12} /></td>
                <td>{c.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function HealthView({ mode }: Props) {
  const [accounts, setAccounts] = useState<{ accountName: string; organizations: Organization[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthScores, setHealthScores] = useState<Map<string, HealthScoreResponse | "loading" | "error">>(new Map());
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterSignal, setFilterSignal] = useState<Signal | "all">("all");

  useEffect(() => {
    loadAccounts();
  }, [mode]);

  async function loadAccounts() {
    setLoading(true);
    try {
      const [orgs, subsData] = await Promise.all([
        mode === "csm" ? fetchCSMPortfolios().then((d) => {
          const allOrgs: Organization[] = [];
          for (const p of d.portfolios || []) {
            for (const c of p.customers || []) {
              if (c.organization) allOrgs.push(c.organization);
            }
          }
          return allOrgs;
        }) : fetchOrganizations(),
        fetchAccountsWithSubscriptions(),
      ]);

      const subsSet = new Set(subsData.accountNames);
      const consolidated = consolidateOrganizations(orgs).filter((a) => subsSet.has(a.accountName));
      setAccounts(consolidated);

      // Mark all as loading
      setHealthScores((prev) => {
        const next = new Map(prev);
        for (const a of consolidated) next.set(a.accountName, "loading");
        return next;
      });

      // Batch fetch all health scores (1 API call per batch of 50 instead of N individual calls)
      const batchSize = 50;
      for (let i = 0; i < consolidated.length; i += batchSize) {
        const batch = consolidated.slice(i, i + batchSize);
        const names = batch.map((a) => a.accountName);
        try {
          const batchResults = await fetchHealthScoresBatch(names);
          setHealthScores((prev) => {
            const next = new Map(prev);
            for (const [name, score] of Object.entries(batchResults)) {
              next.set(name, score);
            }
            // Mark any that didn't return as error
            for (const name of names) {
              if (!batchResults[name] && next.get(name) === "loading") {
                next.set(name, "error");
              }
            }
            return next;
          });
        } catch {
          setHealthScores((prev) => {
            const next = new Map(prev);
            for (const name of names) next.set(name, "error");
            return next;
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  // Filter and search
  const filteredAccounts = useMemo(() => {
    let result = accounts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.accountName.toLowerCase().includes(q));
    }
    if (filterSignal !== "all") {
      result = result.filter((a) => {
        const score = healthScores.get(a.accountName);
        if (!score || score === "loading" || score === "error") return false;
        return score.adoption.signal === filterSignal ||
          score.engagement.signal === filterSignal ||
          score.support.signal === filterSignal;
      });
    }
    return result;
  }, [accounts, searchQuery, filterSignal, healthScores]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterSignal]);

  const paginatedAccounts = usePagination(filteredAccounts, pageSize, currentPage);

  // Summary stats
  const stats = useMemo(() => {
    let green = 0, yellow = 0, red = 0;
    for (const score of healthScores.values()) {
      if (score === "loading" || score === "error") continue;
      // Count worst signal across dimensions
      const signals = [score.adoption.signal, score.engagement.signal, score.support.signal];
      if (signals.includes("red")) red++;
      else if (signals.includes("yellow")) yellow++;
      else green++;
    }
    return { green, yellow, red, total: green + yellow + red };
  }, [healthScores]);

  if (loading) {
    return (
      <div className="health-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading health scores...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="health-view"><div className="error">{error}</div></div>;
  }

  return (
    <div className="health-view">
      <div className="health-view-header">
        <h2>Customer Health Overview</h2>
        <span className="section-count">{filteredAccounts.length} customers</span>
      </div>

      {/* Summary stats */}
      <div className="health-stats-bar">
        <button
          className={`health-stat-btn ${filterSignal === "all" ? "active" : ""}`}
          onClick={() => setFilterSignal("all")}
        >
          All ({stats.total})
        </button>
        <button
          className={`health-stat-btn health-stat-green ${filterSignal === "green" ? "active" : ""}`}
          onClick={() => setFilterSignal(filterSignal === "green" ? "all" : "green")}
        >
          <SignalDot signal="green" size={10} /> Healthy ({stats.green})
        </button>
        <button
          className={`health-stat-btn health-stat-yellow ${filterSignal === "yellow" ? "active" : ""}`}
          onClick={() => setFilterSignal(filterSignal === "yellow" ? "all" : "yellow")}
        >
          <SignalDot signal="yellow" size={10} /> Needs Attention ({stats.yellow})
        </button>
        <button
          className={`health-stat-btn health-stat-red ${filterSignal === "red" ? "active" : ""}`}
          onClick={() => setFilterSignal(filterSignal === "red" ? "all" : "red")}
        >
          <SignalDot signal="red" size={10} /> At Risk ({stats.red})
        </button>
      </div>

      {/* Search */}
      <div className="health-search">
        <input
          type="text"
          placeholder="Search customers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="usage-search-input"
        />
        {searchQuery && <button className="usage-search-clear" onClick={() => setSearchQuery("")}>&times;</button>}
      </div>

      <Pagination
        totalItems={filteredAccounts.length}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />

      {/* Account list */}
      <div className="health-account-list">
        <table className="health-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Adoption</th>
              <th>Engagement</th>
              <th>Support</th>
              <th>Manual Score</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {paginatedAccounts.map((account) => {
              const score = healthScores.get(account.accountName);
              const isExpanded = expandedAccount === account.accountName;

              if (!score || score === "loading") {
                return (
                  <tr key={account.accountName} className="health-row">
                    <td>{account.accountName}</td>
                    <td colSpan={5} className="health-loading-cell">Loading...</td>
                  </tr>
                );
              }

              if (score === "error") {
                return (
                  <tr key={account.accountName} className="health-row">
                    <td>{account.accountName}</td>
                    <td colSpan={5} className="health-error-cell">Failed to load</td>
                  </tr>
                );
              }

              return (
                <tr
                  key={account.accountName}
                  className={`health-row clickable ${isExpanded ? "expanded" : ""}`}
                  onClick={() => setExpandedAccount(isExpanded ? null : account.accountName)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedAccount(isExpanded ? null : account.accountName); } }}
                >
                  <td className="health-account-name">{account.accountName}</td>
                  <td>
                    <span className="health-signal-pill" style={{ backgroundColor: SIGNAL_BG[score.adoption.signal], color: SIGNAL_COLORS[score.adoption.signal] }}>
                      {SIGNAL_LABELS[score.adoption.signal]}
                    </span>
                  </td>
                  <td>
                    <span className="health-signal-pill" style={{ backgroundColor: SIGNAL_BG[score.engagement.signal], color: SIGNAL_COLORS[score.engagement.signal] }}>
                      {SIGNAL_LABELS[score.engagement.signal]}
                    </span>
                  </td>
                  <td>
                    <span className="health-signal-pill" style={{ backgroundColor: SIGNAL_BG[score.support.signal], color: SIGNAL_COLORS[score.support.signal] }}>
                      {SIGNAL_LABELS[score.support.signal]}
                    </span>
                  </td>
                  <td>
                    {score.manualHealthScore ? (
                      <span className={`health-manual-badge manual-${score.manualHealthScore.toLowerCase()}`}>
                        {score.manualHealthScore}
                      </span>
                    ) : "\u2014"}
                  </td>
                  <td className="health-interpretation-cell">{score.interpretation || "\u2014"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drill-down panel */}
      {expandedAccount && (() => {
        const score = healthScores.get(expandedAccount);
        if (!score || score === "loading" || score === "error") return null;
        return <AccountHealthDrilldown data={score} onClose={() => setExpandedAccount(null)} />;
      })()}
    </div>
  );
}
