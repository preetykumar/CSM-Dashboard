import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";
import type { SalesforceService } from "../services/salesforce.js";
import { salesforceCache } from "../services/cache.js";

const HEALTH_CACHE_TTL = 30; // 30 minutes — health scores change rarely

type Signal = "green" | "yellow" | "red";
type Trend = "improving" | "worsening" | "flat" | null;

interface HealthSignal {
  signal: Signal;
  label: string;
  detail?: string;
  trend?: Trend;
  trendDetail?: string;
}

interface DimensionScore {
  signal: Signal;
  signals: HealthSignal[];
  trend?: Trend;
}

interface HealthScoreResponse {
  accountName: string;
  accountId?: string;
  adoption: DimensionScore;
  engagement: DimensionScore;
  support: DimensionScore;
  manualHealthScore?: string;
  manualHealthDescription?: string;
  riskDrivers?: string;
  interpretation?: string;
}

function getInterpretation(a: Signal, e: Signal, s: Signal): string {
  const key = `${a}${e}${s}`;
  const interpretations: Record<string, string> = {
    "greengreengreen": "Reference-able. Ask for expansion and a case study.",
    "greenredgreen": "Silent adopter / renewal risk. Using axe fine but no relationship. Classic surprise churn.",
    "redgreengreen": "Shelfware with a smile. Champion likes us but product isn't landing. Re-onboard.",
    "greengreenred": "Engaged and struggling. Product/IGT friction — escalate to engineering, not CS.",
    "redredred": "Write the save plan. Or the eulogy.",
    "redgreenred": "Champion is loyal but can't drive usage. Usually an org/change-management problem.",
  };
  return interpretations[key] || "";
}

function computeOverall(signals: HealthSignal[]): Signal {
  if (signals.length === 0) return "yellow";
  const reds = signals.filter((s) => s.signal === "red").length;
  const yellows = signals.filter((s) => s.signal === "yellow").length;
  if (reds >= 2 || (reds >= 1 && signals.length <= 2)) return "red";
  if (reds === 1 || yellows >= 2) return "yellow";
  return "green";
}

// Compute trend: higher is better (for adoption) or higher is worse (for support)
function computeTrend(current: number, previous: number, higherIsBetter: boolean = true, threshold: number = 0.15, minPrevious: number = 3): Trend {
  if (previous < minPrevious && current < minPrevious) return null; // not enough data
  if (previous === 0 && current > 0) return higherIsBetter ? "improving" : "worsening";
  if (previous === 0) return "flat";
  const pctChange = (current - previous) / previous;
  if (Math.abs(pctChange) < threshold) return "flat";
  if (pctChange > 0) return higherIsBetter ? "improving" : "worsening";
  return higherIsBetter ? "worsening" : "improving";
}

function formatTrendDetail(label: string, current: number, previous: number): string {
  if (previous === 0 && current === 0) return "";
  const pctChange = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
  const arrow = pctChange > 0 ? "+" : "";
  return `${label}: ${previous}\u2192${current} (${arrow}${pctChange}%)`;
}

function computeDimensionTrend(signals: HealthSignal[]): Trend {
  const trends = signals.map((s) => s.trend).filter((t): t is Trend => t !== null && t !== undefined);
  if (trends.length === 0) return null;
  const worsening = trends.filter((t) => t === "worsening").length;
  const improving = trends.filter((t) => t === "improving").length;
  if (worsening > improving) return "worsening";
  if (improving > worsening) return "improving";
  return "flat";
}

