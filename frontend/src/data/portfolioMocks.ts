// Mock data for the new SF-source-of-truth portfolio view.
//
// Design principle: every account that appears here comes from Salesforce
// (assignments on the Account or on Product_Success__c). Downstream data
// (Zendesk org, Amplitude usage, Kantata projects, renewals) is JOINED in —
// missing joins surface as explicit empty states, NEVER cause the account
// to disappear.
//
// The mock includes deliberately patchy coverage so the wireframe shows
// each empty-state variant + a churned account for the revival workflow.

export type Role = "csm" | "pm" | "prs" | "tsa" | "ie" | "admin";

// (Account lifecycle state is no longer a stored flag — see getRenewalState which
// derives "active" / "churned" / "none" from the open + past closed-won opps.)

// Product families that count toward "this account had a real renewal stream":
//   - "Deque University" — DQU subscriptions
//   - "Product"          — the Axe product suite (DevTools, Monitor, etc.)
// Closed-won opps with other product families (Services, Training, etc.) do not
// trigger Renewals tab visibility or churn classification.
export const RENEWAL_RELEVANT_PRODUCT_FAMILIES = ["Deque University", "Product"] as const;
export type RenewalProductFamily = typeof RENEWAL_RELEVANT_PRODUCT_FAMILIES[number] | string;

// Closed-won opportunity record (used to compute renewal/churn state).
export interface ClosedWonOpp {
  id: string;
  name: string;
  closedDate: string;          // ISO yyyy-mm-dd
  amount: number;
  productFamily: RenewalProductFamily;
  productName: string;
}

// Derived renewal state for an account — drives the Renewals tab visibility and content.
//   - "active"  : an open opp exists; show full active-renewal tab
//   - "churned" : no open opp BUT there's a past closed-won with a relevant product
//                 family — show as churned for revival workflow
//   - "none"    : no open opp and no past closed-won with relevant family — hide tab
export type RenewalState = "active" | "overdue" | "churned" | "none";

export interface HealthSignal {
  name: string;
  currentValue: string;
  status: "green" | "yellow" | "red";
  trend?: "up" | "down" | "flat";
  thresholds: string;
}

export interface HealthDimension {
  status: "green" | "yellow" | "red" | null; // null = no data
  signals: HealthSignal[];
  // Plain-English description of how this dimension is calculated.
  calculationLogic: string;
}

export interface HealthScore {
  adoption: HealthDimension;
  engagement: HealthDimension;
  support: HealthDimension;
  // Manual override entered in Salesforce, if any.
  manual?: { status: "good" | "ok" | "at-risk"; note: string };
}

export interface MockSFAccount {
  id: string;
  name: string;
  parentId: string | null;
  // Role assignments on this account (denormalized from Account + Product_Success__c)
  csmEmail: string | null;
  prsEmail: string | null;
  tsaEmail: string | null;
  ieEmail: string | null;
  // Active renewal opportunity (null = no open opp)
  upcomingRenewalDate: string | null;
  upcomingRenewalAmount: number | null;
  renewalStage: string | null;
  // Past closed-won renewal opportunities. Used to determine whether the
  // Renewals tab should appear at all (only relevant product families count)
  // and whether the account is "churned" (had relevant past, no active).
  closedWonOpps: ClosedWonOpp[];
  // Display names for role owners (for admin grouping headers).
  csmName?: string;
  tsaName?: string;
}

// Pure function — derive renewal state from the data, don't store it.
//   active  : has an OPEN renewal opp with date in the future
//   overdue : has an OPEN renewal opp whose date has already passed (the
//             account hasn't closed-won or closed-lost yet — someone needs
//             to chase it). The backend's fetchOpenRenewals filters out
//             closed stages already, so any opp surfacing here is still
//             open.
//   churned : no open renewal AND at least one past Closed Won in a
//             renewal-relevant product family
//   none    : no renewal history at all
export function getRenewalState(account: MockSFAccount): RenewalState {
  if (account.upcomingRenewalDate) {
    const today = new Date().toISOString().slice(0, 10);
    return account.upcomingRenewalDate < today ? "overdue" : "active";
  }
  const relevant = account.closedWonOpps.filter((o) =>
    (RENEWAL_RELEVANT_PRODUCT_FAMILIES as readonly string[]).includes(o.productFamily)
  );
  return relevant.length > 0 ? "churned" : "none";
}

