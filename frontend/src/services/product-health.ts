/**
 * Per-product health scoring — computed entirely on the frontend
 * from data already fetched (unified Amplitude + SF subscriptions).
 * Zero additional API calls.
 */

import type { UnifiedProductMetrics, UnifiedUsageResponse, EnterpriseSubscription } from "./api";

export type Signal = "green" | "yellow" | "red";
export type Trend = "improving" | "worsening" | "flat" | null;

export interface ProductHealthSignal {
  label: string;
  signal: Signal;
  detail: string;
  trend?: Trend;
}

export interface ProductHealthScore {
  slug: string;
  displayName: string;
  signal: Signal;
  trend: Trend;
  signals: ProductHealthSignal[];
  summary: string; // one-line key metric
  excludeFromOverall?: boolean; // if true, not counted in overall adoption score
  note?: string; // displayed as a caveat
  actionItems?: string[]; // CSM action items when something needs attention
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEvent(product: UnifiedProductMetrics, eventName: string, metric: "uniques" | "totals"): { current: number; previous: number; twoAgo: number } {
  const evt = product.events.find((e) => e.event === eventName && e.metric === metric);
  return evt || { current: 0, previous: 0, twoAgo: 0 };
}

function getEventAny(product: UnifiedProductMetrics, eventName: string): { current: number; previous: number; twoAgo: number } {
  const evt = product.events.find((e) => e.event === eventName);
  return evt || { current: 0, previous: 0, twoAgo: 0 };
}

function computeSignal(value: number, greenThreshold: number, yellowThreshold: number): Signal {
  if (value >= greenThreshold) return "green";
  if (value >= yellowThreshold) return "yellow";
  return "red";
}

function computeTrend(current: number, previous: number, threshold: number = 0.15): Trend {
  if (previous === 0 && current === 0) return null;
  if (previous === 0 && current > 0) return "improving";
  if (previous === 0) return "flat";
  const pctChange = (current - previous) / previous;
  if (pctChange > threshold) return "improving";
  if (pctChange < -threshold) return "worsening";
  return "flat";
}

function overallSignal(signals: ProductHealthSignal[]): Signal {
  const reds = signals.filter((s) => s.signal === "red").length;
  const yellows = signals.filter((s) => s.signal === "yellow").length;
  if (reds >= 2 || (reds >= 1 && signals.length <= 2)) return "red";
  if (reds === 1 || yellows >= 2) return "yellow";
  return "green";
}

function getSubsForProduct(slug: string, subscriptions: EnterpriseSubscription[]): EnterpriseSubscription[] {
  const typeMap: Record<string, string[]> = {
    "axe-devtools-(browser-extension)": ["axe-devtools-pro", "axe-devtools-html"],
    "developer-hub": ["axe-devtools-pro", "axe-devtools-html"], // shares devtools seats
    "axe-devtools-mobile": ["axe-devtools-mobile"],
    "axe-monitor": ["axe-monitor", "axe-monitor-pro"],
    "deque-university": ["deque-university", "dequeu"],
    "axe-assistant": ["axe-assistant-slack", "axe-assistant-teams"],
    "axe-linter": ["axe-devtools-linter"],
  };
  const types = typeMap[slug];
  if (!types) return [];
  return subscriptions.filter((s) => types.includes(s.productType.toLowerCase()));
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function perUser(total: number, users: number): number {
  return users > 0 ? Math.round((total / users) * 10) / 10 : 0;
}

// ── Per-Product Scorers ──────────────────────────────────────────────────────

function scoreDevToolsExtension(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "analysis:complete", "uniques");
  const scansCompleted = getEvent(product, "analysis:complete", "totals");
  const licensed = subs.reduce((s, sub) => s + sub.licenseCount, 0);
  const assigned = subs.reduce((s, sub) => s + sub.assignedSeats, 0);

  // Activation: seat utilization
  const seatPct = pct(assigned, licensed);
  signals.push({
    label: "Seat Activation",
    signal: computeSignal(seatPct, 70, 40),
    detail: `${seatPct}% (${assigned}/${licensed} seats)`,
  });

  // Depth: scans per user
  const scansPerUser = perUser(scansCompleted.current, activeUsers.current);
  signals.push({
    label: "Scans per User",
    signal: computeSignal(scansPerUser, 10, 3),
    detail: `${scansPerUser} scans/user this month`,
  });

  // Velocity
  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({
    label: "Usage Trend",
    signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow",
    detail: `${activeUsers.previous}→${activeUsers.current} active users`,
    trend,
  });

  const actionItems: string[] = [];
  if (assigned > 0 && activeUsers.current === 0 && activeUsers.previous === 0 && activeUsers.twoAgo === 0) {
    actionItems.push("Zero usage detected with seats assigned. Check with customer if the deque_enterprise_id property has been set in their axe DevTools configuration.");
  }

  return {
    slug: product.slug, displayName: product.displayName,
    signal: overallSignal(signals), trend,
    signals, summary: `${seatPct}% seats, ${activeUsers.current} active users`,
    actionItems: actionItems.length > 0 ? actionItems : undefined,
  };
}

function scoreDeveloperHub(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "project:create", "uniques");
  const analyses = getEventAny(product, "analysis:analyze");
  const licensed = subs.reduce((s, sub) => s + sub.licenseCount, 0);

