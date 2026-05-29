// Track A — SF-source-of-truth portfolio resolver.
//
// Returns the MockPortfolioAccount[] shape consumed by the frontend, sourced
// from real SF assignments + DB caches. Per design:
//   - Every assigned account appears regardless of downstream data coverage.
//   - Parent + sibling accounts are pulled in so hierarchy renders.
//   - Renewal state is derived from (open opp) + (relevant closed-won opps).
//
// Track B (portfolio-enrichment) provides the downstream join data; this
// module composes that with SF/DB-derived account metadata.

import type { IDatabaseService, CachedCSMAssignment, CachedAccountHierarchy } from "./database-interface.js";
import type { SalesforceService, RenewalOpportunity } from "./salesforce.js";
import type { KantataService } from "./kantata.js";
import { enrichAccountsBatch, type PortfolioJoinedData } from "./portfolio-enrichment.js";

export type Role = "csm" | "prs" | "tsa" | "ie" | "admin";

// Relevant product families for renewal/churn classification (mirrors frontend).
const RENEWAL_RELEVANT_FAMILIES = new Set(["Deque University", "Product"]);

export interface ClosedWonOpp {
  id: string;
  name: string;
  closedDate: string;
  amount: number;
  productFamily: string;
  productName: string;
}

export interface PortfolioAccount {
  id: string;
  name: string;
  parentId: string | null;
  csmEmail: string | null;
  csmName: string | null;
  prsEmail: string | null;
  tsaEmail: string | null;
  tsaName: string | null;
  ieEmail: string | null;
  // Active renewal opp (null = no open opp)
  upcomingRenewalDate: string | null;
  upcomingRenewalAmount: number | null;
  renewalStage: string | null;
  // Past closed-won opps (renewal-state derivation lives client-side)
  closedWonOpps: ClosedWonOpp[];
  // Downstream joined data from Track B
  joined: PortfolioJoinedData;
  // Children are nested by callers via hierarchy walking
  children?: PortfolioAccount[];
}

export interface PortfolioResponse {
  role: Role;
  email: string;
  accounts: PortfolioAccount[]; // hierarchy-rooted (children nested)
  totalCount: number;
  warnings: string[]; // e.g. "PRS portfolio empty — SF access to Product_Success__c pending"
}

/**
 * Main entry point. Computes account IDs for (role, email), walks SF hierarchy
 * to include parents/siblings, fetches per-account metadata + Track B enrichment,
 * and returns the nested hierarchical shape.
 */
// Deployment enrichment (Kantata projects) is now driven by SF
// OpportunityLineItem.ProductCode — workspaces surface only when the account
// has a closed-won opp with a DEP-* product code (see
// salesforce.getDeploymentOppsByAccount).
const DEPLOYMENT_ENRICHMENT_DISABLED = false;