// Convenience for the UI: most recent relevant closed-won (for churn display).
export function getLastRelevantClosedWon(account: MockSFAccount): ClosedWonOpp | null {
  const relevant = account.closedWonOpps
    .filter((o) => (RENEWAL_RELEVANT_PRODUCT_FAMILIES as readonly string[]).includes(o.productFamily))
    .sort((a, b) => b.closedDate.localeCompare(a.closedDate));
  return relevant[0] || null;
}

export interface MockJoinedData {
  zendeskOrgIds: number[] | null;
  zendeskOpenTickets: number;
  zendeskOpen90d: number;
  amplitudeActiveUsers90d: number | null;
  amplitudeTotalUsersInSF: number | null;
  kantataProjects: Array<{ id: string; name: string; status: string; eta: string | null; category: string }> | null;
  healthScore: HealthScore | null;
  // SUM(Subscription_Total__c) across active paid subs for this account.
  // null when SF didn't return data; 0 when the account exists but has no
  // active paid subscriptions.
  subscriptionArr?: number | null;
}

export interface MockPortfolioAccount extends MockSFAccount {
  joined: MockJoinedData;
  children?: MockPortfolioAccount[];
}

// Convenience: known user emails for role-scoped views
export const MOCK_USERS = {
  csm: "mark.washburn@deque.com",
  prs: "prs.tester@deque.com",
  tsa: "tsa.tester@deque.com",
  ie: "ie.tester@deque.com",
  admin: "preety.kumar@deque.com",
};

// Additional owners (so admin grouping has more than one entry per role).
const SECOND_CSM = { email: "john.piotrowski@deque.com", name: "John Piotrowski" };
const SECOND_TSA = { email: "second.tsa@deque.com", name: "Sara Architect" };

const PRIMARY_NAMES = {
  csm: "Mark Washburn",
  tsa: "Test TSA",
};

// Reusable health detail factories ─────────────────────────────────────────
function healthAdoption(seats: number, total: number, breadth: number): HealthDimension {
  const pct = total > 0 ? Math.round((seats / total) * 100) : 0;
  const seatStatus: "green" | "yellow" | "red" =
    pct >= 70 ? "green" : pct >= 40 ? "yellow" : "red";
  const breadthStatus: "green" | "yellow" | "red" =
    breadth >= 3 ? "green" : breadth === 2 ? "yellow" : "red";
  return {
    status: seatStatus === "red" || breadthStatus === "red" ? "red" : seatStatus === "yellow" || breadthStatus === "yellow" ? "yellow" : "green",
    calculationLogic:
      "Combines seat-utilization across licensed products (assigned/licensed %) with product breadth (count of paid products in use). Status is the worse of the two signals.",
    signals: [
      { name: "Seat utilization", currentValue: `${pct}% (${seats}/${total})`, status: seatStatus, thresholds: "≥70% / 40–70% / <40%" },
      { name: "Product breadth", currentValue: `${breadth} products`, status: breadthStatus, thresholds: "3+ / 2 / 0–1" },
    ],
  };
}

function healthEngagement(execSponsor: boolean, stakeholders: number, daysSinceContact: number): HealthDimension {
  const sponsorStatus: "green" | "red" = execSponsor ? "green" : "red";
  const stakeholderStatus: "green" | "yellow" | "red" =
    stakeholders >= 3 ? "green" : stakeholders === 2 ? "yellow" : "red";
  const contactStatus: "green" | "yellow" | "red" =
    daysSinceContact < 30 ? "green" : daysSinceContact < 90 ? "yellow" : "red";
  const overall: "green" | "yellow" | "red" =
    sponsorStatus === "red" || contactStatus === "red" || stakeholderStatus === "red"
      ? "red"
      : stakeholderStatus === "yellow" || contactStatus === "yellow"
        ? "yellow"
        : "green";
  return {
    status: overall,
    calculationLogic:
      "Three signals: exec sponsor named in Salesforce, number of distinct stakeholder contacts, and recency of last contact. Any red signal makes the dimension red.",
    signals: [
      { name: "Exec sponsor", currentValue: execSponsor ? "Named in Salesforce" : "Not identified", status: sponsorStatus, thresholds: "Named / — / Not identified" },
      { name: "Stakeholder breadth", currentValue: `${stakeholders} contacts`, status: stakeholderStatus, thresholds: "3+ / 2 / 0–1" },
      { name: "Last contact", currentValue: `${daysSinceContact} days ago`, status: contactStatus, thresholds: "<30 / 30–90 / >90" },
    ],
  };
}

