// Global search service. Builds an in-memory index per (role, email) of every
// searchable entity the caller can see, then filters it on each query.
//
// Why an index instead of fanning out on every keystroke:
// users type a few characters at a time. The downstream sources (SF, DB) cost
// 100ms+ per fetch. Building the index once per minute and filtering in memory
// keeps each keystroke under 5ms.

import type { IDatabaseService } from "./database-interface.js";
import type { SalesforceService } from "./salesforce.js";
import type { KantataService } from "./kantata.js";
import { resolvePortfolio, type Role } from "./portfolio-resolver.js";
import { MemoryCache } from "./cache.js";

// 60s TTL — fresh enough that newly-created plans / opps show up within a
// minute; long enough that typing 8 characters in 4 seconds doesn't rebuild.
const indexCache = new MemoryCache(60);

export type SearchResultType =
  | "account"
  | "opportunity"
  | "plan"
  | "template"
  | "org";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  label: string;        // Primary display text
  sublabel?: string;    // Secondary context (e.g. account name for an opp)
  url: string;          // Deep-link the frontend should navigate to
  score: number;        // Higher = better. Used for sort.
  // Optional: highlight ranges for the label (Phase B). Tuples of [start, end).
  matches?: Array<[number, number]>;
}

interface SearchIndex {
  accounts: Array<{ id: string; name: string }>;
  opps: Array<{ id: string; name: string; accountId: string; accountName: string }>;
  plans: Array<{ id: number; name: string; accountId: string; accountName: string; product: string }>;
  templates: Array<{ id: number; name: string; product: string; deployment_type: string; is_active: boolean }>;
  orgs: Array<{ id: number; name: string; sfAccountId: string | null; sfAccountName: string | null }>;
}

// Type-priority multipliers applied AFTER the lexical score. Templates rank
// lowest because they're admin tooling.
const TYPE_WEIGHTS: Record<SearchResultType, number> = {
  account: 1.2,
  opportunity: 1.0,
  plan: 1.0,
  org: 0.7,
  template: 0.8,
};