export function createHealthRoutes(db: IDatabaseService, salesforce: SalesforceService): Router {
  const router = Router();

  // GET /api/health/:identifier — single account (accepts SF Account ID or account name)
  router.get("/:identifier", async (req: Request, res: Response) => {
    const { identifier } = req.params;
    const cacheKey = `health:${identifier.toLowerCase()}`;
    const cached = salesforceCache.get<HealthScoreResponse>(cacheKey);
    if (cached) {
      res.set("Cache-Control", "public, max-age=300");
      return res.json(cached);
    }

    try {
      // Detect if identifier is an SF Account ID (starts with 001) or account name
      const isSfId = identifier.startsWith("001");
      const result = isSfId
        ? await computeHealthScoreById(identifier, db, salesforce)
        : await computeHealthScore(identifier, db, salesforce);
      salesforceCache.set(cacheKey, result, HEALTH_CACHE_TTL);
      res.set("Cache-Control", "public, max-age=300");
      res.json(result);
    } catch (error) {
      console.error(`Error computing health score for ${identifier}:`, error);
      res.status(500).json({ error: "Failed to compute health score" });
    }
  });

  // POST /api/health/batch — multiple accounts in one call
  // Body: { accountNames: string[] }
  router.post("/batch", async (req: Request, res: Response) => {
    const { accountNames } = req.body;
    if (!Array.isArray(accountNames) || accountNames.length === 0) {
      return res.status(400).json({ error: "accountNames array required" });
    }

    // Check cache first, collect misses
    const results: Record<string, HealthScoreResponse> = {};
    const misses: string[] = [];

    for (const name of accountNames) {
      const cached = salesforceCache.get<HealthScoreResponse>(`health:${name.toLowerCase()}`);
      if (cached) {
        results[name] = cached;
      } else {
        misses.push(name);
      }
    }

    if (misses.length > 0) {
      try {
        // Bulk fetch from Salesforce — 3 queries total instead of 3 per account
        const batchResults = await computeHealthScoresBatch(misses, db, salesforce);
        for (const [name, score] of Object.entries(batchResults)) {
          salesforceCache.set(`health:${name.toLowerCase()}`, score, HEALTH_CACHE_TTL);
          results[name] = score;
        }
      } catch (error) {
        console.error("Error computing batch health scores:", error);
      }
    }

    res.set("Cache-Control", "public, max-age=300");
    res.json({ scores: results });
  });

  return router;
}

// ─── Single account by name (legacy fallback) ────────────────────────────────