function healthSupport(weighted: number, escalations: number, bugPct: number): HealthDimension {
  const volStatus: "green" | "yellow" | "red" =
    weighted < 20 ? "green" : weighted <= 50 ? "yellow" : "red";
  const escStatus: "green" | "yellow" | "red" =
    escalations <= 1 ? "green" : escalations <= 3 ? "yellow" : "red";
  const bugStatus: "green" | "yellow" | "red" =
    bugPct < 40 ? "green" : bugPct <= 60 ? "yellow" : "red";
  const overall: "green" | "yellow" | "red" =
    volStatus === "red" || escStatus === "red" || bugStatus === "red" ? "red"
      : volStatus === "yellow" || escStatus === "yellow" || bugStatus === "yellow" ? "yellow"
        : "green";
  return {
    status: overall,
    calculationLogic:
      "Weighted ticket volume (P1×5 + P2×3 + P3×1) over last 90 days, escalation count, and bug-to-how-to ratio. Worst signal sets the dimension status.",
    signals: [
      { name: "Ticket volume (90d)", currentValue: `weighted score: ${weighted}`, status: volStatus, thresholds: "<20 / 20–50 / >50" },
      { name: "Escalations", currentValue: `${escalations} escalated (90d)`, status: escStatus, thresholds: "0–1 / 2–3 / 4+" },
      { name: "Bug:How-to ratio", currentValue: `${bugPct}% bugs`, status: bugStatus, thresholds: "<40% / 40–60% / >60%" },
    ],
  };
}

// Helper builders for closed-won opp fixtures.
function cw(id: string, date: string, amount: number, family: string, name: string): ClosedWonOpp {
  return { id, closedDate: date, amount, productFamily: family, productName: name, name };
}

