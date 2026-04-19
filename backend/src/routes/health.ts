import { Router, Request, Response } from "express";
import type { IDatabaseService } from "../services/database-interface.js";
import type { SalesforceService } from "../services/salesforce.js";
import { salesforceCache } from "../services/cache.js";

type Signal = "green" | "yellow" | "red";

interface HealthSignal {
  signal: Signal;
  label: string;
  detail?: string;
}

interface DimensionScore {
  signal: Signal;
  signals: HealthSignal[];
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

// Map 3-signal combination to a human-readable interpretation
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

// Compute overall signal from individual signals (worst-of with weighting)
function computeOverall(signals: HealthSignal[]): Signal {
  if (signals.length === 0) return "yellow";
  const reds = signals.filter((s) => s.signal === "red").length;
  const yellows = signals.filter((s) => s.signal === "yellow").length;
  if (reds >= 2 || (reds >= 1 && signals.length <= 2)) return "red";
  if (reds === 1 || yellows >= 2) return "yellow";
  return "green";
}

export function createHealthRoutes(db: IDatabaseService, salesforce: SalesforceService): Router {
  const router = Router();

  // GET /api/health/:accountName
  router.get("/:accountName", async (req: Request, res: Response) => {
    const { accountName } = req.params;
    const cacheKey = `health:${accountName.toLowerCase()}`;
    const cached = salesforceCache.get<HealthScoreResponse>(cacheKey);
    if (cached) return res.json(cached);

    try {
      const result = await computeHealthScore(accountName, db, salesforce);
      salesforceCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error(`Error computing health score for ${accountName}:`, error);
      res.status(500).json({ error: "Failed to compute health score" });
    }
  });

  return router;
}

async function computeHealthScore(
  accountName: string,
  db: IDatabaseService,
  salesforce: SalesforceService
): Promise<HealthScoreResponse> {
  const escapedName = accountName.replace(/'/g, "\\'");

  // Fetch all data in parallel
  const [accountData, contactRoles, subscriptions, orgTicketData] = await Promise.all([
    // 1. Account fields from SF
    salesforce.query<any>(`
      SELECT Id, Name, CS_Health__c, CS_Health_Description__c, CS_Risk_Drivers__c,
             Last_contact_date__c, Last_Meeting_Date__c, Last_Email_Date__c,
             AnnualRevenue, Date_of_first_order__c, Date_of_First_Software_Purchase__c
      FROM Account WHERE Name = '${escapedName}' LIMIT 1
    `).catch(() => []),

    // 2. Contact roles for engagement
    salesforce.query<any>(`
      SELECT ContactId, Role, Contact.Name, Contact.Email
      FROM AccountContactRole
      WHERE Account.Name = '${escapedName}'
    `).catch(() => []),

    // 3. Subscriptions for adoption
    salesforce.getEnterpriseSubscriptionsByAccountName(accountName).catch(() => []),

    // 4. Zendesk ticket data — find org IDs matching this account
    getTicketDataForAccount(accountName, db),
  ]);

  const account = accountData[0] || {};

  // === ADOPTION SCORE ===
  const adoptionSignals = computeAdoptionSignals(subscriptions);

  // === ENGAGEMENT SCORE ===
  const engagementSignals = computeEngagementSignals(account, contactRoles);

  // === SUPPORT SCORE ===
  const supportSignals = computeSupportSignals(orgTicketData, adoptionSignals);

  const adoption: DimensionScore = { signal: computeOverall(adoptionSignals), signals: adoptionSignals };
  const engagement: DimensionScore = { signal: computeOverall(engagementSignals), signals: engagementSignals };
  const support: DimensionScore = { signal: computeOverall(supportSignals), signals: supportSignals };

  return {
    accountName,
    accountId: account.Id,
    adoption,
    engagement,
    support,
    manualHealthScore: account.CS_Health__c || undefined,
    manualHealthDescription: account.CS_Health_Description__c || undefined,
    riskDrivers: account.CS_Risk_Drivers__c || undefined,
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

  // Seat activation %
  const totalLicenses = subscriptions.reduce((sum: number, s: any) => sum + (s.licenseCount || 0), 0);
  const totalAssigned = subscriptions.reduce((sum: number, s: any) => sum + (s.assignedSeats || 0), 0);

  if (totalLicenses > 0) {
    const pct = Math.round((totalAssigned / totalLicenses) * 100);
    let signal: Signal = "green";
    if (pct < 40) signal = "red";
    else if (pct < 70) signal = "yellow";
    signals.push({ signal, label: "Seat Activation", detail: `${pct}% (${totalAssigned}/${totalLicenses})` });
  }

  // Product breadth — count distinct product types
  const productTypes = new Set(subscriptions.map((s: any) => s.productType?.toLowerCase()));
  const productCount = productTypes.size;
  let breadthSignal: Signal = "green";
  if (productCount <= 1) breadthSignal = "red";
  else if (productCount === 2) breadthSignal = "yellow";
  signals.push({
    signal: breadthSignal,
    label: "Product Breadth",
    detail: `${productCount} product${productCount !== 1 ? "s" : ""} licensed`,
  });

  return signals;
}

// ─── Engagement ───────────────────────────────────────────────────────────────

function computeEngagementSignals(account: any, contactRoles: any[]): HealthSignal[] {
  const signals: HealthSignal[] = [];

  // Exec Sponsor
  const hasExecSponsor = contactRoles.some((r: any) => r.Role === "Executive Sponsor");
  signals.push({
    signal: hasExecSponsor ? "green" : "red",
    label: "Executive Sponsor",
    detail: hasExecSponsor
      ? contactRoles.find((r: any) => r.Role === "Executive Sponsor")?.Contact?.Name || "Identified"
      : "No exec sponsor identified",
  });

  // Stakeholder breadth
  const distinctContacts = new Set(contactRoles.map((r: any) => r.ContactId)).size;
  const distinctRoles = new Set(contactRoles.map((r: any) => r.Role)).size;
  let stakeholderSignal: Signal = "green";
  if (distinctContacts <= 1) stakeholderSignal = "red";
  else if (distinctContacts === 2 || distinctRoles < 2) stakeholderSignal = "yellow";
  signals.push({
    signal: stakeholderSignal,
    label: "Stakeholder Breadth",
    detail: `${distinctContacts} contact${distinctContacts !== 1 ? "s" : ""}, ${distinctRoles} role${distinctRoles !== 1 ? "s" : ""}`,
  });

  // Last contact recency
  const lastContact = account.Last_contact_date__c || account.Last_Meeting_Date__c || account.Last_Email_Date__c;
  if (lastContact) {
    const daysSince = Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24));
    let contactSignal: Signal = "green";
    if (daysSince > 90) contactSignal = "red";
    else if (daysSince > 30) contactSignal = "yellow";
    signals.push({
      signal: contactSignal,
      label: "Last Contact",
      detail: `${daysSince} days ago`,
    });
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

  // Zero tickets + low adoption = suspicious silence
  if (tickets.length === 0) {
    const lowAdoption = adoptionSignals.some((s) => s.signal === "red");
    signals.push({
      signal: lowAdoption ? "red" : "yellow",
      label: "Ticket Volume",
      detail: lowAdoption ? "Zero tickets with low adoption — possible abandonment" : "No tickets (may indicate self-sufficient usage)",
    });
    return signals;
  }

  // Sev-weighted volume (last 90 days)
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const recentTickets = tickets.filter((t: any) => new Date(t.created_at).getTime() > ninetyDaysAgo);
  const sevWeights: Record<string, number> = { urgent: 5, high: 2, normal: 1, low: 0.5 };
  const weightedVolume = recentTickets.reduce(
    (sum: number, t: any) => sum + (sevWeights[t.priority] || 1),
    0
  );

  let volumeSignal: Signal = "green";
  if (weightedVolume > 50) volumeSignal = "red";
  else if (weightedVolume > 20) volumeSignal = "yellow";
  signals.push({
    signal: volumeSignal,
    label: "Ticket Volume (90d)",
    detail: `${recentTickets.length} tickets, weighted score: ${Math.round(weightedVolume)}`,
  });

  // Escalations
  let escSignal: Signal = "green";
  if (escalationCount >= 4) escSignal = "red";
  else if (escalationCount >= 2) escSignal = "yellow";
  signals.push({
    signal: escSignal,
    label: "Escalations",
    detail: `${escalationCount} escalated ticket${escalationCount !== 1 ? "s" : ""}`,
  });

  // Bug : how-to ratio
  const bugs = recentTickets.filter((t: any) => t.ticket_type === "bug" || t.ticket_type === "incident").length;
  const howTo = recentTickets.filter((t: any) => t.ticket_type === "question" || t.ticket_type === "how_to").length;
  if (recentTickets.length >= 5) {
    const bugRatio = bugs / recentTickets.length;
    let ratioSignal: Signal = "green";
    if (bugRatio > 0.6) ratioSignal = "red";
    else if (bugRatio > 0.4) ratioSignal = "yellow";
    signals.push({
      signal: ratioSignal,
      label: "Bug:How-to Ratio",
      detail: `${bugs} bugs, ${howTo} how-to (${Math.round(bugRatio * 100)}% bugs)`,
    });
  }

  return signals;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getTicketDataForAccount(
  accountName: string,
  db: IDatabaseService
): Promise<OrgTicketData> {
  try {
    // Find org IDs matching this account name
    const allOrgs = await db.getOrganizations();
    const matchingOrgs = allOrgs.filter(
      (o) =>
        o.salesforce_account_name?.toLowerCase() === accountName.toLowerCase() ||
        o.name.toLowerCase() === accountName.toLowerCase()
    );

    if (matchingOrgs.length === 0) {
      return { tickets: [], escalationCount: 0 };
    }

    // Aggregate tickets across all matching orgs
    let allTickets: any[] = [];
    let totalEscalations = 0;

    for (const org of matchingOrgs) {
      const [tickets, escalations] = await Promise.all([
        db.getTicketsByOrganization(org.id),
        db.getEscalationCount(org.id),
      ]);
      allTickets = allTickets.concat(tickets);
      totalEscalations += escalations;
    }

    return { tickets: allTickets, escalationCount: totalEscalations };
  } catch {
    return { tickets: [], escalationCount: 0 };
  }
}
