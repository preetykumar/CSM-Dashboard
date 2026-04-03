import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchCSMPortfolios,
  fetchPMPortfolios,
  fetchRenewalOpportunities,
  fetchGitHubStatusForTickets,
  fetchAllAmplitudeSummaries,
} from "../../services/api";
import { transformApiOpportunity } from "../../types/renewal";
import { WorkflowEngine } from "../../services/workflow-engine";
import type { UserRole } from "./RoleSelectionModal";

type TimeRange = "today" | "week" | "month";

interface TodoItem {
  id: string;
  category: "tickets" | "renewals" | "overdue-actions" | "github" | "usage";
  priority: "high" | "medium" | "low";
  title: string;
  subtitle?: string;
  detail?: string;
  link?: string;
}

function daysFromNow(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function ticketNeedsAttention(ticket: any, daysThreshold: number): boolean {
  const updatedDaysAgo = Math.floor((Date.now() - new Date(ticket.updated_at).getTime()) / (1000 * 60 * 60 * 24));
  if (ticket.status === "new") return true;
  if (ticket.priority === "urgent") return true;
  if (ticket.is_escalated) return true;
  if (ticket.status === "open" && updatedDaysAgo > daysThreshold) return true;
  if (ticket.status === "pending" && updatedDaysAgo > daysThreshold * 2) return true;
  return false;
}


const CATEGORY_LABELS: Record<TodoItem["category"], string> = {
  tickets: "Tickets needing attention",
  renewals: "Upcoming renewals",
  "overdue-actions": "Overdue renewal actions",
  github: "Open GitHub items",
  usage: "Low product usage",
};

const CATEGORY_ICONS: Record<TodoItem["category"], string> = {
  tickets: "🎫",
  renewals: "🔄",
  "overdue-actions": "⚠️",
  github: "⚡",
  usage: "📉",
};

interface TodoListProps {
  role: UserRole;
  userEmail: string;
}

export function TodoList({ role, userEmail }: TodoListProps) {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<TimeRange>("week");
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["tickets", "renewals", "overdue-actions"])
  );

  useEffect(() => {
    loadTodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userEmail]);

  async function loadTodos() {
    setLoading(true);
    try {
      const items: TodoItem[] = [];

      if (role === "csm") {
        await loadCSMTodos(items);
      } else if (role === "pm") {
        await loadPMTodos(items);
      } else if (role === "renewal-specialist") {
        await loadRenewalSpecialistTodos(items);
      }

      setTodos(items);
    } catch (err) {
      console.error("Failed to load todos:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadCSMTodos(items: TodoItem[]) {
    const [portfoliosResp, renewalsResp] = await Promise.allSettled([
      fetchCSMPortfolios(),
      fetchRenewalOpportunities(90),
    ]);

    // Find this CSM's portfolio (csm.email on the portfolio object)
    if (portfoliosResp.status === "fulfilled") {
      const myPortfolio = portfoliosResp.value.portfolios?.find(
        (p) => p.csm?.email?.toLowerCase() === userEmail.toLowerCase()
      );

      if (myPortfolio?.customers) {
        // Aggregate tickets needing attention across all customers
        const allTickets = myPortfolio.customers.flatMap((c) => c.tickets || []);
        const attentionTickets = allTickets.filter((t) => ticketNeedsAttention(t, 7));
        for (const t of attentionTickets.slice(0, 10)) {
          items.push({
            id: `ticket-${t.id}`,
            category: "tickets",
            priority: t.priority === "urgent" || t.is_escalated ? "high" : t.priority === "high" ? "medium" : "low",
            title: t.subject || `Ticket #${t.id}`,
            subtitle: `#${t.id} · ${t.status}${t.priority ? ` · ${t.priority}` : ""}`,
            link: "/csm/support",
          });
        }

        // GitHub items for tickets in portfolio
        const ticketIds = allTickets.slice(0, 100).map((t) => t.id);
        if (ticketIds.length > 0) {
          try {
            const ghLinks = await fetchGitHubStatusForTickets(ticketIds);
            let ghCount = 0;
            ghLinks.forEach((statuses, ticketId) => {
              statuses.forEach((s) => {
                if (ghCount < 10 && (s.project_status === "In Progress" || s.project_status === "Todo")) {
                  items.push({
                    id: `gh-${ticketId}-${s.github_issue_number}`,
                    category: "github",
                    priority: "medium",
                    title: `${s.github_repo} #${s.github_issue_number}`,
                    subtitle: s.github_project_title || s.project_status || "",
                    link: s.github_url || undefined,
                  });
                  ghCount++;
                }
              });
            });
          } catch {
            // GitHub integration may not be configured — skip silently
          }
        }

        // Low usage accounts — match by organization name
        try {
          const allSummaries = await fetchAllAmplitudeSummaries();
          const orgNames = new Set(myPortfolio.customers.map((c) => c.organization?.name?.toLowerCase()).filter(Boolean));
          const lowUsage = allSummaries.filter((s: any) => {
            const matchesPortfolio = orgNames.has(s.organization?.toLowerCase());
            const hasLowUsage = s.activeUsers === 0 || s.sessionsLast30Days === 0;
            return matchesPortfolio && hasLowUsage;
          });
          for (const s of lowUsage.slice(0, 5)) {
            items.push({
              id: `usage-${s.organization}`,
              category: "usage",
              priority: "low",
              title: s.organization,
              subtitle: "No active usage in last 30 days",
              link: "/csm/usage",
            });
          }
        } catch {
          // Amplitude may not be configured — skip
        }
      }
    }

    // Renewals filtered to this CSM
    if (renewalsResp.status === "fulfilled") {
      const opps = renewalsResp.value.opportunities;
      const myRenewals = opps.filter((o) => o.csmEmail?.toLowerCase() === userEmail.toLowerCase());

      // At-risk and upcoming
      for (const opp of myRenewals.slice(0, 10)) {
        const days = daysFromNow(opp.renewalDate);
        if (days >= 0 && days <= 90) {
          items.push({
            id: `renewal-${opp.id}`,
            category: "renewals",
            priority: opp.atRisk ? "high" : days <= 30 ? "medium" : "low",
            title: opp.accountName,
            subtitle: `Renews in ${days}d · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(opp.amount)}${opp.atRisk ? " · ⚠ At Risk" : ""}`,
            link: "/csm/renewals",
          });
        }
      }

      // Overdue R-6 actions for CSM's renewals
      const transformed = myRenewals.map(transformApiOpportunity);
      for (const opp of transformed) {
        const overdue = WorkflowEngine.getOverdueActions(opp);
        for (const item of overdue.slice(0, 5)) {
          items.push({
            id: `r6-${opp.id}-${item.milestone}`,
            category: "overdue-actions",
            priority: item.daysPastDue > 30 ? "high" : "medium",
            title: item.opportunity.companyName,
            subtitle: `${item.milestone} action · ${item.daysPastDue}d overdue`,
            detail: item.action.description,
            link: "/product/renewals/upcoming",
          });
        }
      }
    }
  }

  async function loadPMTodos(items: TodoItem[]) {
    const portfoliosResp = await fetchPMPortfolios().catch(() => null);

    if (portfoliosResp) {
      const myPortfolio = (portfoliosResp as any).portfolios?.find(
        (p: any) => p.pm?.email?.toLowerCase() === userEmail.toLowerCase()
      );

      if (myPortfolio?.customers) {
        const allTickets: any[] = myPortfolio.customers.flatMap((c: any) => c.tickets || []);
        const attentionTickets = allTickets.filter((t: any) => ticketNeedsAttention(t, 7));
        for (const t of attentionTickets.slice(0, 10)) {
          items.push({
            id: `ticket-${t.id}`,
            category: "tickets",
            priority: t.priority === "urgent" ? "high" : "medium",
            title: t.subject || `Ticket #${t.id}`,
            subtitle: `#${t.id} · ${t.status}`,
            link: "/pm/support",
          });
        }
      }
    }

    // Mavenlink placeholder
    items.push({
      id: "mavenlink-placeholder",
      category: "github",
      priority: "low",
      title: "Mavenlink active projects",
      subtitle: "Coming soon — Mavenlink integration in progress",
    });
  }

  async function loadRenewalSpecialistTodos(items: TodoItem[]) {
    try {
      const renewalsResp = await fetchRenewalOpportunities(90);
      const opps = renewalsResp.opportunities;
      const myRenewals = opps.filter((o) => o.prsEmail?.toLowerCase() === userEmail.toLowerCase());

      for (const opp of myRenewals.slice(0, 15)) {
        const days = daysFromNow(opp.renewalDate);
        if (days >= 0 && days <= 90) {
          items.push({
            id: `renewal-${opp.id}`,
            category: "renewals",
            priority: opp.atRisk ? "high" : days <= 30 ? "medium" : "low",
            title: opp.accountName,
            subtitle: `Renews in ${days}d · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(opp.amount)}${opp.atRisk ? " · ⚠ At Risk" : ""}`,
            link: "/renewal-specialist",
          });
        }
      }

      const transformed = myRenewals.map(transformApiOpportunity);
      for (const opp of transformed) {
        const overdue = WorkflowEngine.getOverdueActions(opp);
        for (const item of overdue.slice(0, 5)) {
          items.push({
            id: `r6-${opp.id}-${item.milestone}`,
            category: "overdue-actions",
            priority: item.daysPastDue > 30 ? "high" : "medium",
            title: item.opportunity.companyName,
            subtitle: `${item.milestone} · ${item.daysPastDue}d overdue`,
            detail: item.action.description,
            link: "/renewal-specialist",
          });
        }
      }
    } catch {
      // Salesforce may not be configured
    }
  }

  const filteredTodos = useMemo(() => {
    // Filter renewals by time range; others always show
    return todos.filter((t) => {
      if (t.category !== "renewals") return true;
      // Time range is conveyed by the data already (we always fetch 90d)
      // Use the priority to approximate: high = this month, medium = this week
      if (timeRange === "today") return t.priority === "high";
      if (timeRange === "week") return t.priority !== "low";
      return true;
    });
  }, [todos, timeRange]);

  const categories = useMemo(() => {
    const cats = new Map<TodoItem["category"], TodoItem[]>();
    const order: TodoItem["category"][] = ["tickets", "renewals", "overdue-actions", "github", "usage"];
    for (const cat of order) {
      const items = filteredTodos.filter((t) => t.category === cat);
      if (items.length > 0) cats.set(cat, items);
    }
    return cats;
  }, [filteredTodos]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <section className="home-todo" aria-labelledby="todo-title">
      <div className="todo-header">
        <h3 id="todo-title">My Tasks</h3>
        <div className="todo-range-tabs" role="tablist" aria-label="Time range">
          {(["today", "week", "month"] as TimeRange[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={timeRange === r}
              className={`todo-range-tab${timeRange === r ? " active" : ""}`}
              onClick={() => setTimeRange(r)}
            >
              {r === "today" ? "Today" : r === "week" ? "This week" : "Next 90 days"}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="widget-loading">Loading your tasks…</p>}

      {!loading && categories.size === 0 && (
        <div className="todo-empty">
          <p>🎉 Nothing needs your attention right now.</p>
        </div>
      )}

      {!loading && Array.from(categories.entries()).map(([cat, items]) => (
        <div key={cat} className="todo-category">
          <button
            className="todo-category-header"
            onClick={() => toggleCategory(cat)}
            aria-expanded={expandedCategories.has(cat)}
          >
            <span>{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
            <span className="todo-count">{items.length}</span>
            <span className="todo-chevron" aria-hidden="true">{expandedCategories.has(cat) ? "▾" : "▸"}</span>
          </button>

          {expandedCategories.has(cat) && (
            <ul className="todo-items" role="list">
              {items.map((item) => (
                <li key={item.id} className={`todo-item priority-${item.priority}`}>
                  {item.link ? (
                    <button
                      className="todo-item-btn"
                      onClick={() => {
                        if (item.link?.startsWith("http")) {
                          window.open(item.link, "_blank", "noopener");
                        } else if (item.link) {
                          navigate(item.link);
                        }
                      }}
                    >
                      <span className="todo-item-title">{item.title}</span>
                      {item.subtitle && <span className="todo-item-subtitle">{item.subtitle}</span>}
                      {item.detail && <span className="todo-item-detail">{item.detail}</span>}
                    </button>
                  ) : (
                    <div className="todo-item-static">
                      <span className="todo-item-title">{item.title}</span>
                      {item.subtitle && <span className="todo-item-subtitle">{item.subtitle}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