// Flat SF account list. Renewal-tab visibility is derived from
// (upcomingRenewalDate) OR (closedWonOpps with relevant productFamily).
const ALL_ACCOUNTS: MockSFAccount[] = [
  // ── Adobe family: active renewals ────────────────────────────────────────────
  {
    id: "001ADOBE000000001",
    name: "Adobe Inc",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: MOCK_USERS.tsa,
    tsaName: PRIMARY_NAMES.tsa,
    ieEmail: MOCK_USERS.ie,
    upcomingRenewalDate: "2026-09-15",
    upcomingRenewalAmount: 850000,
    renewalStage: "4 - Negotiation",
    closedWonOpps: [cw("o-adobe-2025", "2025-09-15", 720000, "Product", "Adobe — Renewal FY25")],
  },
  {
    id: "001ADOBE000000002",
    name: "Adobe Behance Team",
    parentId: "001ADOBE000000001",
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: null,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [], // no past relevant opp → no Renewals tab
  },
  {
    id: "001ADOBE000000003",
    name: "Adobe Document Cloud",
    parentId: "001ADOBE000000001",
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: null,
    ieEmail: MOCK_USERS.ie,
    upcomingRenewalDate: "2027-01-10",
    upcomingRenewalAmount: 120000,
    renewalStage: "2 - Proposal",
    closedWonOpps: [cw("o-adobe-dc-2026", "2026-01-10", 95000, "Deque University", "Adobe DC — DQU FY26")],
  },

  // ── ADP family ───────────────────────────────────────────────────────────────
  {
    id: "001ADP00000000001",
    name: "ADP Inc",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: MOCK_USERS.tsa,
    tsaName: PRIMARY_NAMES.tsa,
    ieEmail: MOCK_USERS.ie,
    upcomingRenewalDate: "2026-06-30",
    upcomingRenewalAmount: 1200000,
    renewalStage: "3 - Quote Sent",
    closedWonOpps: [cw("o-adp-2025", "2025-06-30", 1000000, "Product", "ADP — Renewal FY25")],
  },
  {
    id: "001ADP00000000002",
    name: "ADP-WFN",
    parentId: "001ADP00000000001",
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: null,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [],
  },

  // ── IHG standalone ───────────────────────────────────────────────────────────
  {
    id: "001IHG0000000001",
    name: "InterContinental Hotels Group",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: "2026-08-01",
    upcomingRenewalAmount: 240000,
    renewalStage: "5 - Verbal Commit",
    closedWonOpps: [cw("o-ihg-2025", "2025-08-01", 220000, "Product", "IHG — Renewal FY25")],
  },

  // ── Paragon: no Zendesk match, has active renewal ────────────────────────────
  {
    id: "001PARAGON000001",
    name: "Paragon Application Systems",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: null,
    tsaEmail: MOCK_USERS.tsa,
    tsaName: PRIMARY_NAMES.tsa,
    ieEmail: null,
    upcomingRenewalDate: "2026-12-15",
    upcomingRenewalAmount: 45000,
    renewalStage: "1 - Discovery",
    closedWonOpps: [],
  },

  // ── Cold Account: no opps at all → Renewals tab hidden ──────────────────────
  {
    id: "001COLD000000001",
    name: "Cold Account Inc",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: null,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [], // no past closed-won → no Renewals tab at all
  },

  // ── Services-Only Co: past closed-won but family is "Services" (not relevant) →
  //    Renewals tab still HIDDEN. Demonstrates the product-family gate.
  {
    id: "001SERVONLY00001",
    name: "Services-Only Co",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: null,
    tsaEmail: MOCK_USERS.tsa,
    tsaName: PRIMARY_NAMES.tsa,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [
      cw("o-serv-2025", "2025-04-15", 25000, "Services", "Services-Only — VPAT consulting"),
    ],
  },

  // ── CHURNED account (relevant product family in past, no active opp) ────────
  // Renewals tab WILL appear (showing churn + revival prompt) per the new rule.
  {
    id: "001CHURNED000001",
    name: "Yellow Pages Co",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [
      cw("o-yp-2025", "2025-02-28", 180000, "Product", "Yellow Pages — Renewal FY25"),
      cw("o-yp-2024", "2024-02-28", 165000, "Product", "Yellow Pages — Renewal FY24"),
    ],
  },

  // ── Churned-DQU-only account: past Deque University purchase, no active ─────
  // Tests that "Deque University" alone (without "Product") triggers churn.
  {
    id: "001DQUCHURN00001",
    name: "TrainingFirst Corp",
    parentId: null,
    csmEmail: MOCK_USERS.csm,
    csmName: PRIMARY_NAMES.csm,
    prsEmail: MOCK_USERS.prs,
    tsaEmail: null,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [
      cw("o-tf-2024", "2024-11-30", 32000, "Deque University", "TrainingFirst — DQU FY24"),
    ],
  },

  // ── Second CSM's portfolio ─────────────────────────────────────────────────
  {
    id: "001JPMORGAN00001",
    name: "JPMorgan Chase",
    parentId: null,
    csmEmail: SECOND_CSM.email,
    csmName: SECOND_CSM.name,
    prsEmail: null,
    tsaEmail: MOCK_USERS.tsa,
    tsaName: PRIMARY_NAMES.tsa,
    ieEmail: null,
    upcomingRenewalDate: "2026-10-31",
    upcomingRenewalAmount: 2400000,
    renewalStage: "3 - Quote Sent",
    closedWonOpps: [cw("o-jpm-2025", "2025-10-31", 2100000, "Product", "JPM — Renewal FY25")],
  },
  {
    id: "001CITI000000001",
    name: "Citibank",
    parentId: null,
    csmEmail: SECOND_CSM.email,
    csmName: SECOND_CSM.name,
    prsEmail: null,
    tsaEmail: SECOND_TSA.email,
    tsaName: SECOND_TSA.name,
    ieEmail: null,
    upcomingRenewalDate: "2026-11-15",
    upcomingRenewalAmount: 980000,
    renewalStage: "2 - Proposal",
    closedWonOpps: [cw("o-citi-2025", "2025-11-15", 850000, "Product", "Citi — Renewal FY25")],
  },

  // ── Second TSA-only assignment ──────────────────────────────────────────────
  {
    id: "001OPENAI0000001",
    name: "OpenAI",
    parentId: null,
    csmEmail: null,
    csmName: undefined,
    prsEmail: null,
    tsaEmail: SECOND_TSA.email,
    tsaName: SECOND_TSA.name,
    ieEmail: null,
    upcomingRenewalDate: null,
    upcomingRenewalAmount: null,
    renewalStage: null,
    closedWonOpps: [],
  },
];

