// Track B — portfolio enrichment.
// Given a list of SF account IDs, return the joined downstream data shape used
// by the portfolio view. Each data source is fetched in parallel; failure in
// one source returns null for that field on the affected accounts (the empty
// state then surfaces in the UI).
//
// Empty-state distinction:
//   - null         = no link / no source available (UI shows "no-match")
//   - 0 / []       = link exists but no records (UI shows "no-records")
//
// Iteration status:
//   - Zendesk org + ticket counts:  WIRED
//   - SF contact count:             WIRED
//   - Amplitude active users (90d): WIRED (DB-driven via SF Contact join)
//   - Kantata projects:             PAUSED (gated on SF Admin access to opp product codes)
//   - Health score:                 WIRED (composes computeHealthScoresBatch)

import type { IDatabaseService } from "./database-interface.js";
import type { KantataService, KantataProject } from "./kantata.js";
import type { SalesforceService } from "./salesforce.js";
import { computeHealthScoresBatch, type HealthScoreResponse } from "../routes/health.js";

export interface PortfolioJoinedData {
  accountId: string;
  // Zendesk
  zendeskOrgIds: number[] | null;
  zendeskOpenTickets: number;
  zendeskOpen90d: number;
  // Amplitude
  amplitudeActiveUsers90d: number | null;
  amplitudeTotalUsersInSF: number | null;
  // Kantata (deployment projects)
  kantataProjects: Array<{
    id: string;
    name: string;
    status: string;
    eta: string | null;
    category: string;
  }> | null;
  // Health score (full HealthScoreResponse shape from /api/health/batch)
  healthScore: HealthScoreResponse | null;
  // Current ARR — SUM(Subscription_Total__c) across active paid subs for
  // this account. null = SF query failed or account has zero active subs.
  subscriptionArr: number | null;
}

/**
 * Enrich a batch of SF account IDs with all downstream joins.
 * Returns a Map keyed by accountId for O(1) lookups by the caller.
 *
 * `includeHealth` defaults to false — health-score computation hits SF per-
 * account (subscriptions, contact-roles, etc.) and dominates cold response
 * time on large IE/CSM portfolios. Callers that need health (e.g. the legacy
 * /api/portfolio/enrich path) can opt in; the main /api/portfolio path has
 * the frontend lazy-load health via /api/health/batch instead.
 */
export async function enrichAccountsBatch(
  accountIds: string[],
  db: IDatabaseService,
  kantata: KantataService | null = null,
  salesforce: SalesforceService | null = null,
  accountNames: Map<string, string> = new Map(),
  includeHealth: boolean = false
): Promise<Map<string, PortfolioJoinedData>> {
  const result = new Map<string, PortfolioJoinedData>();
  if (accountIds.length === 0) return result;

  // ─── Fan-out: gather everything we need in parallel ─────────────────────
  const [zendesk, sfContacts, activeUsers, kantataByAccount, healthByAccount, arrByAccount] = await Promise.all([
    fetchZendeskJoin(accountIds, db, accountNames),
    fetchSFContactCount(accountIds, db),
    db.getActiveUserCountsByAccountIds(accountIds),
    kantata && salesforce
      ? fetchKantataProjects(accountIds, kantata, salesforce)
      : Promise.resolve(new Map<string, PortfolioJoinedData["kantataProjects"]>()),
    includeHealth && salesforce && accountNames.size > 0
      ? fetchHealthScores(accountIds, accountNames, db, salesforce)
      : Promise.resolve(new Map<string, HealthScoreResponse>()),
    salesforce
      ? salesforce.getAccountArrTotals(accountIds).catch((e) => {
          console.warn("ARR totals fetch failed:", e);
          return new Map<string, number>();
        })
      : Promise.resolve(new Map<string, number>()),
  ]);

  // ─── Merge ──────────────────────────────────────────────────────────────
  for (const id of accountIds) {
    const zd = zendesk.get(id);
    const sc = sfContacts.get(id);
    const kProjects = kantataByAccount.get(id);
    const health = healthByAccount.get(id);
    const activeCount = activeUsers.get(id);

    result.set(id, {
      accountId: id,
      zendeskOrgIds: zd?.orgIds ?? null,
      zendeskOpenTickets: zd?.openTickets ?? 0,
      zendeskOpen90d: zd?.tickets90d ?? 0,
      // Amplitude active users: count of SF contacts at this account with
      // event_count_90d > 0 in any product. null = no SF contacts at all;
      // 0 = SF contacts exist but none have recent activity.
      amplitudeActiveUsers90d: (sc?.contactCount ?? 0) === 0 ? null : (activeCount ?? 0),
      amplitudeTotalUsersInSF: sc?.contactCount ?? null,
      kantataProjects: kProjects ?? null,
      healthScore: health ?? null,
      subscriptionArr: arrByAccount.has(id) ? arrByAccount.get(id)! : null,
    });
  }

  return result;
}

// ─── Health score join ─────────────────────────────────────────────────────