export async function resolvePortfolio(
  role: Role,
  email: string,
  db: IDatabaseService,
  salesforce: SalesforceService | null,
  kantata: KantataService | null = null
): Promise<PortfolioResponse> {
  const warnings: string[] = [];
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (label: string, startedAt: number) => {
    timings[label] = Date.now() - startedAt;
  };

  // Step 1: get the account IDs the user is assigned to.
  let s = Date.now();
  const { ids: assignedIds, preseedMeta } = await getAssignedAccountIds(role, email, db, salesforce, warnings);
  lap("1_assignedIds", s);

  // Step 2: walk hierarchy to pull in parents and siblings.
  s = Date.now();
  const allIds = await walkHierarchy(assignedIds, db, role === "admin" ? "family" : "self");
  lap("2_walkHierarchy", s);

  // Step 3a: account metadata from caches (names for health lookup, CSM info).
  // Admin path supplies preseedMeta sourced directly from SF for accounts not
  // in the DB CSM/hierarchy caches (e.g. Arm, which has PRS but no CSM).
  s = Date.now();
  const metadata = await fetchAccountMetadata(allIds, db, preseedMeta);
  lap("3a_metadata", s);
  const accountNames = new Map<string, string>();
  for (const [id, m] of metadata.entries()) {
    if (m.name && m.name !== id) accountNames.set(id, m.name);
  }

  // Step 3b: in parallel, fetch (a) SF role assignments per account (TSA/IE/PRS),
  // (b) open renewal opps, (c) downstream enrichment, (d) closed-won opps.
  const effectiveKantata = DEPLOYMENT_ENRICHMENT_DISABLED ? null : kantata;
  const sParallel = Date.now();
  const roleStart = Date.now();
  const renewalsStart = Date.now();
  const enrichStart = Date.now();
  const cwStart = Date.now();
  const [roleAssignments, renewalOpps, enrichments, closedWonByAccount] = await Promise.all([
    salesforce
      ? salesforce
          .getAccountRoleAssignments(allIds)
          .then((r) => { lap("3b_roleAssignments", roleStart); return r; })
          .catch((e) => {
            warnings.push(`Account role assignments query failed: ${(e as Error).message}`);
            return new Map<string, ReturnType<typeof emptyRoleAssignment>>();
          })
      : Promise.resolve(new Map<string, ReturnType<typeof emptyRoleAssignment>>()),
    (salesforce
      ? fetchOpenRenewals(allIds, salesforce)
      : Promise.resolve(
          new Map<string, Array<{ name: string; renewalDate: string; amount: number; stageName: string }>>()
        )
    ).then((r) => { lap("3b_openRenewals", renewalsStart); return r; }),
    enrichAccountsBatch(allIds, db, effectiveKantata, salesforce, accountNames)
      .then((r) => { lap("3b_enrichment", enrichStart); return r; }),
    (salesforce
      ? fetchClosedWonOpps(allIds, salesforce, warnings).catch((e) => {
          warnings.push(`Closed-won opps fetch failed: ${e instanceof Error ? e.message : "unknown"}`);
          return new Map<string, ClosedWonOpp[]>();
        })
      : Promise.resolve(new Map<string, ClosedWonOpp[]>())
    ).then((r) => { lap("3b_closedWonOpps", cwStart); return r; }),
  ]);
  lap("3b_parallel_total", sParallel);
  console.log(`[portfolio] ${role}/${email} timings:`, timings, `total=${Date.now() - t0}ms`);

  // Step 4: build flat account list, then nest into hierarchy.
  const flat: PortfolioAccount[] = allIds.map((id) => {
    const meta = metadata.get(id);
    const opp = (renewalOpps.get(id) || [])[0]; // earliest upcoming
    const enrichment = enrichments.get(id) || emptyEnrichment(id);
    const roles = roleAssignments.get(id) || emptyRoleAssignment();
    return {
      id,
      name: meta?.name || id,
      parentId: meta?.parentId ?? null,
      // CSM from DB cache (synced nightly); TSA/IE/PRS from this query's SF result.
      csmEmail: meta?.csmEmail ?? null,
      csmName: meta?.csmName ?? null,
      prsEmail: roles.prsEmail,
      tsaEmail: roles.tsaEmail,
      tsaName: roles.tsaName,
      ieEmail: roles.ieEmail,
      upcomingRenewalDate: opp?.renewalDate || null,
      upcomingRenewalAmount: opp?.amount ?? null,
      renewalStage: opp?.stageName ?? null,
      closedWonOpps: closedWonByAccount.get(id) || [],
      joined: enrichment,
    };
  });

  const accounts = nestHierarchy(flat);
  return { role, email, accounts, totalCount: flat.length, warnings };
}

// ─── Step 1: assigned account IDs ──────────────────────────────────────────

async function getAssignedAccountIds(
  role: Role,
  email: string,
  db: IDatabaseService,
  salesforce: SalesforceService | null,
  warnings: string[]
): Promise<{ ids: string[]; preseedMeta?: Map<string, AccountMeta> }> {
  if (role === "admin") {
    // Admin universe = any account with a post-sales signal: CSM, PRS, active
    // ARR, or open renewal. Single SF query, returns name + parent + CSM info
    // so we don't depend on the CSM cache (which would miss e.g. PRS-only
    // accounts like Arm).
    if (salesforce) {
      try {
        const seeds = await salesforce.getAdminAccountSeeds();
        const ids = new Set<string>();
        const preseedMeta = new Map<string, AccountMeta>();
        for (const seed of seeds) {
          ids.add(seed.id);
          preseedMeta.set(seed.id, {
            name: seed.name,
            parentId: seed.parentId,
            csmEmail: seed.csmEmail,
            csmName: seed.csmName,
            prsEmail: null,
          });
        }
        return { ids: Array.from(ids), preseedMeta };
      } catch (err) {
        warnings.push(
          `Admin universe SF query failed: ${(err as Error).message}. Falling back to CSM cache.`
        );
      }
    }
    // Fallback: CSM cache only (legacy behavior).
    const csmAssignments = await db.getCSMAssignments();
    const ids = new Set<string>();
    for (const a of csmAssignments) {
      if (a.account_id) ids.add(a.account_id);
    }
    return { ids: Array.from(ids) };
  }

  if (role === "csm") {
    const csmAssignments = await db.getCSMAssignments();
    const lower = email.toLowerCase();
    const ids = csmAssignments
      .filter((a: CachedCSMAssignment) => a.csm_email?.toLowerCase() === lower)
      .map((a) => a.account_id)
      .filter((id): id is string => !!id);
    return { ids: Array.from(new Set(ids)) };
  }

  // TSA + IE: SF query against Account-level role-assignment lookup fields.
  if (role === "tsa" || role === "ie") {
    if (!salesforce) {
      warnings.push(`Role "${role}" portfolio empty: Salesforce service unavailable.`);
      return { ids: [] };
    }
    try {
      const ids =
        role === "tsa"
          ? await salesforce.getAccountIdsAssignedToTSA(email)
          : await salesforce.getAccountIdsAssignedToIE(email);
      return { ids: Array.from(new Set(ids)) };
    } catch (err) {
      warnings.push(
        `Role "${role}" scoping query failed: ${(err as Error).message}. Returning empty portfolio.`
      );
      return { ids: [] };
    }
  }

  // PRS users don't get a portfolio-scoped view — they work the Renewals
  // Pipeline directly (no per-customer drill-down needed for their workflow).
  // The portfolio response is intentionally empty; the frontend should route
  // role=prs users to /renewals-pipeline as their landing page.
  warnings.push(
    `Role "${role}" doesn't use the portfolio view. PRS users land on the Renewals Pipeline (/renewals-pipeline) directly.`
  );
  return { ids: [] };
}