// Mock downstream joins
const JOINS: Record<string, MockJoinedData> = {
  "001ADOBE000000001": {
    zendeskOrgIds: [16952753169301],
    zendeskOpenTickets: 7,
    zendeskOpen90d: 23,
    amplitudeActiveUsers90d: 18,
    amplitudeTotalUsersInSF: 634,
    kantataProjects: [
      { id: "k1", name: "Adobe — Pro Rollout Phase 2", status: "On Track", eta: "2026-06-30", category: "Implementation" },
      { id: "k2", name: "Adobe — Linter PoC", status: "At Risk", eta: "2026-05-30", category: "Deployment" },
    ],
    healthScore: {
      adoption: healthAdoption(2400, 4100, 4),
      engagement: healthEngagement(true, 5, 2),
      support: healthSupport(22, 1, 38),
      manual: { status: "ok", note: "TP 05/15/2025: In Year 3 of relationship. Renewal contract for FY2026 in progress." },
    },
  },
  "001ADOBE000000002": {
    zendeskOrgIds: [16952753169302],
    zendeskOpenTickets: 0,
    zendeskOpen90d: 2,
    amplitudeActiveUsers90d: 3,
    amplitudeTotalUsersInSF: 24,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(18, 24, 1),
      engagement: { status: null, signals: [], calculationLogic: "Not enough data to compute engagement for this sub-account." },
      support: healthSupport(2, 0, 0),
    },
  },
  "001ADOBE000000003": {
    zendeskOrgIds: null,
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: 0,
    amplitudeTotalUsersInSF: 88,
    kantataProjects: [
      { id: "k3", name: "Doc Cloud — Consulting engagement", status: "On Track", eta: "2026-07-15", category: "Consulting" },
    ],
    healthScore: {
      adoption: healthAdoption(0, 88, 1),
      engagement: healthEngagement(false, 1, 45),
      support: healthSupport(0, 0, 0),
    },
  },
  "001ADP00000000001": {
    zendeskOrgIds: [16952753170001],
    zendeskOpenTickets: 12,
    zendeskOpen90d: 47,
    amplitudeActiveUsers90d: 154,
    amplitudeTotalUsersInSF: 2167,
    kantataProjects: [
      { id: "k4", name: "ADP — Mobile rollout", status: "On Track", eta: "2026-08-01", category: "Deployment" },
      { id: "k5", name: "ADP — Tool support retainer", status: "On Track", eta: null, category: "Tool Support" },
    ],
    healthScore: {
      adoption: healthAdoption(1850, 2400, 3),
      engagement: healthEngagement(true, 4, 5),
      support: healthSupport(45, 2, 52),
      manual: { status: "good", note: "Mark 04/01: very engaged; mobile rollout going well." },
    },
  },
  "001ADP00000000002": {
    zendeskOrgIds: [16952753170002],
    zendeskOpenTickets: 3,
    zendeskOpen90d: 14,
    amplitudeActiveUsers90d: 42,
    amplitudeTotalUsersInSF: 318,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(280, 318, 2),
      engagement: healthEngagement(true, 3, 12),
      support: healthSupport(8, 0, 21),
    },
  },
  "001IHG0000000001": {
    zendeskOrgIds: [16952753170100],
    zendeskOpenTickets: 2,
    zendeskOpen90d: 9,
    amplitudeActiveUsers90d: 30,
    amplitudeTotalUsersInSF: 11,
    kantataProjects: [
      { id: "k6", name: "IHG — Flexible engagement", status: "On Hold", eta: null, category: "Flexible" },
    ],
    healthScore: {
      adoption: healthAdoption(11, 30, 2),
      engagement: healthEngagement(true, 2, 35),
      support: healthSupport(6, 0, 30),
    },
  },
  "001PARAGON000001": {
    zendeskOrgIds: null,
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: 1,
    amplitudeTotalUsersInSF: 6,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(1, 6, 1),
      engagement: { status: null, signals: [], calculationLogic: "Insufficient SF contact data." },
      support: { status: null, signals: [], calculationLogic: "No Zendesk linkage; cannot evaluate support signal." },
    },
  },
  "001COLD000000001": {
    zendeskOrgIds: [],
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: null,
    amplitudeTotalUsersInSF: null,
    kantataProjects: null,
    healthScore: null,
  },
  // CHURNED — still has historical support + usage to inform revival outreach
  "001CHURNED000001": {
    zendeskOrgIds: [16952753171000],
    zendeskOpenTickets: 0,
    zendeskOpen90d: 1,
    amplitudeActiveUsers90d: 4,    // a few lingering users still active
    amplitudeTotalUsersInSF: 87,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(0, 87, 0),
      engagement: healthEngagement(false, 1, 120),
      support: healthSupport(2, 0, 50),
    },
  },
  "001JPMORGAN00001": {
    zendeskOrgIds: [16952753172000],
    zendeskOpenTickets: 4,
    zendeskOpen90d: 18,
    amplitudeActiveUsers90d: 87,
    amplitudeTotalUsersInSF: 1450,
    kantataProjects: [
      { id: "k7", name: "JPM — Phase 1 deployment", status: "On Track", eta: "2026-07-01", category: "Deployment" },
    ],
    healthScore: {
      adoption: healthAdoption(900, 1450, 3),
      engagement: healthEngagement(true, 5, 7),
      support: healthSupport(18, 0, 45),
    },
  },
  "001CITI000000001": {
    zendeskOrgIds: [16952753173000],
    zendeskOpenTickets: 1,
    zendeskOpen90d: 5,
    amplitudeActiveUsers90d: 32,
    amplitudeTotalUsersInSF: 220,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(180, 220, 2),
      engagement: healthEngagement(true, 3, 14),
      support: healthSupport(4, 0, 25),
    },
  },
  "001OPENAI0000001": {
    zendeskOrgIds: null,
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: null,
    amplitudeTotalUsersInSF: null,
    kantataProjects: [
      { id: "k8", name: "OpenAI — Tool support scoping", status: "On Track", eta: "2026-06-15", category: "Tool Support" },
    ],
    healthScore: null,
  },
  // Services-Only Co: past Services-family closed-won, no relevant renewal stream.
  // Renewals tab will NOT appear for this account.
  "001SERVONLY00001": {
    zendeskOrgIds: [16952753172500],
    zendeskOpenTickets: 0,
    zendeskOpen90d: 1,
    amplitudeActiveUsers90d: 0,
    amplitudeTotalUsersInSF: 3,
    kantataProjects: [
      { id: "k9", name: "VPAT consulting — wrap-up", status: "On Track", eta: "2026-06-01", category: "Consulting" },
    ],
    healthScore: {
      adoption: healthAdoption(0, 3, 0),
      engagement: healthEngagement(false, 2, 60),
      support: healthSupport(1, 0, 0),
    },
  },
  // TrainingFirst Corp: churned via Deque University past purchase.
  // Renewals tab will appear in churned state (no active opp, has relevant past).
  "001DQUCHURN00001": {
    zendeskOrgIds: [16952753173500],
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: 8,
    amplitudeTotalUsersInSF: 42,
    kantataProjects: [],
    healthScore: {
      adoption: healthAdoption(0, 42, 1),
      engagement: healthEngagement(false, 1, 180),
      support: healthSupport(0, 0, 0),
    },
  },
};

