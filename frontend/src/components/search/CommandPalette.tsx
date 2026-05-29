// Global Cmd-K command palette.
//
// Mounted once at the app root. Listens for Cmd-K / Ctrl-K to open,
// debounces user input by 200ms, scopes results server-side to what the
// caller can see, and navigates on Enter / click.
//
// Phase B included here:
//  - Recent searches persisted in localStorage (per-user namespace)
//  - Substring match highlighting in result labels
//  - Type-filter chips (All / Accounts / Opportunities / Plans / etc.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, ArrowRight, Building2, Calendar, FileText, Layers, MessageSquare, Clock } from "lucide-react";
import { searchGlobal, type SearchResult, type SearchResultType } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_TABS: Array<{ value: SearchResultType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "account", label: "Accounts" },
  { value: "opportunity", label: "Opportunities" },
  { value: "plan", label: "Plans" },
  { value: "template", label: "Templates" },
  { value: "org", label: "Zendesk" },
];

const TYPE_GROUP_LABEL: Record<SearchResultType, string> = {
  account: "Accounts",
  opportunity: "Opportunities",
  plan: "Plans",
  template: "Templates",
  org: "Zendesk orgs",
};

const TYPE_ORDER: SearchResultType[] = ["account", "opportunity", "plan", "template", "org"];

function TypeIcon({ type }: { type: SearchResultType }) {
  switch (type) {
    case "account": return <Building2 size={14} aria-hidden />;
    case "opportunity": return <Calendar size={14} aria-hidden />;
    case "plan": return <FileText size={14} aria-hidden />;
    case "template": return <Layers size={14} aria-hidden />;
    case "org": return <MessageSquare size={14} aria-hidden />;
  }
}