  const activePct = licensed > 0 ? pct(activeUsers.current, licensed) : (activeUsers.current > 0 ? 100 : 0);
  signals.push({ label: "User Activation", signal: computeSignal(activePct, 30, 10), detail: `${activePct}% of devtools users` });

  const analysesPerUser = perUser(analyses.current, activeUsers.current);
  signals.push({ label: "Analyses per User", signal: computeSignal(analysesPerUser, 5, 1), detail: `${analysesPerUser}/user this month` });

  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({ label: "Usage Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${activeUsers.previous}→${activeUsers.current} active users`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${activeUsers.current} active users` };
}

function scoreMonitor(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const scans = getEvent(product, "scan:create:complete", "totals");

  // SF data
  const pageCapacity = subs.reduce((s, sub) => s + sub.licenseCount, 0);
  const pagesUsed = subs.reduce((s, sub) => s + (sub.monitorPageCount || 0), 0);
  const projectCount = subs.reduce((s, sub) => s + (sub.monitorProjectCount || 0), 0);
  const isUnlimited = pageCapacity >= 9999999;

  // Activation: page capacity usage
  const pagePct = isUnlimited ? 100 : pct(pagesUsed, pageCapacity);
  signals.push({
    label: "Page Capacity",
    signal: isUnlimited ? "green" : computeSignal(pagePct, 60, 25),
    detail: isUnlimited ? `${pagesUsed.toLocaleString()} pages (unlimited)` : `${pagePct}% (${pagesUsed.toLocaleString()}/${pageCapacity.toLocaleString()})`,
  });

  // Depth: projects
  signals.push({ label: "Projects (Sites)", signal: computeSignal(projectCount, 3, 1), detail: `${projectCount} projects` });

  // Velocity
  const trend = computeTrend(scans.current, scans.previous);
  signals.push({
    label: "Scan Trend",
    signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow",
    detail: `${scans.previous}→${scans.current} scans/month`,
    trend,
  });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${pagesUsed.toLocaleString()} pages, ${projectCount} projects` };
}

function scoreMobile(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const scansCreated = getEventAny(product, "scan:create");
  const scansSaved = getEventAny(product, "scan:save");
  const licensed = subs.reduce((s, sub) => s + sub.licenseCount, 0);
  const assigned = subs.reduce((s, sub) => s + sub.assignedSeats, 0);

  const seatPct = pct(assigned, licensed);
  signals.push({ label: "Seat Activation", signal: computeSignal(seatPct, 70, 40), detail: `${seatPct}% (${assigned}/${licensed})` });

  const saveRate = scansCreated.current > 0 ? pct(scansSaved.current, scansCreated.current) : 0;
  signals.push({ label: "Save Rate", signal: computeSignal(saveRate, 50, 20), detail: `${saveRate}% of scans saved` });

  const trend = computeTrend(scansCreated.current, scansCreated.previous);
  signals.push({ label: "Scan Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${scansCreated.previous}→${scansCreated.current} scans/month`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${seatPct}% seats, ${scansCreated.current} scans` };
}

function scoreDequeUniversity(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const sessions = getEvent(product, "session_start", "uniques");
  const downloads = getEventAny(product, "[Amplitude] File Downloaded");
  const licensed = subs.reduce((s, sub) => s + sub.licenseCount, 0);

  const sessionPct = licensed > 0 ? pct(sessions.current, licensed) : (sessions.current > 0 ? 100 : 0);
  signals.push({ label: "Learner Activation", signal: computeSignal(sessionPct, 50, 20), detail: `${sessionPct}% of seats active (${sessions.current}/${licensed})` });

  signals.push({ label: "Downloads", signal: computeSignal(downloads.current, 5, 1), detail: `${downloads.current} files this month` });

  const trend = computeTrend(sessions.current, sessions.previous);
  signals.push({ label: "Session Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${sessions.previous}→${sessions.current} learners/month`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${sessionPct}% active, ${sessions.current} learners` };
}

function scoreAssistant(product: UnifiedProductMetrics): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "user:message_sent", "uniques");
  const messages = getEvent(product, "user:message_sent", "totals");

  signals.push({ label: "Active Users", signal: computeSignal(activeUsers.current, 5, 2), detail: `${activeUsers.current} users this month` });

  const msgsPerUser = perUser(messages.current, activeUsers.current);
  signals.push({ label: "Messages per User", signal: computeSignal(msgsPerUser, 10, 3), detail: `${msgsPerUser}/user` });

  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({ label: "Usage Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${activeUsers.previous}→${activeUsers.current} users`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${activeUsers.current} users, ${messages.current} messages` };
}

function scoreLinter(product: UnifiedProductMetrics, subs: EnterpriseSubscription[]): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "extension:configure", "uniques");
  const lintRuns = getEventAny(product, "extension:lsp-server-lint");
  const licensed = subs.reduce((s, sub) => s + sub.licenseCount, 0);

  const seatPct = licensed > 0 ? pct(activeUsers.current, licensed) : (activeUsers.current > 0 ? 100 : 0);
  signals.push({ label: "Seat Activation", signal: computeSignal(seatPct, 60, 30), detail: `${seatPct}% (${activeUsers.current}/${licensed})` });

  const runsPerUser = perUser(lintRuns.current, activeUsers.current);
  signals.push({ label: "Lint Runs per User", signal: computeSignal(runsPerUser, 20, 5), detail: `${runsPerUser}/user` });

  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({ label: "Usage Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${activeUsers.previous}→${activeUsers.current} users`, trend });