/**
 * Returns the accounts assigned to a user under a given role.
 * Builds the parent → child hierarchy from flat SF account data.
 */
export function getMockPortfolio(role: Role, userEmail: string): MockPortfolioAccount[] {
  if (role === "admin") {
    // Admin sees everything; grouping is done in the view layer.
    return buildHierarchy(ALL_ACCOUNTS);
  }

  const assignmentField =
    role === "csm" ? "csmEmail" :
    role === "prs" ? "prsEmail" :
    role === "tsa" ? "tsaEmail" :
    "ieEmail";

  const matches = ALL_ACCOUNTS.filter((a) => a[assignmentField] === userEmail);

  // Pull in parents and siblings so the hierarchy is complete.
  const includedIds = new Set(matches.map((a) => a.id));
  for (const m of matches) {
    if (m.parentId) includedIds.add(m.parentId);
    for (const c of ALL_ACCOUNTS) {
      if (c.parentId === m.id) includedIds.add(c.id);
    }
  }
  const included = ALL_ACCOUNTS.filter((a) => includedIds.has(a.id));
  return buildHierarchy(included);
}

function buildHierarchy(accounts: MockSFAccount[]): MockPortfolioAccount[] {
  const byId = new Map(accounts.map((a) => [a.id, { ...a, joined: JOINS[a.id], children: [] as MockPortfolioAccount[] }]));
  const roots: MockPortfolioAccount[] = [];
  for (const acc of byId.values()) {
    if (acc.parentId && byId.has(acc.parentId)) {
      byId.get(acc.parentId)!.children!.push(acc);
    } else {
      roots.push(acc);
    }
  }
  return roots;
}