// ─── Step 2: hierarchy walk ────────────────────────────────────────────────

// Hierarchy walk:
//   - "self"   (non-admin): exactly the accounts the user is directly assigned
//                to in SF. No expansion. If a CSM/IE/TSA owns Parent but not
//                Child, they don't see Child here. (Hierarchy context can still
//                be surfaced on the card itself via parentId, but it doesn't
//                add rows to the portfolio.)
//   - "family" (admin): every account in the same ultimate-parent family of
//                each assigned account. Broad oversight view.
async function walkHierarchy(
  assignedIds: string[],
  db: IDatabaseService,
  scope: "self" | "family"
): Promise<string[]> {
  if (assignedIds.length === 0) return [];
  if (scope === "self") return Array.from(new Set(assignedIds));

  const all = new Set<string>(assignedIds);
  for (const id of assignedIds) {
    const related = await db.getRelatedAccountIds(id);
    for (const r of related) all.add(r.account_id);
  }
  return Array.from(all);
}

// ─── Step 3a: per-account metadata from DB caches ──────────────────────────

interface AccountMeta {
  name: string;
  parentId: string | null;
  csmEmail: string | null;
  csmName: string | null;
  prsEmail: string | null;
}

async function fetchAccountMetadata(
  accountIds: string[],
  db: IDatabaseService,
  preseedMeta?: Map<string, AccountMeta>
): Promise<Map<string, AccountMeta>> {
  const meta = new Map<string, AccountMeta>();
  if (accountIds.length === 0) return meta;

  const idSet = new Set(accountIds);

  // Hierarchy: name + parentId
  const hierarchy = await db.getAccountHierarchy();
  for (const h of hierarchy as CachedAccountHierarchy[]) {
    if (idSet.has(h.account_id)) {
      meta.set(h.account_id, {
        name: h.account_name,
        parentId: h.parent_id,
        csmEmail: null,
        csmName: null,
        prsEmail: null,
      });
    }
  }

  // CSM assignments
  const csms = await db.getCSMAssignments();
  for (const a of csms) {
    if (!idSet.has(a.account_id)) continue;
    const entry =
      meta.get(a.account_id) ||
      { name: a.account_name || a.account_id, parentId: null, csmEmail: null, csmName: null, prsEmail: null };
    entry.csmEmail = a.csm_email || null;
    entry.csmName = a.csm_name || null;
    if (!entry.name) entry.name = a.account_name || a.account_id;
    meta.set(a.account_id, entry);
  }

  // Preseed: any fields the SF admin-universe query already filled. Only fills
  // gaps — won't clobber values already present from the caches.
  if (preseedMeta) {
    for (const [id, seed] of preseedMeta.entries()) {
      if (!idSet.has(id)) continue;
      const entry = meta.get(id) || { name: id, parentId: null, csmEmail: null, csmName: null, prsEmail: null };
      if (!entry.name || entry.name === id) entry.name = seed.name;
      if (entry.parentId == null) entry.parentId = seed.parentId;
      if (!entry.csmEmail) entry.csmEmail = seed.csmEmail;
      if (!entry.csmName) entry.csmName = seed.csmName;
      meta.set(id, entry);
    }
  }

  // Backfill any account IDs we have no metadata for at all (name = id).
  for (const id of accountIds) {
    if (!meta.has(id)) {
      meta.set(id, { name: id, parentId: null, csmEmail: null, csmName: null, prsEmail: null });
    }
  }
  return meta;
}

// ─── Step 3b: open renewal opps (group by account) ─────────────────────────