// Render label with highlighted match ranges. Ranges are [start, end) tuples
// pre-computed by the backend; we just split the string accordingly.
function HighlightedLabel({ label, matches }: { label: string; matches?: Array<[number, number]> }) {
  if (!matches || matches.length === 0) return <>{label}</>;
  const sorted = [...matches].sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) parts.push({ text: label.slice(cursor, start), highlight: false });
    parts.push({ text: label.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < label.length) parts.push({ text: label.slice(cursor), highlight: false });
  return (
    <>
      {parts.map((p, i) =>
        p.highlight ? <mark key={i} className="cp-match">{p.text}</mark> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}

const MAX_RECENT = 6;

interface RecentEntry {
  q: string;
  result: SearchResult; // the result the user actually clicked
}

function loadRecents(email: string | null): RecentEntry[] {
  if (!email) return [];
  try {
    const raw = localStorage.getItem(`cp:recent:${email.toLowerCase()}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(email: string | null, q: string, result: SearchResult) {
  if (!email) return;
  try {
    const key = `cp:recent:${email.toLowerCase()}`;
    const existing = loadRecents(email);
    const dedup = existing.filter((e) => e.result.url !== result.url);
    const next = [{ q, result }, ...dedup].slice(0, MAX_RECENT);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // localStorage may be full / disabled; silently ignore
  }
}

export function CommandPalette({ open, onClose }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [typeFilter, setTypeFilter] = useState<SearchResultType | "all">("all");
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  // Reset state when the palette opens; load recents fresh.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setActiveIdx(0);
      setTypeFilter("all");
      setRecents(loadRecents(user?.email ?? null));
      // Focus the input after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, user?.email]);

  // Debounced search: 200ms after the user stops typing.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      const types = typeFilter === "all" ? undefined : [typeFilter];
      searchGlobal(q, { types })
        .then((data) => {
          setResults(data);
          setActiveIdx(0);
          setLoading(false);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Search failed");
          setLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, typeFilter, open]);

  const openResult = useCallback((r: SearchResult, q: string) => {
    saveRecent(user?.email ?? null, q, r);
    onClose();
    navigate(r.url);
  }, [navigate, onClose, user?.email]);

  // Keyboard navigation while open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const visible = query.trim() ? results : recents.map((r) => r.result);
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown" || (e.key === "j" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
      } else if (e.key === "ArrowUp" || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && visible.length > 0) {
        e.preventDefault();
        const picked = visible[activeIdx] || visible[0];
        if (picked) openResult(picked, query.trim());
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const idx = TYPE_TABS.findIndex((t) => t.value === typeFilter);
        const next = TYPE_TABS[(idx + 1) % TYPE_TABS.length];
        setTypeFilter(next.value);
      } else if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const idx = TYPE_TABS.findIndex((t) => t.value === typeFilter);
        const next = TYPE_TABS[(idx - 1 + TYPE_TABS.length) % TYPE_TABS.length];
        setTypeFilter(next.value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, recents, query, activeIdx, typeFilter, onClose, openResult]);

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cp-idx="${activeIdx}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Group results by type for display.
  const grouped = useMemo(() => {
    const byType = new Map<SearchResultType, SearchResult[]>();
    for (const r of results) {
      const arr = byType.get(r.type) || [];
      arr.push(r);
      byType.set(r.type, arr);
    }
    const out: Array<{ type: SearchResultType; rows: SearchResult[] }> = [];
    for (const t of TYPE_ORDER) {
      const rows = byType.get(t);
      if (rows && rows.length > 0) out.push({ type: t, rows });
    }
    return out;
  }, [results]);

  if (!open) return null;

  const trimmed = query.trim();
  const showingRecents = !trimmed && recents.length > 0;
  const visibleCount = trimmed ? results.length : recents.length;

  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-label="Search" onClick={onClose}>
      <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cp-input-row">
          <Search size={16} className="cp-input-icon" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts, opportunities, plans…"
            aria-label="Search the portal"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc">esc</kbd>
        </div>

        <div className="cp-tabs" role="tablist">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`cp-tab${typeFilter === tab.value ? " active" : ""}`}
              onClick={() => setTypeFilter(tab.value)}
              role="tab"
              aria-selected={typeFilter === tab.value}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="cp-body" ref={listRef}>
          {error ? (
            <div className="cp-error">{error}</div>
          ) : loading && trimmed ? (
            <div className="cp-status">Searching…</div>
          ) : showingRecents ? (
            <div className="cp-group">
              <div className="cp-group-header">
                <Clock size={11} aria-hidden /> Recent
              </div>
              {recents.map((entry, idx) => (
                <button
                  key={entry.result.url}
                  type="button"
                  className={`cp-row${activeIdx === idx ? " active" : ""}`}
                  data-cp-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => openResult(entry.result, entry.q)}
                >
                  <TypeIcon type={entry.result.type} />
                  <div className="cp-row-text">
                    <div className="cp-row-label">{entry.result.label}</div>
                    {entry.result.sublabel && (
                      <div className="cp-row-sublabel">{entry.result.sublabel}</div>
                    )}
                  </div>
                  <ArrowRight size={12} className="cp-row-arrow" aria-hidden />
                </button>
              ))}
            </div>
          ) : !trimmed ? (
            <div className="cp-empty">
              Type to search. Use <kbd>Tab</kbd> to cycle types, <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open.
            </div>
          ) : visibleCount === 0 ? (
            <div className="cp-empty">No results for &ldquo;{trimmed}&rdquo;.</div>
          ) : (
            (() => {
              // Render grouped results with running indices so keyboard nav
              // tracks across groups in display order.
              let runningIdx = 0;
              return grouped.map((g) => (
                <div key={g.type} className="cp-group">
                  <div className="cp-group-header">{TYPE_GROUP_LABEL[g.type]}</div>
                  {g.rows.map((r) => {
                    const idx = runningIdx++;
                    return (
                      <button
                        key={`${r.type}:${r.id}`}
                        type="button"
                        className={`cp-row${activeIdx === idx ? " active" : ""}`}
                        data-cp-idx={idx}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => openResult(r, trimmed)}
                      >
                        <TypeIcon type={r.type} />
                        <div className="cp-row-text">
                          <div className="cp-row-label">
                            <HighlightedLabel label={r.label} matches={r.matches} />
                          </div>
                          {r.sublabel && (
                            <div className="cp-row-sublabel">{r.sublabel}</div>
                          )}
                        </div>
                        <ArrowRight size={12} className="cp-row-arrow" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>

        <div className="cp-footer">
          <span className="cp-hint">
            <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Tab</kbd> filter · <kbd>↵</kbd> open · <kbd>esc</kbd> close
          </span>
          <button type="button" className="cp-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
