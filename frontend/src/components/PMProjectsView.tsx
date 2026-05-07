import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Briefcase, Calendar, ChevronRight, DollarSign, ExternalLink, Search } from "lucide-react";
import { fetchActiveProjects } from "../services/api";
import { formatCurrency } from "../utils/format";
import { Badge } from "./renewal/Badge";
import type { ActiveProject, ActiveProjectsResponse } from "../types";

type SortField = "health" | "title" | "account" | "budget" | "used" | "start" | "lastContact";
type SortDir = "asc" | "desc";

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function nameOrDash(u: { name: string } | null | undefined): string {
  return u?.name || "Unassigned";
}

interface ProjectCardProps {
  project: ActiveProject;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}

function ProjectCard({ project: p, index, expanded, onToggle }: ProjectCardProps) {
  const isRed = p.overallHealth === "red";
  const cardClass = `renewal-opp-card ${expanded ? "expanded" : ""} ${isRed ? "urgent" : ""}`;

  const budgetSummary = p.budget != null
    ? `${formatCurrency(p.budgetUsed)} / ${formatCurrency(p.budget)}`
    : formatCurrency(p.budgetUsed);

  return (
    <div className={cardClass}>
      <div
        className="renewal-opp-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
      >
        <div className="renewal-opp-header-main">
          <ChevronRight className={`prs-chevron ${expanded ? "expanded" : ""}`} size={18} />
          <span className="renewal-opp-index">{index + 1}</span>
          <div className="renewal-opp-account">
            <span className="renewal-opp-account-name">
              {p.accountName || <span style={{ color: "#94a3b8" }}>(unlinked)</span>}
            </span>
            <div className="renewal-opp-meta">
              <Badge variant={isRed ? "danger" : "success"}>
                {isRed ? "RED" : "GREEN"}
              </Badge>
              {p.budgetType && <Badge variant="default">{p.budgetType}</Badge>}
              {p.healthReasons.length > 0 && (
                <span className="renewal-action-text critical">
                  <AlertTriangle size={12} />
                  {p.healthReasons.join(" · ")}
                </span>
              )}
              <span className="renewal-opp-name-inline" title={p.title}>{p.title}</span>
            </div>
          </div>
        </div>
        <div className="renewal-opp-header-right">
          <span className="renewal-opp-amount">{budgetSummary}</span>
          <span className="renewal-opp-date">Started {formatDateShort(p.startDate)}</span>
        </div>
      </div>

      {expanded && (
        <div className="renewal-opp-body">
          <dl className="renewal-opp-fields">
            <div className="renewal-opp-field">
              <dt>CSM</dt>
              <dd>{nameOrDash(p.team.csm)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>TSA</dt>
              <dd>{nameOrDash(p.team.tsa)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>AE</dt>
              <dd>{nameOrDash(p.team.ae)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Service Delivery Lead</dt>
              <dd>{nameOrDash(p.team.sdl)}</dd>
            </div>
            <div className="renewal-opp-field renewal-opp-field-wide">
              <dt>Implementation Engineer{p.team.ies.length > 1 ? "s" : ""}</dt>
              <dd>{p.team.ies.length > 0 ? p.team.ies.map((u) => u.name).join(", ") : "Unassigned"}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Budget</dt>
              <dd>{p.budget != null ? formatCurrency(p.budget) : "—"}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Used</dt>
              <dd>{formatCurrency(p.budgetUsed)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Unused</dt>
              <dd style={p.budgetUnused != null && p.budgetUnused < 0 ? { color: "#dc2626", fontWeight: 600 } : undefined}>
                {p.budgetUnused != null ? formatCurrency(p.budgetUnused) : "—"}
              </dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Start Date</dt>
              <dd>
                {formatDateShort(p.startDate)}
                {p.daysSinceStart != null && (
                  <span style={{ color: "#64748b", marginLeft: 6, fontSize: 12 }}>({p.daysSinceStart}d ago)</span>
                )}
              </dd>
            </div>
            <div className="renewal-opp-field">
              <dt>End Date</dt>
              <dd>{formatDateShort(p.dueDate)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Last Customer Contact</dt>
              <dd>{formatDateShort(p.lastCustomerContact)}</dd>
            </div>
            <div className="renewal-opp-field">
              <dt>Kantata</dt>
              <dd>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Open project <ExternalLink size={12} />
                </a>
              </dd>
            </div>
          </dl>

          {p.healthReasons.length > 0 && (
            <div className="renewal-opp-notes">
              <strong>Why it's RED</strong>
              <p>{p.healthReasons.join(". ")}.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PMProjectsView() {
  const [response, setResponse] = useState<ActiveProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [redOnly, setRedOnly] = useState(false);
  const [budgetTypeFilter, setBudgetTypeFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("health");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActiveProjects(force ? { force: true } : undefined);
      setResponse(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load active projects");
    } finally {
      setLoading(false);
    }
  }

  const projects = response?.projects || [];

  const budgetTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.budgetType) set.add(p.budgetType);
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return projects.filter((p) => {
      if (redOnly && p.overallHealth !== "red") return false;
      if (budgetTypeFilter !== "all" && p.budgetType !== budgetTypeFilter) return false;
      if (!q) return true;
      const haystack = [
        p.title,
        p.accountName || "",
        p.team.csm?.name || "",
        p.team.tsa?.name || "",
        p.team.ae?.name || "",
        p.team.sdl?.name || "",
        ...p.team.ies.map((u) => u.name),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, searchTerm, redOnly, budgetTypeFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "title": return dir * a.title.localeCompare(b.title);
        case "account": return dir * (a.accountName || "").localeCompare(b.accountName || "");
        case "budget": return dir * ((a.budget ?? -Infinity) - (b.budget ?? -Infinity));
        case "used": return dir * (a.budgetUsed - b.budgetUsed);
        case "start": {
          const av = a.startDate ? new Date(a.startDate).getTime() : 0;
          const bv = b.startDate ? new Date(b.startDate).getTime() : 0;
          return dir * (av - bv);
        }
        case "lastContact": {
          const av = a.lastCustomerContact ? new Date(a.lastCustomerContact).getTime() : 0;
          const bv = b.lastCustomerContact ? new Date(b.lastCustomerContact).getTime() : 0;
          return dir * (av - bv);
        }
        case "health":
        default:
          if (a.overallHealth !== b.overallHealth) return dir * (a.overallHealth === "red" ? -1 : 1);
          return (a.accountName || "").localeCompare(b.accountName || "");
      }
    });
  }, [filtered, sortField, sortDir]);

  const stats = useMemo(() => {
    const total = projects.length;
    const red = projects.filter((p) => p.overallHealth === "red").length;
    const budgetRed = projects.filter((p) => p.budgetHealth === "red").length;
    const scheduleRed = projects.filter((p) => p.scheduleHealth === "red").length;
    return { total, red, budgetRed, scheduleRed };
  }, [projects]);

  if (loading && !response) {
    return (
      <div className="renewal-loading">
        <div className="loading-spinner" />
        <p>Loading active implementation projects from Kantata...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="renewal-loading">
        <p>Error: {error}</p>
        <button onClick={() => load(true)} className="btn btn-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="renewal-view">
      <div className="renewal-filter-bar">
        <div className="renewal-search-wrapper">
          <Search size={16} className="renewal-search-icon" />
          <input
            type="text"
            placeholder="Search project, account, or team member..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="renewal-search-input"
          />
        </div>
        <div className="renewal-sort-control">
          <label htmlFor="active-projects-sort" className="renewal-sort-label">Sort by</label>
          <select
            id="active-projects-sort"
            className="renewal-sort-select"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
          >
            <option value="health">Health</option>
            <option value="account">Account</option>
            <option value="title">Project</option>
            <option value="budget">Budget</option>
            <option value="used">Used Budget</option>
            <option value="start">Start Date</option>
            <option value="lastContact">Last Contact</option>
          </select>
          <button
            type="button"
            className="renewal-sort-direction"
            onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
            aria-label={`Toggle sort direction, currently ${sortDir}`}
          >
            {sortDir === "desc" ? "↓" : "↑"}
          </button>
        </div>
        <div className="renewal-filter-buttons">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={redOnly}
              onChange={(e) => setRedOnly(e.target.checked)}
            />
            RED only
          </label>
          <select
            value={budgetTypeFilter}
            onChange={(e) => setBudgetTypeFilter(e.target.value)}
            className="renewal-search-input"
            style={{ width: "auto", paddingLeft: "12px" }}
            aria-label="Filter by budget type"
          >
            <option value="all">All budget types</option>
            {budgetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            type="button"
            onClick={() => load(true)}
            className="btn"
            style={{ padding: "6px 12px" }}
            title={response?.generatedAt ? `Last fetched ${new Date(response.generatedAt).toLocaleString()}` : "Refresh"}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="renewal-stats-grid">
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon blue"><Briefcase size={20} /></div>
            <div>
              <p className="renewal-stat-value">{stats.total}</p>
              <p className="renewal-stat-label">Active Implementations</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><AlertTriangle size={20} /></div>
            <div>
              <p className="renewal-stat-value">{stats.red}</p>
              <p className="renewal-stat-label">RED (any reason)</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><DollarSign size={20} /></div>
            <div>
              <p className="renewal-stat-value">{stats.budgetRed}</p>
              <p className="renewal-stat-label">Over budget</p>
            </div>
          </div>
        </div>
        <div className="renewal-stat-card">
          <div className="renewal-stat-content">
            <div className="renewal-stat-icon red"><Calendar size={20} /></div>
            <div>
              <p className="renewal-stat-value">{stats.scheduleRed}</p>
              <p className="renewal-stat-label">Stale ({">"}90d, no end date)</p>
            </div>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="renewal-empty-state">
          <Briefcase size={32} />
          <p>{projects.length === 0 ? "No active implementation projects found in Kantata." : "No projects match the current filters."}</p>
        </div>
      ) : (
        <div className="renewal-opp-list">
          {sorted.map((p, idx) => (
            <ProjectCard
              key={p.id}
              project={p}
              index={idx}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
