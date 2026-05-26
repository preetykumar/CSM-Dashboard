// Aggregate product usage view at /product/usage.
// Layout (top → bottom):
//   1. Hero StatCard — total active users (sum across all products this month)
//      with trend vs previous month.
//   2. StatGrid — one StatCard per product, headline active-users + trend.
//   3. Detail cards — expandable per-product blocks with the 3-month event
//      table (kept from the previous implementation, restyled on tokens).

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  fetchAggregateUsageMetrics,
  type UnifiedUsageResponse,
  type UnifiedProductMetrics,
  type UnifiedEventMetric,
} from "../services/api";
import {
  Page,
  PageHeader,
  Card,
  CardBody,
  StatCard,
  StatGrid,
  SectionHeader,
  LoadingRow,
  EmptyState,
  Badge,
  Banner,
} from "./ui";

type Trend = "improving" | "worsening" | "flat" | null;

function computeTrend(current: number, previous: number): Trend {
  if (previous === 0 && current === 0) return null;
  if (previous === 0 && current > 0) return "improving";
  if (previous === 0) return "flat";
  const pct = (current - previous) / previous;
  if (pct > 0.15) return "improving";
  if (pct < -0.15) return "worsening";
  return "flat";
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "new" : "—";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function TrendDelta({ current, previous }: { current: number; previous: number }) {
  const t = computeTrend(current, previous);
  if (!t) return null;
  if (t === "improving")
    return (
      <span className="ui-stat__delta ui-stat__delta--up">
        <ArrowUpRight size={14} /> {pctChange(current, previous)} vs prev month
      </span>
    );
  if (t === "worsening")
    return (
      <span className="ui-stat__delta ui-stat__delta--down">
        <ArrowDownRight size={14} /> {pctChange(current, previous)} vs prev month
      </span>
    );
  return (
    <span className="ui-stat__delta ui-stat__delta--flat">
      <ArrowRight size={14} /> flat vs prev month
    </span>
  );
}

// Pull the headline metric for a product. Prefer the "uniques" event
// (active users); fall back to the first metric with non-zero recent values.
function headlineEvent(product: UnifiedProductMetrics): UnifiedEventMetric | null {
  const uniques = product.events.find((e) => e.metric === "uniques" && (e.current > 0 || e.previous > 0));
  if (uniques) return uniques;
  return (
    product.events.find((e) => e.current > 0 || e.previous > 0) ?? null
  );
}

function ProductDetailCard({
  product,
  expanded,
  onToggle,
}: {
  product: UnifiedProductMetrics;
  expanded: boolean;
  onToggle: () => void;
}) {
  const activeEvents = product.events.filter(
    (e) => e.current > 0 || e.previous > 0 || e.twoAgo > 0
  );
  const hasData = activeEvents.length > 0;
  const headline = headlineEvent(product);

  return (
    <Card hoverable={false} className="product-usage-card">
      <div
        role="button"
        tabIndex={0}
        className="product-usage-row"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="product-usage-name">{product.displayName}</span>

        <div className="product-usage-headline">
          {hasData && headline ? (
            <>
              <Badge tone="brand">
                {headline.current.toLocaleString()} {headline.label.toLowerCase()}
              </Badge>
              <TrendDelta current={headline.current} previous={headline.previous} />
            </>
          ) : (
            <Badge tone="neutral">No data</Badge>
          )}
        </div>
      </div>

      {expanded && hasData && (
        <CardBody className="product-usage-detail">
          <table className="product-usage-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>{activeEvents[0]?.labels?.[2] || "2 mo ago"}</th>
                <th>{activeEvents[0]?.labels?.[1] || "Last mo"}</th>
                <th className="current">{activeEvents[0]?.labels?.[0] || "This mo"}</th>
              </tr>
            </thead>
            <tbody>
              {activeEvents.map((evt, i) => (
                <tr key={`${evt.event}-${evt.metric}-${i}`}>
                  <td>{evt.label}</td>
                  <td>{evt.twoAgo.toLocaleString()}</td>
                  <td>{evt.previous.toLocaleString()}</td>
                  <td className="current">
                    {evt.current.toLocaleString()}{" "}
                    <span className="product-usage-cell-trend">
                      <TrendDelta current={evt.current} previous={evt.previous} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      )}
    </Card>
  );
}

export function ProductUsageView() {
  const [data, setData] = useState<UnifiedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAggregateUsageMetrics()
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (slug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const products = useMemo(
    () => (data?.products ? Object.values(data.products) : []),
    [data]
  );

  // Hero stat: sum of headline active-users across all products this month and previous month.
  // Caveat: this is a sum-of-uniques, not a true cross-product unique count. We don't have
  // the user-level data to dedupe across products, so this is "engagement breadth" not
  // "distinct humans."
  const hero = useMemo(() => {
    let current = 0;
    let previous = 0;
    let withData = 0;
    for (const p of products) {
      const h = headlineEvent(p);
      if (!h) continue;
      if (h.current > 0 || h.previous > 0) withData++;
      current += h.current;
      previous += h.previous;
    }
    return { current, previous, withData };
  }, [products]);

  return (
    <Page>
      <PageHeader
        eyebrow="Product"
        title="Usage Data"
        subtitle="Aggregate Amplitude metrics across every customer, summarized by product"
      />

      {loading ? (
        <Card><LoadingRow>Loading aggregate usage data across all customers…</LoadingRow></Card>
      ) : error ? (
        <Card><EmptyState title="Couldn't load usage data" detail={error} /></Card>
      ) : products.length === 0 ? (
        <Card><EmptyState title="No usage data available" detail="Amplitude returned no products. Sync may not have completed." /></Card>
      ) : (
        <>
          {/* Hero stat — total active users this month */}
          <StatGrid>
            <StatCard
              label="Active users this month"
              value={hero.current.toLocaleString()}
              icon={<Users size={16} />}
              delta={<TrendDelta current={hero.current} previous={hero.previous} />}
            />
            <StatCard
              label="Products with data"
              value={`${hero.withData} / ${products.length}`}
              icon={<Package size={16} />}
            />
            <StatCard
              label="Previous month"
              value={hero.previous.toLocaleString()}
              icon={<Users size={16} />}
            />
          </StatGrid>

          <Banner tone="info">
            <strong>Heads-up:</strong> the "Active users this month" total is a sum across
            products, not deduplicated to distinct humans. Use it as an engagement-breadth
            indicator, not a unique-user count.
          </Banner>

          {/* Per-product summary grid */}
          <section>
            <SectionHeader
              title="By product"
              count={`${products.length} ${products.length === 1 ? "product" : "products"}`}
            />
            <StatGrid>
              {products.map((p) => {
                const h = headlineEvent(p);
                return (
                  <StatCard
                    key={`stat-${p.slug}`}
                    label={p.displayName}
                    value={h?.current?.toLocaleString() ?? "—"}
                    delta={
                      h && (h.current > 0 || h.previous > 0) ? (
                        <TrendDelta current={h.current} previous={h.previous} />
                      ) : (
                        <span className="ui-stat__delta ui-stat__delta--flat">no data</span>
                      )
                    }
                  />
                );
              })}
            </StatGrid>
          </section>

          {/* Per-product detail (expandable) */}
          <section>
            <SectionHeader title="Per-product detail" count="click to expand" />
            <div className="product-usage-list">
              {products.map((product) => (
                <ProductDetailCard
                  key={product.slug}
                  product={product}
                  expanded={expanded.has(product.slug)}
                  onToggle={() => toggle(product.slug)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </Page>
  );
}