async function computeHealthScore(
  accountName: string,
  db: IDatabaseService,
  salesforce: SalesforceService
): Promise<HealthScoreResponse> {
  const escapedName = accountName.replace(/'/g, "\\'");

  const [accountData, contactRoles, subscriptions, orgTicketData] = await Promise.all([
    salesforce.query<any>(`
      SELECT Id, Name, CS_Health__c, CS_Health_Description__c, CS_Risk_Drivers__c,
             Last_contact_date__c, Last_Meeting_Date__c, Last_Email_Date__c,
             AnnualRevenue, Date_of_first_order__c, Date_of_First_Software_Purchase__c
      FROM Account WHERE Name = '${escapedName}' LIMIT 1
    `).catch(() => []),
    salesforce.query<any>(`
      SELECT ContactId, Role, Contact.Name, Contact.Email
      FROM AccountContactRole WHERE Account.Name = '${escapedName}'
    `).catch(() => []),
    salesforce.getEnterpriseSubscriptionsByAccountName(accountName).catch(() => []),
    getTicketDataForAccount(accountName, db),
  ]);

  return buildHealthResponse(accountName, accountData[0], contactRoles, subscriptions, orgTicketData);
}

// ─── Single account by SF Account ID (preferred) ─────────────────────────────

async function computeHealthScoreById(
  accountId: string,
  db: IDatabaseService,
  salesforce: SalesforceService
): Promise<HealthScoreResponse> {
  const [accountData, contactRoles, subscriptions, orgTicketData] = await Promise.all([
    salesforce.query<any>(`
      SELECT Id, Name, CS_Health__c, CS_Health_Description__c, CS_Risk_Drivers__c,
             Last_contact_date__c, Last_Meeting_Date__c, Last_Email_Date__c,
             AnnualRevenue, Date_of_first_order__c, Date_of_First_Software_Purchase__c
      FROM Account WHERE Id = '${accountId}' LIMIT 1
    `).catch(() => []),
    salesforce.query<any>(`
      SELECT ContactId, Role, Contact.Name, Contact.Email
      FROM AccountContactRole WHERE AccountId = '${accountId}'
    `).catch(() => []),
    salesforce.getEnterpriseSubscriptionsByAccountId(accountId).catch(() => []),
    getTicketDataForAccountById(accountId, db),
  ]);

  const accountName = accountData[0]?.Name || accountId;
  return buildHealthResponse(accountName, accountData[0], contactRoles, subscriptions, orgTicketData);
}

// ─── Batch: bulk SF queries, then score each ──────────────────────────────────

async function computeHealthScoresBatch(
  accountNames: string[],
  db: IDatabaseService,
  salesforce: SalesforceService
): Promise<Record<string, HealthScoreResponse>> {
  // Build SOQL IN clause (escape quotes)
  const nameList = accountNames.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");

  // 3 bulk SF queries instead of 3 × N
  const [allAccounts, allContactRoles, allSubscriptions] = await Promise.all([
    salesforce.query<any>(`
      SELECT Id, Name, CS_Health__c, CS_Health_Description__c, CS_Risk_Drivers__c,
             Last_contact_date__c, Last_Meeting_Date__c, Last_Email_Date__c,
             AnnualRevenue, Date_of_first_order__c, Date_of_First_Software_Purchase__c
      FROM Account WHERE Name IN (${nameList})
    `).catch(() => [] as any[]),
    salesforce.query<any>(`
      SELECT ContactId, Role, Contact.Name, Contact.Email, Account.Name
      FROM AccountContactRole WHERE Account.Name IN (${nameList})
    `).catch(() => [] as any[]),
    // Subscriptions don't have a bulk IN query on account name, so batch by accountId
    (async () => {
      // Get account IDs from the first query result, then bulk fetch subscriptions
      // For now, use parallel individual fetches (still faster than sequential)
      const subs = await Promise.all(
        accountNames.map((name) =>
          salesforce.getEnterpriseSubscriptionsByAccountName(name)
            .then((s) => ({ name, subscriptions: s }))
            .catch(() => ({ name, subscriptions: [] as any[] }))
        )
      );
      return subs;
    })(),
  ]);

  // Index data by account name
  const accountMap = new Map<string, any>();
  for (const a of allAccounts) {
    accountMap.set(a.Name, a);
  }

  const contactRoleMap = new Map<string, any[]>();
  for (const cr of allContactRoles) {
    const name = cr.Account?.Name;
    if (name) {
      const existing = contactRoleMap.get(name) || [];
      existing.push(cr);
      contactRoleMap.set(name, existing);
    }
  }

  const subsMap = new Map<string, any[]>();
  for (const s of allSubscriptions) {
    subsMap.set(s.name, s.subscriptions);
  }

  // Fetch ticket data in parallel for all accounts
  const ticketResults = await Promise.all(
    accountNames.map((name) =>
      getTicketDataForAccount(name, db).then((data) => ({ name, data }))
    )
  );
  const ticketMap = new Map<string, OrgTicketData>();
  for (const t of ticketResults) {
    ticketMap.set(t.name, t.data);
  }

  // Build scores
  const results: Record<string, HealthScoreResponse> = {};
  for (const name of accountNames) {
    const account = accountMap.get(name) || {};
    const contactRoles = contactRoleMap.get(name) || [];
    const subscriptions = subsMap.get(name) || [];
    const ticketData = ticketMap.get(name) || { tickets: [], escalationCount: 0 };

    results[name] = buildHealthResponse(name, account, contactRoles, subscriptions, ticketData);
  }

  return results;
}

// ─── Shared scoring logic ─────────────────────────────────────────────────────

function buildHealthResponse(
  accountName: string,
  account: any,
  contactRoles: any[],
  subscriptions: any[],
  orgTicketData: OrgTicketData
): HealthScoreResponse {
  const adoptionSignals = computeAdoptionSignals(subscriptions);
  const engagementSignals = computeEngagementSignals(account || {}, contactRoles);
  const supportSignals = computeSupportSignals(orgTicketData, adoptionSignals);

  const adoption: DimensionScore = { signal: computeOverall(adoptionSignals), signals: adoptionSignals, trend: computeDimensionTrend(adoptionSignals) };
  const engagement: DimensionScore = { signal: computeOverall(engagementSignals), signals: engagementSignals, trend: computeDimensionTrend(engagementSignals) };
  const support: DimensionScore = { signal: computeOverall(supportSignals), signals: supportSignals, trend: computeDimensionTrend(supportSignals) };

  return {
    accountName,
    accountId: account?.Id,
    adoption,
    engagement,
    support,
    manualHealthScore: account?.CS_Health__c || undefined,
    manualHealthDescription: account?.CS_Health_Description__c || undefined,
    riskDrivers: account?.CS_Risk_Drivers__c || undefined,
    interpretation: getInterpretation(adoption.signal, engagement.signal, support.signal),
  };
}

// ─── Adoption ─────────────────────────────────────────────────────────────────

function computeAdoptionSignals(subscriptions: any[]): HealthSignal[] {
  const signals: HealthSignal[] = [];

  if (subscriptions.length === 0) {
    signals.push({ signal: "red", label: "Seat Activation", detail: "No active subscriptions found" });
    return signals;
  }

  // Product display names for health signals
  const PRODUCT_LABELS: Record<string, string> = {
    "axe-devtools-pro": "DevTools Pro",
    "axe-devtools-html": "DevTools HTML",
    "axe-devtools-watcher": "DevTools Watcher",
    "axe-devtools-mobile": "DevTools Mobile",
    "axe-devtools-cli": "DevTools CLI",
    "axe-devtools-reporter": "DevTools Reporter",
    "deque-university": "Deque University",
    "dequeu": "Deque University",
    "axe-assistant-slack": "Axe Assistant (Slack)",
    "axe-assistant-teams": "Axe Assistant (Teams)",
  };
  // Products that don't use seats — excluded from seat activation
  const NON_SEAT_PRODUCTS = new Set(["axe-monitor", "axe-monitor-pro", "axe-devtools-linter"]);

  // Show seat activation per product individually
  for (const sub of subscriptions) {
    const pt = (sub.productType || "").toLowerCase();
    if (NON_SEAT_PRODUCTS.has(pt)) continue;
    if (!sub.licenseCount || sub.licenseCount <= 0) continue;

    const pct = Math.round(((sub.assignedSeats || 0) / sub.licenseCount) * 100);
    const label = PRODUCT_LABELS[pt] || sub.productType || pt;
    let signal: Signal = "green";
    if (pct < 40) signal = "red";
    else if (pct < 70) signal = "yellow";
    signals.push({ signal, label: `${label} Seats`, detail: `${pct}% (${sub.assignedSeats || 0}/${sub.licenseCount})` });
  }

  const productTypes = new Set(subscriptions.map((s: any) => s.productType?.toLowerCase()));
  const productCount = productTypes.size;
  let breadthSignal: Signal = "green";
  if (productCount <= 1) breadthSignal = "red";
  else if (productCount === 2) breadthSignal = "yellow";
  signals.push({ signal: breadthSignal, label: "Product Breadth", detail: `${productCount} product${productCount !== 1 ? "s" : ""} licensed` });

  return signals;
}

// ─── Engagement ───────────────────────────────────────────────────────────────

function computeEngagementSignals(account: any, contactRoles: any[]): HealthSignal[] {
  const signals: HealthSignal[] = [];

  const hasExecSponsor = contactRoles.some((r: any) => r.Role === "Executive Sponsor");
  signals.push({
    signal: hasExecSponsor ? "green" : "red",
    label: "Executive Sponsor",
    detail: hasExecSponsor
      ? contactRoles.find((r: any) => r.Role === "Executive Sponsor")?.Contact?.Name || "Identified"
      : "No exec sponsor identified",
  });

  const distinctContacts = new Set(contactRoles.map((r: any) => r.ContactId)).size;
  const distinctRoles = new Set(contactRoles.map((r: any) => r.Role)).size;
  let stakeholderSignal: Signal = "green";
  if (distinctContacts <= 1) stakeholderSignal = "red";
  else if (distinctContacts === 2 || distinctRoles < 2) stakeholderSignal = "yellow";
  signals.push({ signal: stakeholderSignal, label: "Stakeholder Breadth", detail: `${distinctContacts} contact${distinctContacts !== 1 ? "s" : ""}, ${distinctRoles} role${distinctRoles !== 1 ? "s" : ""}` });

  const lastContact = account.Last_contact_date__c || account.Last_Meeting_Date__c || account.Last_Email_Date__c;
  if (lastContact) {
    const daysSince = Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24));
    let contactSignal: Signal = "green";
    if (daysSince > 90) contactSignal = "red";
    else if (daysSince > 30) contactSignal = "yellow";
    signals.push({ signal: contactSignal, label: "Last Contact", detail: `${daysSince} days ago` });
  } else {
    signals.push({ signal: "red", label: "Last Contact", detail: "No contact recorded" });
  }

  return signals;
}