  return {
    slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals,
    summary: `${activeUsers.current} users, ${lintRuns.current} lint runs`,
    excludeFromOverall: true,
    note: "Linter uses lines of code (not seats). Local usage not tracked — score may undercount.",
  };
}

function scoreReports(product: UnifiedProductMetrics): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "usage:chart:load", "uniques");
  const usageCharts = getEvent(product, "usage:chart:load", "totals");
  const outcomesCharts = getEventAny(product, "outcomes:chart:load");

  signals.push({ label: "Active Users", signal: computeSignal(activeUsers.current, 3, 1), detail: `${activeUsers.current} users` });

  const totalCharts = usageCharts.current + outcomesCharts.current;
  signals.push({ label: "Chart Loads", signal: computeSignal(totalCharts, 10, 1), detail: `${totalCharts} charts loaded` });

  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({ label: "Usage Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${activeUsers.previous}→${activeUsers.current} users`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${activeUsers.current} users, ${totalCharts} charts` };
}

function scoreMCPServer(product: UnifiedProductMetrics): ProductHealthScore {
  const signals: ProductHealthSignal[] = [];
  const activeUsers = getEvent(product, "axe-mcp-server:analyze", "uniques");
  const analyses = getEvent(product, "axe-mcp-server:analyze", "totals");
  const remediations = getEventAny(product, "axe-mcp-server:remediate");

  signals.push({ label: "Active Users", signal: computeSignal(activeUsers.current, 3, 1), detail: `${activeUsers.current} users` });

  const actionsPerUser = perUser(analyses.current + remediations.current, activeUsers.current);
  signals.push({ label: "Actions per User", signal: computeSignal(actionsPerUser, 5, 1), detail: `${actionsPerUser}/user (analyses + remediations)` });

  const trend = computeTrend(activeUsers.current, activeUsers.previous);
  signals.push({ label: "Usage Trend", signal: trend === "worsening" ? "red" : trend === "improving" ? "green" : "yellow", detail: `${activeUsers.previous}→${activeUsers.current} users`, trend });

  return { slug: product.slug, displayName: product.displayName, signal: overallSignal(signals), trend, signals, summary: `${activeUsers.current} users, ${analyses.current} analyses` };
}

// ── Main Scoring Function ────────────────────────────────────────────────────

const PRODUCT_SCORERS: Record<string, (product: UnifiedProductMetrics, subs: EnterpriseSubscription[]) => ProductHealthScore> = {
  "axe-devtools-(browser-extension)": scoreDevToolsExtension,
  "developer-hub": scoreDeveloperHub,
  "axe-monitor": scoreMonitor,
  "axe-devtools-mobile": scoreMobile,
  "deque-university": scoreDequeUniversity,
  "axe-assistant": (p) => scoreAssistant(p),
  "axe-linter": scoreLinter,
  "axe-reports": (p) => scoreReports(p),
  "axe-mcp-server": (p) => scoreMCPServer(p),
  // axe-account-portal excluded — admin tool, not adoption signal
};

/**
 * Compute per-product health scores from existing data.
 * No additional API calls — uses data already fetched.
 */
export function computeProductHealthScores(
  amplitudeData: UnifiedUsageResponse,
  subscriptions: EnterpriseSubscription[]
): ProductHealthScore[] {
  const scores: ProductHealthScore[] = [];

  for (const [slug, product] of Object.entries(amplitudeData.products)) {
    const scorer = PRODUCT_SCORERS[slug];
    if (!scorer) continue;

    const productSubs = getSubsForProduct(slug, subscriptions);
    const score = scorer(product, productSubs);
    scores.push(score);
  }

  return scores.sort((a, b) => {
    // Sort: red first, then yellow, then green
    const order: Record<Signal, number> = { red: 0, yellow: 1, green: 2 };
    return order[a.signal] - order[b.signal];
  });
}

/**
 * Compute overall Adoption signal from per-product scores.
 * Weighted worst-of: if only 1 of 5+ products is red, overall = yellow.
 */
export function computeOverallAdoption(productScores: ProductHealthScore[]): { signal: Signal; trend: Trend } {
  // Only include products not excluded from overall score
  const scoredProducts = productScores.filter((s) => !s.excludeFromOverall);
  if (scoredProducts.length === 0) return { signal: "yellow", trend: null };

  const reds = scoredProducts.filter((s) => s.signal === "red").length;
  const yellows = scoredProducts.filter((s) => s.signal === "yellow").length;
  const trends = scoredProducts.map((s) => s.trend).filter((t): t is Trend => t !== null);

  // Weighted worst-of: soften if only 1 red out of many products
  let signal: Signal;
  if (reds >= 2) signal = "red";
  else if (reds === 1 && scoredProducts.length >= 5) signal = "yellow"; // softened
  else if (reds === 1) signal = "red";
  else if (yellows >= 2) signal = "yellow";
  else signal = "green";

  // Trend: majority vote
  const worsening = trends.filter((t) => t === "worsening").length;
  const improving = trends.filter((t) => t === "improving").length;
  let trend: Trend = "flat";
  if (worsening > improving) trend = "worsening";
  else if (improving > worsening) trend = "improving";

  return { signal, trend };
}