// Lexical score for a single label vs query.
//   exact (case-insensitive) → 100
//   prefix                   → 50
//   word-boundary contains   → 25
//   substring contains       → 10
//   else                     → 0
function lexScore(label: string, q: string): number {
  if (!label) return 0;
  const lc = label.toLowerCase();
  if (lc === q) return 100;
  if (lc.startsWith(q)) return 50;
  // Word boundary: q sits at the start of any word in the label
  // We detect by looking for " <q>" or non-alnum boundary.
  const wb = new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}`);
  if (wb.test(lc)) return 25;
  if (lc.includes(q)) return 10;
  return 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compute match ranges (start/end pairs) for highlighting. Returns the
// position of every occurrence of the query in the label. Falls back to
// empty array if no occurrences.
function matchRanges(label: string, q: string): Array<[number, number]> {
  if (!label || !q) return [];
  const lcLabel = label.toLowerCase();
  const lcQuery = q.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let idx = 0;
  while (idx < lcLabel.length) {
    const found = lcLabel.indexOf(lcQuery, idx);
    if (found === -1) break;
    ranges.push([found, found + lcQuery.length]);
    idx = found + lcQuery.length;
  }
  return ranges;
}

interface BuildArgs {
  role: Role;
  email: string;
  isAdmin: boolean;
  db: IDatabaseService;
  salesforce: SalesforceService | null;
  kantata: KantataService | null;
}

async function buildIndex(args: BuildArgs): Promise<SearchIndex> {
  const { role, email, isAdmin, db, salesforce, kantata } = args;

  // Step 1 — resolve the user's portfolio so we know which accountIds they
  // can see. Admins get every assigned account in the system.
  const portfolio = await resolvePortfolio(
    isAdmin ? "admin" : role,
    isAdmin ? "" : email,
    db,
    salesforce,
    kantata,
  );

  // Flatten the hierarchy into a (id, name) list.
  const accountIds = new Set<string>();
  const accountNameById = new Map<string, string>();
  const flatten = (accounts: typeof portfolio.accounts) => {
    for (const a of accounts) {
      accountIds.add(a.id);
      accountNameById.set(a.id, a.name);
      if (a.children) flatten(a.children);
    }
  };
  flatten(portfolio.accounts);

  // Step 2 — pull each source in parallel.
  const [opps, plans, templates, allOrgs] = await Promise.all([
    salesforce
      ? salesforce
          .getOpenRenewalsForAccounts(Array.from(accountIds), 365)
          .catch(() => [] as Array<{ accountId: string; name: string; renewalDate: string; amount: number; stageName: string }>)
      : Promise.resolve([] as Array<{ accountId: string; name: string; renewalDate: string; amount: number; stageName: string }>),
    // Non-admins only see plans they own as TSA/IE or that touch an account
    // in their portfolio. Admins see all.
    db.listDeploymentPlans(isAdmin ? {} : { tsa_email: email }),
    // Templates are admin tooling — only surface them to admins.
    isAdmin
      ? db.listDeploymentTemplates({ is_active: true })
      : Promise.resolve([]),
    db.getOrganizations(),
  ]);

  // Build the index. Each entry is small (just id + display fields) so the
  // total memory footprint stays modest even with thousands of accounts.
  const index: SearchIndex = {
    accounts: Array.from(accountIds).map((id) => ({
      id,
      name: accountNameById.get(id) || id,
    })),
    // getOpenRenewalsForAccounts doesn't surface the opp Id (the underlying
     // route routes by accountId anyway), so we build a stable synthetic key
     // from accountId+name. Dedup later will collapse exact-duplicate names
     // per account if SF has weird data.
    opps: opps.map((o) => ({
      id: `${o.accountId}::${o.name}`,
      name: o.name,
      accountId: o.accountId,
      accountName: accountNameById.get(o.accountId) || o.accountId,
    })),
    plans: plans
      .filter((p) => isAdmin || accountIds.has(p.account_id) || (p.tsa_email?.toLowerCase() === email.toLowerCase()) || (p.ie_email?.toLowerCase() === email.toLowerCase()))
      .map((p) => ({
        id: p.id,
        name: p.opportunity_name || `Plan ${p.id}`,
        accountId: p.account_id,
        accountName: p.account_name || accountNameById.get(p.account_id) || p.account_id,
        product: p.product,
      })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      product: t.product,
      deployment_type: t.deployment_type,
      is_active: t.is_active,
    })),
    orgs: allOrgs
      // Scope orgs to ones whose SF account is in the user's portfolio. If the
      // org has no SF link at all (unlikely after sync but possible) include it
      // for admins only.
      .filter((o) => {
        if (isAdmin) return true;
        const sfPrefix = o.salesforce_id?.substring(0, 15);
        if (sfPrefix && Array.from(accountIds).some((id) => id.startsWith(sfPrefix))) return true;
        if (o.salesforce_account_name) {
          const lc = o.salesforce_account_name.toLowerCase();
          for (const name of accountNameById.values()) {
            if (name.toLowerCase() === lc) return true;
          }
        }
        return false;
      })
      .map((o) => ({
        id: o.id,
        name: o.name,
        sfAccountId: o.salesforce_id,
        sfAccountName: o.salesforce_account_name,
      })),
  };

  return index;
}

export interface SearchArgs {
  q: string;
  types?: SearchResultType[]; // default: all
  limit?: number;             // default: 20
  role: Role;
  email: string;
  isAdmin: boolean;
  db: IDatabaseService;
  salesforce: SalesforceService | null;
  kantata: KantataService | null;
}

export async function search(args: SearchArgs): Promise<{ results: SearchResult[]; indexHit: boolean }> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const types = new Set<SearchResultType>(args.types ?? ["account", "opportunity", "plan", "template", "org"]);
  const q = args.q.trim().toLowerCase();
  if (!q) return { results: [], indexHit: false };

  // Cache key: role + email is the scope; query length doesn't affect the
  // index itself, just the filter.
  const cacheKey = `idx:${args.isAdmin ? "admin" : args.role}:${args.isAdmin ? "" : args.email.toLowerCase()}`;
  let index = indexCache.get<SearchIndex>(cacheKey);
  const indexHit = !!index;
  if (!index) {
    index = await buildIndex({
      role: args.role,
      email: args.email,
      isAdmin: args.isAdmin,
      db: args.db,
      salesforce: args.salesforce,
      kantata: args.kantata,
    });
    indexCache.set(cacheKey, index);
  }

  const results: SearchResult[] = [];

  if (types.has("account")) {
    for (const a of index.accounts) {
      const lex = lexScore(a.name, q);
      if (lex === 0) continue;
      results.push({
        type: "account",
        id: a.id,
        label: a.name,
        sublabel: "Account",
        url: `/customer?accountId=${encodeURIComponent(a.id)}`,
        score: lex * TYPE_WEIGHTS.account,
        matches: matchRanges(a.name, q),
      });
    }
  }

  if (types.has("opportunity")) {
    for (const o of index.opps) {
      // Score against opp name AND account name; take the max.
      const oppLex = lexScore(o.name, q);
      const accLex = lexScore(o.accountName, q) * 0.7; // weaker — match was on context, not the opp itself
      const lex = Math.max(oppLex, accLex);
      if (lex === 0) continue;
      results.push({
        type: "opportunity",
        id: o.id,
        label: o.name,
        sublabel: o.accountName,
        url: `/renewals/upcoming?accountId=${encodeURIComponent(o.accountId)}`,
        score: lex * TYPE_WEIGHTS.opportunity,
        matches: oppLex >= accLex ? matchRanges(o.name, q) : [],
      });
    }
  }

  if (types.has("plan")) {
    for (const p of index.plans) {
      const planLex = lexScore(p.name, q);
      const accLex = lexScore(p.accountName, q) * 0.7;
      const lex = Math.max(planLex, accLex);
      if (lex === 0) continue;
      results.push({
        type: "plan",
        id: String(p.id),
        label: p.name,
        sublabel: `${p.accountName} · ${p.product}`,
        url: `/deployments/plans/${p.id}`,
        score: lex * TYPE_WEIGHTS.plan,
        matches: planLex >= accLex ? matchRanges(p.name, q) : [],
      });
    }
  }

  if (types.has("template")) {
    for (const t of index.templates) {
      const lex = lexScore(t.name, q);
      if (lex === 0) continue;
      results.push({
        type: "template",
        id: String(t.id),
        label: t.name,
        sublabel: `${t.product} · ${t.deployment_type === "cloud" ? "SaaS / Cloud" : "On-Premises"}`,
        url: `/admin/deployment-templates/${t.id}`,
        score: lex * TYPE_WEIGHTS.template,
        matches: matchRanges(t.name, q),
      });
    }
  }

  if (types.has("org")) {
    for (const o of index.orgs) {
      const lex = lexScore(o.name, q);
      if (lex === 0) continue;
      // Deep link: if we know the SF account, go to Customer page; otherwise
      // skip — we don't have a "raw zendesk org" view to land on.
      if (!o.sfAccountId) continue;
      results.push({
        type: "org",
        id: String(o.id),
        label: o.name,
        sublabel: o.sfAccountName ? `Zendesk · ${o.sfAccountName}` : "Zendesk org",
        url: `/customer?accountId=${encodeURIComponent(o.sfAccountId)}`,
        score: lex * TYPE_WEIGHTS.org,
        matches: matchRanges(o.name, q),
      });
    }
  }

  // Sort desc by score; tie-break alphabetically by label so result order is stable.
  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  // De-duplicate: an org that resolves to the same SF account as an account row
  // would duplicate the customer link. Keep the highest-scoring entry per URL.
  const seenUrls = new Set<string>();
  const dedup: SearchResult[] = [];
  for (const r of results) {
    if (seenUrls.has(r.url)) continue;
    seenUrls.add(r.url);
    dedup.push(r);
    if (dedup.length >= limit) break;
  }

  return { results: dedup, indexHit };
}