async function fetchHealthScores(
  accountIds: string[],
  accountNames: Map<string, string>,
  db: IDatabaseService,
  salesforce: SalesforceService
): Promise<Map<string, HealthScoreResponse>> {
  const result = new Map<string, HealthScoreResponse>();
  if (accountIds.length === 0 || accountNames.size === 0) return result;

  // computeHealthScoresBatch keys results by accountName. We need to map back to
  // accountId, so we keep a name → id map for the round-trip.
  const namesToLookup: string[] = [];
  const nameToId = new Map<string, string>();
  for (const id of accountIds) {
    const name = accountNames.get(id);
    if (name && name !== id) {
      namesToLookup.push(name);
      nameToId.set(name, id);
    }
  }
  if (namesToLookup.length === 0) return result;

  try {
    const scores = await computeHealthScoresBatch(namesToLookup, db, salesforce);
    for (const [name, score] of Object.entries(scores)) {
      const id = nameToId.get(name);
      if (id) result.set(id, score);
    }
  } catch (err) {
    console.warn("fetchHealthScores failed:", (err as Error).message);
  }
  return result;
}

// ─── Kantata join ──────────────────────────────────────────────────────────
//
// Strategy (authoritative via SF OpportunityLineItem.ProductCode):
//   1. Pull closed-won opps with a DEP-* line item per account
//      (salesforce.getDeploymentOppsByAccount).
//   2. List active Kantata workspaces — each has an sfRef pointing at either
//      an Account or an Opportunity.
//   3. Match: a workspace counts as a deployment iff its sfRef points at
//      (a) one of the deploy-opp IDs, OR (b) one of the deploy-opp accounts
//      directly. Workspaces with no DEP-* opp on record are filtered out.
//   4. Pull task categories per surviving workspace to label the project's
//      primary work type (Deployment / Implementation / Consulting / etc.).
//
// Prior approach used task-title heuristics because OpportunityLineItem was
// inaccessible. Now that the SF object is unlocked, the product-code gate is
// the source of truth and avoids false positives.

async function fetchKantataProjects(
  accountIds: string[],
  kantata: KantataService,
  salesforce: SalesforceService
): Promise<Map<string, PortfolioJoinedData["kantataProjects"]>> {
  const result = new Map<string, PortfolioJoinedData["kantataProjects"]>();
  for (const id of accountIds) result.set(id, []);

  try {
    // Step 1: deploy opps per account (from SF). Bail early if no DEP-* coverage
    // — no point pulling Kantata data if we'd reject every workspace.
    const deployOppsByAccount = await salesforce.getDeploymentOppsByAccount(accountIds);
    if (deployOppsByAccount.size === 0) return result;

    // Build (a) the set of deploy-opp IDs (for Opportunity-referenced workspaces)
    // and (b) the set of accounts with deploy coverage (for Account-referenced).
    const deployOppIds = new Set<string>();
    const accountsWithDeploy = new Set<string>(deployOppsByAccount.keys());
    for (const opps of deployOppsByAccount.values()) {
      for (const o of opps) deployOppIds.add(o.oppId);
    }

    // Step 2: all active Kantata workspaces.
    const allWorkspaces = await kantata.getAllActiveProjects();

    // Step 3: match workspaces to accounts via deploy-opp gate.
    const directByAccount = new Map<string, KantataProject[]>();
    const oppRefs = new Map<string, KantataProject[]>(); // unmatched opp refs (need account lookup)

    for (const ws of allWorkspaces) {
      if (!ws.sfRef?.sfId) continue;
      const sfId = ws.sfRef.sfId;
      if (ws.sfRef.objectType === "Account") {
        // Account-referenced: keep only if that account has a deploy opp.
        if (!accountsWithDeploy.has(sfId)) continue;
        const list = directByAccount.get(sfId) || [];
        list.push(ws);
        directByAccount.set(sfId, list);
      } else if (ws.sfRef.objectType === "Opportunity") {
        if (deployOppIds.has(sfId)) {
          // Direct hit: workspace tied to a known deploy opp. Find its account
          // by walking back through deployOppsByAccount.
          const accountId = findAccountForOpp(sfId, deployOppsByAccount);
          if (!accountId) continue;
          const list = directByAccount.get(accountId) || [];
          list.push(ws);
          directByAccount.set(accountId, list);
        } else {
          // Opportunity ref we haven't classified. Keep for the fallback Opp→Account
          // resolve below — its parent account might still be in our scope but the
          // opp itself isn't a deploy opp. We DO NOT keep these in the output; the
          // resolver below uses them only to disqualify-but-not-error.
          const list = oppRefs.get(sfId) || [];
          list.push(ws);
          oppRefs.set(sfId, list);
        }
      }
    }

    // Step 4: task categories for surviving workspaces (just for labeling).
    const workspaceIds = new Set<string>();
    for (const list of directByAccount.values()) {
      for (const ws of list) workspaceIds.add(ws.id);
    }
    const taskSummary =
      workspaceIds.size > 0
        ? await kantata.getTaskCategoriesForWorkspaces(Array.from(workspaceIds))
        : new Map();

    for (const [accountId, workspaces] of directByAccount.entries()) {
      const projects = workspaces.map((ws) => {
        const summary = taskSummary.get(ws.id);
        const sortedCats = summary?.categories
          ? [...summary.categories].sort((a, b) => b.count - a.count)
          : [];
        return {
          id: ws.id,
          name: ws.title,
          status: ws.status?.message || "Unknown",
          eta: ws.effectiveDueDate || ws.dueDate,
          category: sortedCats[0]?.category || "Deployment",
        };
      });
      result.set(accountId, projects);
    }
  } catch (err) {
    console.warn("fetchKantataProjects failed:", (err as Error).message);
    // Keep result with empty arrays — caller treats as "no records" not "no match".
  }
  return result;
}