/**
 * For admin view: group the full portfolio by owner email under a role dimension.
 * Returns an array of (ownerKey, ownerName, accounts) tuples.
 * Accounts within a group are still hierarchical (parents nest children).
 */
export type OwnerDimension = "csm" | "prs" | "tsa" | "ie";

export function groupPortfolioByOwner(
  portfolio: MockPortfolioAccount[],
  dimension: OwnerDimension
): Array<{ ownerEmail: string | null; ownerName: string; accounts: MockPortfolioAccount[] }> {
  const flatten: MockPortfolioAccount[] = [];
  const collect = (acc: MockPortfolioAccount) => {
    flatten.push(acc);
    acc.children?.forEach(collect);
  };
  portfolio.forEach(collect);

  const groups = new Map<string, { ownerEmail: string | null; ownerName: string; ids: Set<string> }>();
  for (const acc of flatten) {
    const email =
      dimension === "csm" ? acc.csmEmail :
      dimension === "tsa" ? acc.tsaEmail :
      dimension === "prs" ? acc.prsEmail :
      acc.ieEmail;
    const name =
      dimension === "csm" ? (acc.csmName || (email ? email : "Unassigned")) :
      dimension === "tsa" ? (acc.tsaName || (email ? email : "Unassigned")) :
      (email || "Unassigned"); // prs/ie don't have display name fields yet
    const key = email || "__unassigned__";
    if (!groups.has(key)) {
      groups.set(key, { ownerEmail: email, ownerName: name, ids: new Set() });
    }
    groups.get(key)!.ids.add(acc.id);
  }

  return Array.from(groups.values())
    // Skip "unassigned" buckets — they're noise (accounts that don't have this role assigned)
    .filter((g) => g.ownerEmail !== null)
    .map((g) => {
      // Re-hierarchize from the live flattened set, preserving joined data
      // (including any healthScore that has streamed in). buildHierarchy() can't
      // be used here — it's mock-data-specific and overwrites `joined`.
      const byId = new Map<string, MockPortfolioAccount>();
      for (const a of flatten) {
        if (g.ids.has(a.id)) byId.set(a.id, { ...a, children: [] });
      }
      const roots: MockPortfolioAccount[] = [];
      for (const acc of byId.values()) {
        if (acc.parentId && byId.has(acc.parentId)) {
          byId.get(acc.parentId)!.children!.push(acc);
        } else {
          roots.push(acc);
        }
      }
      return { ownerEmail: g.ownerEmail, ownerName: g.ownerName, accounts: roots };
    })
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
}

export function countAccounts(portfolio: MockPortfolioAccount[]): number {
  let n = 0;
  for (const a of portfolio) {
    n += 1 + (a.children?.length || 0);
  }
  return n;
}
