import { useEffect, useState, useMemo } from "react";
import { fetchProducts, fetchGitHubStatusForTickets } from "../services/api";
import type { ProductGroup, ProductType, ProductSubtype, ProductTicket } from "../services/api";
import type { GitHubDevelopmentStatus } from "../types";

type StatusFilter = "all" | "open" | "new" | "pending" | "hold" | "closed";

export function ProductView() {
  const [products, setProducts] = useState<ProductGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [expandedSubtypes, setExpandedSubtypes] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [githubStatusMap, setGitHubStatusMap] = useState<Map<number, GitHubDevelopmentStatus[]>>(new Map());
  const [loadingGitHub, setLoadingGitHub] = useState(false);

  useEffect(() => {
    async function loadProducts() {
      try {
        const data = await fetchProducts();
        setProducts(data.products);

        // Auto-expand first product if only a few
        if (data.products.length <= 3) {
          setExpandedProducts(new Set(data.products.map((p) => p.product)));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load products");
      } finally {
        setLoading(false);
      }
    }

    loadProducts();
  }, []);

  // Fetch GitHub statuses for expanded products
  useEffect(() => {
    if (expandedProducts.size === 0) return;

    const ticketIds: number[] = [];
    for (const product of products) {
      if (!expandedProducts.has(product.product)) continue;
      for (const type of product.types) {
        for (const subtype of type.subtypes) {
          for (const ticket of subtype.tickets) {
            if (!githubStatusMap.has(ticket.id)) {
              ticketIds.push(ticket.id);
            }
          }
        }
      }
    }

    if (ticketIds.length === 0) return;

    setLoadingGitHub(true);
    fetchGitHubStatusForTickets(ticketIds)
      .then((newMap) => {
        setGitHubStatusMap((prev) => {
          const merged = new Map(prev);
          // Mark all requested tickets as checked (empty array for those without links)
          for (const id of ticketIds) {
            if (!merged.has(id)) {
              merged.set(id, []);
            }
          }
          // Add actual GitHub statuses for tickets that have them
          for (const [id, statuses] of newMap) {
            merged.set(id, statuses);
          }
          return merged;
        });
      })
      .catch((err) => console.error("Failed to fetch GitHub statuses:", err))
      .finally(() => setLoadingGitHub(false));
  }, [expandedProducts, products, githubStatusMap]);

  // Filter products based on status and search
  const filteredProducts = useMemo(() => {
    return products.map((product) => {
      const filteredTypes = product.types.map((type) => {
        const filteredSubtypes = type.subtypes.map((subtype) => {
          let tickets = subtype.tickets;

          // Apply status filter
          if (statusFilter === "open") {
            tickets = tickets.filter((t) => ["new", "open", "pending", "hold"].includes(t.status));
          } else if (statusFilter === "closed") {
            tickets = tickets.filter((t) => ["solved", "closed"].includes(t.status));
          } else if (statusFilter === "new") {
            tickets = tickets.filter((t) => t.status === "new");
          } else if (statusFilter === "pending") {
            tickets = tickets.filter((t) => t.status === "pending");
          } else if (statusFilter === "hold") {
            tickets = tickets.filter((t) => t.status === "hold");
          }

          // Apply search filter
          if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            tickets = tickets.filter((t) =>
              t.subject?.toLowerCase().includes(query) ||
              t.organization_name.toLowerCase().includes(query) ||
              t.id.toString().includes(query)
            );
          }

          return { ...subtype, tickets };
        }).filter((s) => s.tickets.length > 0);

        const totalTickets = filteredSubtypes.reduce((sum, s) => sum + s.tickets.length, 0);
        const openTickets = filteredSubtypes.reduce((sum, s) =>
          sum + s.tickets.filter((t) => ["new", "open", "pending", "hold"].includes(t.status)).length, 0);

        return { ...type, subtypes: filteredSubtypes, totalTickets, openTickets };
      }).filter((t) => t.subtypes.length > 0);

      const totalTickets = filteredTypes.reduce((sum, t) => sum + t.totalTickets, 0);
      const openTickets = filteredTypes.reduce((sum, t) => sum + t.openTickets, 0);

      return { ...product, types: filteredTypes, totalTickets, openTickets };
    }).filter((p) => p.types.length > 0);
  }, [products, statusFilter, searchQuery]);

  // Calculate individual status counts from original products (for badges)
  const statusCounts = useMemo(() => {
    let newCount = 0, pendingCount = 0, holdCount = 0, openCount = 0;
    for (const product of products) {
      for (const type of product.types) {
        for (const subtype of type.subtypes) {
          for (const ticket of subtype.tickets) {
            if (ticket.status === "new") newCount++;
            else if (ticket.status === "pending") pendingCount++;
            else if (ticket.status === "hold") holdCount++;
            else if (ticket.status === "open") openCount++;
          }
        }
      }
    }
    return { new: newCount, pending: pendingCount, hold: holdCount, open: openCount };
  }, [products]);

  const toggleProduct = (product: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(product)) {
        next.delete(product);
      } else {
        next.add(product);
      }
      return next;
    });
  };

  const toggleType = (key: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSubtype = (key: string) => {
    setExpandedSubtypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allProducts = new Set(filteredProducts.map((p) => p.product));
    const allTypes = new Set<string>();
    const allSubtypes = new Set<string>();

    filteredProducts.forEach((p) => {
      p.types.forEach((t) => {
        allTypes.add(`${p.product}-${t.type}`);
        t.subtypes.forEach((s) => {
          allSubtypes.add(`${p.product}-${t.type}-${s.subtype}`);
        });
      });
    });

    setExpandedProducts(allProducts);
    setExpandedTypes(allTypes);
    setExpandedSubtypes(allSubtypes);
  };

  const collapseAll = () => {
    setExpandedProducts(new Set());
    setExpandedTypes(new Set());
    setExpandedSubtypes(new Set());
  };

  if (loading) {
    return <div className="loading">Loading products...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  // Calculate counts from filtered products
  const totalTickets = filteredProducts.reduce((sum, p) => sum + p.totalTickets, 0);
  const totalOpen = filteredProducts.reduce((sum, p) => sum + p.openTickets, 0);

  return (
    <div className="product-view">
      <div className="product-view-header">
        <div className="product-stats-summary">
          <div className="stat-item">
            <strong>{filteredProducts.length}</strong>
            <span className="label">Products</span>
          </div>
          <div className="stat-item">
            <strong>{totalTickets.toLocaleString()}</strong>
            <span className="label">Total Tickets</span>
          </div>
          <div className="stat-item open">
            <strong>{totalOpen.toLocaleString()}</strong>
            <span className="label">Open</span>
          </div>
          {loadingGitHub && <span className="loading-github">Loading GitHub...</span>}
        </div>

        <div className="product-controls">
          <div className="search-box">
            <input
              id="product-search"
              name="product-search"
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery("")}>×</button>
            )}
          </div>

          <div className="status-filter">
            <button
              className={statusFilter === "all" ? "active" : ""}
              onClick={() => setStatusFilter("all")}
            >
              All
            </button>
            <button
              className={statusFilter === "open" ? "active" : ""}
              onClick={() => setStatusFilter("open")}
            >
              Open
            </button>
            <button
              className={`status-badge-btn new ${statusFilter === "new" ? "active" : ""}`}
              onClick={() => setStatusFilter("new")}
            >
              New <span className="badge">{statusCounts.new}</span>
            </button>
            <button
              className={`status-badge-btn pending ${statusFilter === "pending" ? "active" : ""}`}
              onClick={() => setStatusFilter("pending")}
            >
              Pending <span className="badge">{statusCounts.pending}</span>
            </button>
            <button
              className={`status-badge-btn hold ${statusFilter === "hold" ? "active" : ""}`}
              onClick={() => setStatusFilter("hold")}
            >
              Hold <span className="badge">{statusCounts.hold}</span>
            </button>
            <button
              className={statusFilter === "closed" ? "active" : ""}
              onClick={() => setStatusFilter("closed")}
            >
              Closed
            </button>
          </div>

          <div className="expand-controls">
            <button onClick={expandAll}>Expand All</button>
            <button onClick={collapseAll}>Collapse All</button>
          </div>
        </div>
      </div>

      <div className="product-list">
        {filteredProducts.length === 0 ? (
          <div className="no-results">No tickets match the current filters</div>
        ) : (
          filteredProducts.map((product) => (
            <ProductCard
              key={product.product}
              product={product}
              expanded={expandedProducts.has(product.product)}
              onToggle={() => toggleProduct(product.product)}
              expandedTypes={expandedTypes}
              onTypeToggle={toggleType}
              expandedSubtypes={expandedSubtypes}
              onSubtypeToggle={toggleSubtype}
              githubStatusMap={githubStatusMap}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ProductCardProps {
  product: ProductGroup;
  expanded: boolean;
  onToggle: () => void;
  expandedTypes: Set<string>;
  onTypeToggle: (key: string) => void;
  expandedSubtypes: Set<string>;
  onSubtypeToggle: (key: string) => void;
  githubStatusMap: Map<number, GitHubDevelopmentStatus[]>;
}

function ProductCard({
  product,
  expanded,
  onToggle,
  expandedTypes,
  onTypeToggle,
  expandedSubtypes,
  onSubtypeToggle,
  githubStatusMap,
}: ProductCardProps) {
  return (
    <div className={`product-card ${expanded ? "expanded" : ""}`}>
      <div className="product-header" onClick={onToggle}>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
        <h3 className="product-name">{product.product}</h3>
        <div className="product-stats">
          <span className="stat total">{product.totalTickets} tickets</span>
          <span className="stat open">{product.openTickets} open</span>
        </div>
      </div>

      {expanded && (
        <div className="product-content">
          {product.types.map((type) => {
            const typeKey = `${product.product}-${type.type}`;
            const typeExpanded = expandedTypes.has(typeKey);

            return (
              <TypeSection
                key={typeKey}
                productName={product.product}
                type={type}
                expanded={typeExpanded}
                onToggle={() => onTypeToggle(typeKey)}
                expandedSubtypes={expandedSubtypes}
                onSubtypeToggle={onSubtypeToggle}
                githubStatusMap={githubStatusMap}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TypeSectionProps {
  productName: string;
  type: ProductType;
  expanded: boolean;
  onToggle: () => void;
  expandedSubtypes: Set<string>;
  onSubtypeToggle: (key: string) => void;
  githubStatusMap: Map<number, GitHubDevelopmentStatus[]>;
}

function TypeSection({
  productName,
  type,
  expanded,
  onToggle,
  expandedSubtypes,
  onSubtypeToggle,
  githubStatusMap,
}: TypeSectionProps) {
  const typeClass = type.type.toLowerCase();

  return (
    <div className={`type-section type-${typeClass}`}>
      <div className="type-header" onClick={onToggle}>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
        <span className={`type-badge ${typeClass}`}>{type.type}</span>
        <span className="type-stats">
          {type.totalTickets} tickets ({type.openTickets} open)
        </span>
      </div>

      {expanded && (
        <div className="type-content">
          {type.subtypes.map((subtype) => {
            const subtypeKey = `${productName}-${type.type}-${subtype.subtype}`;
            const subtypeExpanded = expandedSubtypes.has(subtypeKey);

            return (
              <SubtypeSection
                key={subtypeKey}
                subtype={subtype}
                expanded={subtypeExpanded}
                onToggle={() => onSubtypeToggle(subtypeKey)}
                githubStatusMap={githubStatusMap}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SubtypeSectionProps {
  subtype: ProductSubtype;
  expanded: boolean;
  onToggle: () => void;
  githubStatusMap: Map<number, GitHubDevelopmentStatus[]>;
}

function SubtypeSection({ subtype, expanded, onToggle, githubStatusMap }: SubtypeSectionProps) {
  const openCount = subtype.tickets.filter((t) =>
    ["new", "open", "pending", "hold"].includes(t.status)
  ).length;

  return (
    <div className={`subtype-section ${expanded ? "expanded" : ""}`}>
      <div className="subtype-header" onClick={onToggle}>
        <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
        <span className="subtype-name">{subtype.subtype}</span>
        <span className="subtype-stats">
          {subtype.tickets.length} tickets ({openCount} open)
        </span>
      </div>

      {expanded && (
        <div className="subtype-content">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Priority</th>
                <th>GitHub</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {subtype.tickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  githubStatuses={githubStatusMap.get(ticket.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface TicketRowProps {
  ticket: ProductTicket;
  githubStatuses?: GitHubDevelopmentStatus[];
}

function TicketRow({ ticket, githubStatuses }: TicketRowProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const openInZendesk = () => {
    window.open(ticket.url, "_blank");
  };

  return (
    <tr
      className={`ticket-row ${ticket.is_escalated ? "escalated" : ""} status-${ticket.status}`}
      onClick={openInZendesk}
    >
      <td className="ticket-id">
        <a href={ticket.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          #{ticket.id}
        </a>
        {ticket.is_escalated && <span className="escalation-indicator" title="Escalated">!</span>}
      </td>
      <td className="ticket-subject">{ticket.subject || "No subject"}</td>
      <td className="ticket-org">{ticket.organization_name}</td>
      <td className={`ticket-status status-${ticket.status}`}>{ticket.status}</td>
      <td className={`ticket-priority priority-${ticket.priority || "normal"}`}>
        {ticket.priority || "normal"}
      </td>
      <td className="ticket-github">
        {githubStatuses && githubStatuses.length > 0 ? (
          <div className="github-links">
            {githubStatuses.map((gh, idx) => (
              <a
                key={idx}
                href={gh.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`github-status-pill status-${gh.projectStatus?.toLowerCase().replace(/\s+/g, "-") || "unknown"}`}
                onClick={(e) => e.stopPropagation()}
                title={`${gh.repoName}#${gh.issueNumber}`}
              >
                <span className="gh-icon">GH</span>
                <span className="gh-status">{gh.projectStatus || "Linked"}</span>
              </a>
            ))}
          </div>
        ) : (
          <span className="no-github">-</span>
        )}
      </td>
      <td className="ticket-updated">{formatDate(ticket.updated_at)}</td>
    </tr>
  );
}