// Helper: find the account that owns a given deploy opp, by searching the
// already-fetched per-account opp list. O(n) over the account set — fine for
// the typical CSM portfolio size (~30 accounts × a handful of opps each).
function findAccountForOpp(
  oppId: string,
  deployOppsByAccount: Map<string, Array<{ oppId: string }>>
): string | null {
  for (const [accountId, opps] of deployOppsByAccount.entries()) {
    if (opps.some((o) => o.oppId === oppId)) return accountId;
  }
  return null;
}

// ─── Zendesk join ──────────────────────────────────────────────────────────

interface ZendeskAggregate {
  orgIds: number[];
  openTickets: number;
  tickets90d: number;
}

async function fetchZendeskJoin(
  accountIds: string[],
  db: IDatabaseService,
  accountNames: Map<string, string>
): Promise<Map<string, ZendeskAggregate>> {
  const result = new Map<string, ZendeskAggregate>();

  // Load all orgs once; group by their SF ID. Most accounts have 0-3 matching
  // Zendesk orgs so this is cheaper than per-account queries.
  const allOrgs = await db.getOrganizations();
  const orgsByAccountId = new Map<string, number[]>();
  // Fallback map keyed by normalized SF Account NAME — populated from
  // sync.ts's 8-strategy fuzzy matcher, which persists its winning match
  // into salesforce_account_name. Without this fallback, every org whose
  // salesforce_id custom field is empty (the majority of orgs that the
  // fuzzy matcher rescued by name/domain/acronym) shows as "no Zendesk
  // match" on the home page even though sync already knows the answer.
  const orgsByAccountName = new Map<string, number[]>();
  const norm = (s: string) => s.toLowerCase().trim();

  for (const org of allOrgs) {
    if (org.salesforce_id) {
      // SF returns 18-char Account IDs but Zendesk's salesforce_id custom
      // field typically holds 15-char. Match by 15-char prefix for safety.
      const sfPrefix = org.salesforce_id.substring(0, 15);
      const existing = orgsByAccountId.get(sfPrefix) || [];
      existing.push(org.id);
      orgsByAccountId.set(sfPrefix, existing);
    }
    if (org.salesforce_account_name) {
      const nameKey = norm(org.salesforce_account_name);
      const existing = orgsByAccountName.get(nameKey) || [];
      existing.push(org.id);
      orgsByAccountName.set(nameKey, existing);
    }
  }

  // For each requested account, find matching orgs and aggregate ticket counts
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  for (const accountId of accountIds) {
    const accountPrefix = accountId.substring(0, 15);
    let orgIds = orgsByAccountId.get(accountPrefix);

    // Name-fallback: if the SF ID lookup missed, try the fuzzy-matched name
    // that sync.ts persisted. The resolver passes us each account's display
    // name so we can do this without a second DB query.
    if ((!orgIds || orgIds.length === 0)) {
      const accountName = accountNames.get(accountId);
      if (accountName) {
        const fallback = orgsByAccountName.get(norm(accountName));
        if (fallback && fallback.length > 0) {
          orgIds = fallback;
        }
      }
    }

    if (!orgIds || orgIds.length === 0) {
      // No Zendesk match — leave out of result so caller sets zendeskOrgIds=null
      continue;
    }

    let openTickets = 0;
    let tickets90d = 0;

    for (const orgId of orgIds) {
      const stats = await db.getTicketStats(orgId);
      openTickets += stats.new + stats.open + stats.pending + stats.hold;

      // Count tickets in the last 90 days (open + recently-closed)
      const tickets = await db.getTicketsByOrganization(orgId);
      for (const t of tickets) {
        if (new Date(t.created_at) >= ninetyDaysAgo) tickets90d++;
      }
    }

    result.set(accountId, { orgIds, openTickets, tickets90d });
  }

  return result;
}

// ─── SF contact-count join (for revival outreach / usage section) ──────────

interface SFContactCount {
  contactCount: number;
}

async function fetchSFContactCount(
  accountIds: string[],
  db: IDatabaseService
): Promise<Map<string, SFContactCount>> {
  const result = new Map<string, SFContactCount>();
  const contacts = await db.getOrgContactsByAccountIds(accountIds);

  // contacts can include records for multiple accounts; bucket per account.
  for (const id of accountIds) result.set(id, { contactCount: 0 });
  for (const c of contacts) {
    if (!c.account_id) continue;
    const bucket = result.get(c.account_id);
    if (bucket) bucket.contactCount++;
  }

  // Empty buckets stay at contactCount: 0 — the caller decides whether to
  // surface that as "no records" or treat as null.
  return result;
}