async function fetchOpenRenewals(
  accountIds: string[],
  salesforce: SalesforceService
): Promise<Map<string, Array<{ name: string; renewalDate: string; amount: number; stageName: string }>>> {
  const byAccount = new Map<
    string,
    Array<{ name: string; renewalDate: string; amount: number; stageName: string }>
  >();
  if (accountIds.length === 0) return byAccount;
  try {
    // Scoped query — only pulls opps for our portfolio's account set.
    // 10–20× faster than the global query for small portfolios.
    const opps = await salesforce.getOpenRenewalsForAccounts(accountIds, 365);
    for (const opp of opps) {
      const list = byAccount.get(opp.accountId) || [];
      list.push({ name: opp.name, renewalDate: opp.renewalDate, amount: opp.amount, stageName: opp.stageName });
      byAccount.set(opp.accountId, list);
    }
    for (const list of byAccount.values()) {
      list.sort((a, b) => (a.renewalDate || "").localeCompare(b.renewalDate || ""));
    }
  } catch (err) {
    console.error("fetchOpenRenewals failed:", err);
  }
  return byAccount;
}

// ─── Step 3c: closed-won opps with renewal-relevant Product Family ─────────

async function fetchClosedWonOpps(
  accountIds: string[],
  salesforce: SalesforceService,
  warnings: string[]
): Promise<Map<string, ClosedWonOpp[]>> {
  const byAccount = new Map<string, ClosedWonOpp[]>();
  if (accountIds.length === 0) return byAccount;

  // Simplified query: this SF org doesn't expose OpportunityLineItems via
  // standard relationship name. Pull Opportunity-level fields only. Product
  // family detection falls back to Type / heuristics on Name; we filter to
  // Type='Renewal' (the existing renewal-opp query uses the same filter).
  const CHUNK = 150;
  type Row = {
    Id: string;
    Name: string;
    AccountId: string;
    Amount: number | null;
    CloseDate: string;
    Type: string | null;
  };

  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const chunk = accountIds.slice(i, i + CHUNK);
    const inList = chunk.map((id) => `'${id}'`).join(",");
    try {
      // Standard Opportunity fields only. This SF org doesn't expose
      // OpportunityLineItems via standard relationship and lacks Product_Name__c.
      // Product family is inferred from opp Name as a heuristic; line-item-level
      // detection requires either fixing SF metadata or a follow-up describe.
      const rows = await salesforce.queryAll<Row>(`
        SELECT Id, Name, AccountId, Amount, CloseDate, Type
        FROM Opportunity
        WHERE StageName = '8 - Closed Won'
        AND Type = 'Renewal'
        AND AccountId IN (${inList})
      `);

      for (const r of rows) {
        if (!r.AccountId) continue;
        // Heuristic: classify by keywords in the opp name.
        //  - "University" / "DQU" / "Deque U"  → "Deque University"
        //  - otherwise                          → "Product" (default Axe suite)
        // Both families pass the relevant-product-family check in the UI.
        const name = (r.Name || "").toLowerCase();
        const productFamily =
          /university|dqu|deque\s*u/.test(name) ? "Deque University" : "Product";

        const list = byAccount.get(r.AccountId) || [];
        list.push({
          id: r.Id,
          name: r.Name,
          closedDate: r.CloseDate,
          amount: r.Amount || 0,
          productFamily,
          productName: "",
        });
        byAccount.set(r.AccountId, list);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      warnings.push(`Closed-won opp query failed for chunk ${i}: ${msg}`);
    }
  }

  // Sort by closedDate descending (most recent first)
  for (const list of byAccount.values()) {
    list.sort((a, b) => b.closedDate.localeCompare(a.closedDate));
  }
  return byAccount;
}

// ─── Step 4: nest flat list into hierarchy ─────────────────────────────────

function nestHierarchy(flat: PortfolioAccount[]): PortfolioAccount[] {
  const byId = new Map(flat.map((a) => [a.id, { ...a, children: [] as PortfolioAccount[] }]));
  const roots: PortfolioAccount[] = [];
  for (const acc of byId.values()) {
    if (acc.parentId && byId.has(acc.parentId)) {
      byId.get(acc.parentId)!.children!.push(acc);
    } else {
      roots.push(acc);
    }
  }
  // Sort roots alphabetically, and children within each parent
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of roots) {
    r.children?.sort((a, b) => a.name.localeCompare(b.name));
  }
  return roots;
}

function emptyRoleAssignment() {
  return {
    tsaEmail: null,
    tsaName: null,
    ieEmail: null,
    ieName: null,
    prsEmail: null,
    prsName: null,
  } as {
    tsaEmail: string | null; tsaName: string | null;
    ieEmail: string | null; ieName: string | null;
    prsEmail: string | null; prsName: string | null;
  };
}

function emptyEnrichment(accountId: string): PortfolioJoinedData {
  return {
    accountId,
    zendeskOrgIds: null,
    zendeskOpenTickets: 0,
    zendeskOpen90d: 0,
    amplitudeActiveUsers90d: null,
    amplitudeTotalUsersInSF: null,
    kantataProjects: null,
    healthScore: null,
    subscriptionArr: null,
  };
}