// ─── Support ──────────────────────────────────────────────────────────────────

interface OrgTicketData {
  tickets: any[];
  escalationCount: number;
}

function computeSupportSignals(ticketData: OrgTicketData, adoptionSignals: HealthSignal[]): HealthSignal[] {
  const signals: HealthSignal[] = [];
  const { tickets, escalationCount } = ticketData;

  if (tickets.length === 0) {
    const lowAdoption = adoptionSignals.some((s) => s.signal === "red");
    signals.push({
      signal: lowAdoption ? "red" : "yellow",
      label: "Ticket Volume",
      detail: lowAdoption ? "Zero tickets with low adoption — possible abandonment" : "No tickets (may indicate self-sufficient usage)",
    });
    return signals;
  }

  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const oneEightyDaysAgo = now - 180 * 24 * 60 * 60 * 1000;

  const currentWindow = tickets.filter((t: any) => new Date(t.created_at).getTime() > ninetyDaysAgo);
  const previousWindow = tickets.filter((t: any) => {
    const ts = new Date(t.created_at).getTime();
    return ts > oneEightyDaysAgo && ts <= ninetyDaysAgo;
  });

  const sevWeights: Record<string, number> = { urgent: 5, high: 2, normal: 1, low: 0.5 };
  const calcWeighted = (tix: any[]) => tix.reduce((sum: number, t: any) => sum + (sevWeights[t.priority] || 1), 0);

  const currentWeighted = calcWeighted(currentWindow);
  const previousWeighted = calcWeighted(previousWindow);

  let volumeSignal: Signal = "green";
  if (currentWeighted > 50) volumeSignal = "red";
  else if (currentWeighted > 20) volumeSignal = "yellow";
  const volumeTrend = computeTrend(currentWeighted, previousWeighted, false); // higher is worse
  signals.push({
    signal: volumeSignal,
    label: "Ticket Volume (90d)",
    detail: `${currentWindow.length} tickets, weighted score: ${Math.round(currentWeighted)}`,
    trend: volumeTrend,
    trendDetail: formatTrendDetail("Weighted volume", Math.round(currentWeighted), Math.round(previousWeighted)),
  });

  // Escalations — compare current vs previous window
  const currentEsc = currentWindow.filter((t: any) => t.is_escalated).length;
  const previousEsc = previousWindow.filter((t: any) => t.is_escalated).length;
  let escSignal: Signal = "green";
  if (currentEsc >= 4) escSignal = "red";
  else if (currentEsc >= 2) escSignal = "yellow";
  const escTrend = computeTrend(currentEsc, previousEsc, false, 0.15, 1);
  signals.push({
    signal: escSignal,
    label: "Escalations",
    detail: `${currentEsc} escalated ticket${currentEsc !== 1 ? "s" : ""} (last 90d)`,
    trend: escTrend,
    trendDetail: formatTrendDetail("Escalations", currentEsc, previousEsc),
  });

  // Bug:how-to ratio — compare windows
  const currentBugs = currentWindow.filter((t: any) => t.ticket_type === "bug" || t.ticket_type === "incident").length;
  const previousBugs = previousWindow.filter((t: any) => t.ticket_type === "bug" || t.ticket_type === "incident").length;
  const currentHowTo = currentWindow.filter((t: any) => t.ticket_type === "question" || t.ticket_type === "how_to").length;

  if (currentWindow.length >= 5) {
    const currentBugRatio = currentBugs / currentWindow.length;
    const previousBugRatio = previousWindow.length >= 5 ? previousBugs / previousWindow.length : null;
    let ratioSignal: Signal = "green";
    if (currentBugRatio > 0.6) ratioSignal = "red";
    else if (currentBugRatio > 0.4) ratioSignal = "yellow";

    let ratioTrend: Trend = null;
    let ratioTrendDetail = "";
    if (previousBugRatio !== null) {
      const diff = currentBugRatio - previousBugRatio;
      if (Math.abs(diff) < 0.05) ratioTrend = "flat";
      else if (diff > 0) ratioTrend = "worsening"; // more bugs = worse
      else ratioTrend = "improving";
      ratioTrendDetail = `Bug ratio: ${Math.round(previousBugRatio * 100)}%\u2192${Math.round(currentBugRatio * 100)}%`;
    }

    signals.push({
      signal: ratioSignal,
      label: "Bug:How-to Ratio",
      detail: `${currentBugs} bugs, ${currentHowTo} how-to (${Math.round(currentBugRatio * 100)}% bugs)`,
      trend: ratioTrend,
      trendDetail: ratioTrendDetail,
    });
  }

  return signals;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getTicketDataForAccount(accountName: string, db: IDatabaseService): Promise<OrgTicketData> {
  try {
    const allOrgs = await db.getOrganizations();
    const matchingOrgs = allOrgs.filter(
      (o) => o.salesforce_account_name?.toLowerCase() === accountName.toLowerCase() || o.name.toLowerCase() === accountName.toLowerCase()
    );
    return aggregateTicketData(matchingOrgs, db);
  } catch {
    return { tickets: [], escalationCount: 0 };
  }
}

async function getTicketDataForAccountById(accountId: string, db: IDatabaseService): Promise<OrgTicketData> {
  try {
    const allOrgs = await db.getOrganizations();
    // Match by SF ID (15 or 18 char) stored in the org's salesforce_id field
    const accountId15 = accountId.substring(0, 15);
    const matchingOrgs = allOrgs.filter(
      (o) => o.salesforce_id === accountId || o.salesforce_id === accountId15
    );
    return aggregateTicketData(matchingOrgs, db);
  } catch {
    return { tickets: [], escalationCount: 0 };
  }
}

async function aggregateTicketData(orgs: any[], db: IDatabaseService): Promise<OrgTicketData> {
  if (orgs.length === 0) return { tickets: [], escalationCount: 0 };
  let allTickets: any[] = [];
  let totalEscalations = 0;
  for (const org of orgs) {
    const [tickets, escalations] = await Promise.all([
      db.getTicketsByOrganization(org.id),
      db.getEscalationCount(org.id),
    ]);
    allTickets = allTickets.concat(tickets);
    totalEscalations += escalations;
  }
  return { tickets: allTickets, escalationCount: totalEscalations };
}
