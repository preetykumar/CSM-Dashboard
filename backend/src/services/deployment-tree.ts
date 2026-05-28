// Deployments view orchestrator.
//
// Builds the per-TSA hierarchical tree:
//   TSA
//   └─ Customer
//      └─ Opp  (only rendered when customer has >1 opp OR opp is multi-product)
//         └─ Product (the actual deployment unit — implementation plan attaches here)
//            └─ Kantata link + DEP-* $ + plan instance + tasks (later phases)
//
// Spike `backend/scripts/spike-deploy-kantata-mapping.mjs` validated:
//   - 1 Kantata workspace per Opportunity (never per product)
//   - 63% of multi-product opps have 1 workspace; 37% have 0 (project not
//     yet set up); 0% have 2+
// So budget lives at OPP level; product is just the template/plan unit.
//
// Phase 1 returns read-only data only. Plan instances + tasks are added in
// later phases (the `plan: null` placeholder is the integration point).

import type { SalesforceService } from "./salesforce.js";
import type { KantataService, KantataProject } from "./kantata.js";
import type { IDatabaseService, CachedAccountHierarchy } from "./database-interface.js";

export type DeploymentType = "cloud" | "on_prem";

export interface DeploymentProductNode {
  productLabel: string;
  productCode: string; // first matching code from the opp; used to derive type
  deploymentType: DeploymentType;
  totalDepDollars: number;
  lineItems: Array<{ productCode: string; productName: string | null; totalPrice: number; quantity: number }>;
  // Phase 1 placeholder — instance lookup wires in Phase 3.
  plan: null;
}

export interface DeploymentOppNode {
  oppId: string;
  oppName: string;
  closeDate: string | null;
  kantata: {
    workspaceId: string | null;
    title: string | null;
    budget: number | null;
    budgetUsed: number;
    budgetRemaining: string | null;
    overBudget: boolean;
    status: string | null;
    effectiveDueDate: string | null;
    url: string | null;
  } | null;
  products: DeploymentProductNode[];
  totalDepDollars: number;
}

export interface DeploymentCustomerNode {
  accountId: string;
  accountName: string;
  opps: DeploymentOppNode[];
  // Derived for UI rendering: collapse Opp level when there's exactly one opp
  // AND that opp has exactly one product. Otherwise show all levels.
  renderMode: "flat" | "by_opp";
  totalDepDollars: number;
  totalKantataBudget: number | null;
  oppCount: number;
  productCount: number;
  // Phase 2 enrichments for the per-customer detail panel:
  //   - enterpriseUuid feeds Amplitude/Health lookups
  //   - zendeskOrgIds feed the Support tab (one customer may map to >1 ZD org)
  enterpriseUuid: string | null;
  zendeskOrgIds: number[];
}

export interface DeploymentTree {
  role: "tsa";
  email: string;
  customers: DeploymentCustomerNode[];
  totalCount: number;
  totals: {
    customers: number;
    opps: number;
    products: number;
    depDollars: number;
    kantataBudget: number;
    kantataUsed: number;
    kantataRemaining: number;
    oppsWithoutKantata: number;
  };
}

// Cloud vs on-prem detection from ProductCode suffix. Default = cloud.
function deploymentTypeFromCode(code: string): DeploymentType {
  return /-?(ONPREM|PRIVCLOUD|OFFLINE)\b/i.test(code) ? "on_prem" : "cloud";
}

// Map a SF product line item's code to a normalized product label. Returns null
// for things that aren't user-deployable products (services, fees, deployment
// SKUs themselves).
function productLabelFromCode(code: string): string | null {
  if (!code) return null;
  if (code.startsWith("DEP-")) return null;
  if (
    code.startsWith("HOSTING") ||
    code.startsWith("MAINTENANCE") ||
    code.startsWith("INVTRACK") ||
    code.startsWith("SERVS")
  ) return null;
  if (code.startsWith("AXEDTPRO") || code.startsWith("AXEDTHTML")) return "axe DevTools";
  if (code.startsWith("AXEDTNATMOB")) return "axe DevTools Mobile";
  if (code.startsWith("AXEMON")) return "axe Monitor";
  if (code.startsWith("AXEAUD")) return "axe Auditor";
  if (code.startsWith("AXELINT")) return "axe DevTools Linter";
  if (code.startsWith("AXEASSIST")) return "axe Assistant";
  if (code.startsWith("AXEMCP")) return "axe MCP Server";
  if (code.startsWith("DQU")) return "Deque University";
  // The legacy "axe DevTools HTML" / "axe DevTools" string codes seen in
  // some opps (no SKU code, label-as-code) — group with DevTools.
  if (/axe ?DevTools/i.test(code)) return "axe DevTools";
  if (/axe ?Auditor/i.test(code)) return "axe Auditor";
  if (/axe ?Monitor/i.test(code)) return "axe Monitor";
  return null;
}

export async function getDeploymentTreeForTSA(
  email: string,
  salesforce: SalesforceService,
  kantata: KantataService | null,
  db: IDatabaseService
): Promise<DeploymentTree> {
  const empty: DeploymentTree = {
    role: "tsa",
    email,
    customers: [],
    totalCount: 0,
    totals: {
      customers: 0,
      opps: 0,
      products: 0,
      depDollars: 0,
      kantataBudget: 0,
      kantataUsed: 0,
      kantataRemaining: 0,
      oppsWithoutKantata: 0,
    },
  };

  if (!email) return empty;

  // Step 1: TSA's account IDs (Customer_Success_Manager__c lookup field —
  // misleadingly named, but it IS the TSA role per CLAUDE.md notes).
  const accountIds = await salesforce.getAccountIdsAssignedToTSA(email);
  if (accountIds.length === 0) return empty;

  // Step 2: SF deploy-opp line-item detail per account (in parallel with
  // Kantata workspace fetch + account-name lookup from DB cache + per-customer
  // detail enrichments needed by the Phase 2 detail panel:
  //   - Enterprise UUIDs (for Amplitude + Health)
  //   - All Zendesk orgs (to map SF account → ZD orgs for Support tab)
  const [oppDetailsByAccount, allWorkspaces, accountHierarchy, allOrgs, ...uuidsByAccount] =
    await Promise.all([
      salesforce.getDeploymentOppDetailsByAccount(accountIds),
      kantata ? kantata.getAllActiveProjects() : Promise.resolve([] as KantataProject[]),
      db.getAccountHierarchy(),
      db.getOrganizations(),
      // One SOQL per account for enterprise UUIDs — small N (TSA-scoped, <30).
      // Failures fall back to []; UUID is optional in the response.
      ...accountIds.map((id) =>
        salesforce.getEnterpriseSubscriptionsByAccountId(id).catch((e) => {
          console.warn(`[deployment-tree] enterprise sub fetch failed for ${id}:`, e instanceof Error ? e.message : e);
          return [] as Awaited<ReturnType<typeof salesforce.getEnterpriseSubscriptionsByAccountId>>;
        })
      ),
    ]);

  // Index UUIDs by account: first non-empty UUID wins (some products may not
  // have one assigned yet; per-account display only needs one to drive lookups).
  const uuidByAccountId = new Map<string, string>();
  for (let i = 0; i < accountIds.length; i++) {
    const subs = uuidsByAccount[i] || [];
    const uuid = subs.find((s) => s.enterpriseUuid)?.enterpriseUuid;
    if (uuid) uuidByAccountId.set(accountIds[i], uuid);
  }

  // Index Zendesk orgs by SF account id. Zendesk stores 15-char SF IDs;
  // SF returns 18-char (CLAUDE.md §14). Match by both forms.
  const zdOrgIdsByAccountId = new Map<string, number[]>();
  for (const org of allOrgs) {
    if (!org.salesforce_id) continue;
    const sf15 = org.salesforce_id.substring(0, 15);
    for (const variant of [org.salesforce_id, sf15]) {
      if (!zdOrgIdsByAccountId.has(variant)) zdOrgIdsByAccountId.set(variant, []);
      const arr = zdOrgIdsByAccountId.get(variant)!;
      if (!arr.includes(org.id)) arr.push(org.id);
    }
  }

  // Index account names from the hierarchy cache.
  const idSet = new Set(accountIds);
  const accountNameById = new Map<string, string>();
  for (const h of accountHierarchy as CachedAccountHierarchy[]) {
    if (idSet.has(h.account_id)) accountNameById.set(h.account_id, h.account_name);
  }

  // Index Kantata workspaces by Opportunity ID (1:1 per spike).
  const wsByOppId = new Map<string, KantataProject>();
  for (const ws of allWorkspaces) {
    if (ws.sfRef?.objectType === "Opportunity" && ws.sfRef.sfId) {
      // If two workspaces somehow ref the same opp, keep the first; spike
      // showed this never happens in active data.
      if (!wsByOppId.has(ws.sfRef.sfId)) wsByOppId.set(ws.sfRef.sfId, ws);
    }
  }

  // Step 3: build the per-customer tree.
  const customers: DeploymentCustomerNode[] = [];
  const totals = { ...empty.totals };

  for (const accountId of accountIds) {
    const opps = oppDetailsByAccount.get(accountId) || [];
    if (opps.length === 0) continue; // skip accounts without any deploy opps

    const accountName = accountNameById.get(accountId) || accountId;
    const oppNodes: DeploymentOppNode[] = [];
    let customerDepDollars = 0;
    let customerKantataBudget = 0;
    let customerProductCount = 0;

    for (const opp of opps) {
      // Group line items into product buckets. Multiple line items with the
      // same product label and deployment-type collapse into one product node.
      const productBuckets = new Map<string, DeploymentProductNode>();
      let oppDepDollars = 0;

      for (const li of opp.lineItems) {
        if (li.productCode.startsWith("DEP-")) {
          // DEP-* dollars are deployment-package $, attributed at the opp level
          // (and surfaced per-product via productDepDollars derived below).
          oppDepDollars += li.totalPrice;
          continue;
        }
        const label = productLabelFromCode(li.productCode);
        if (!label) continue; // services / fees ignored for v1
        const depType = deploymentTypeFromCode(li.productCode);
        const key = `${label}::${depType}`;
        if (!productBuckets.has(key)) {
          productBuckets.set(key, {
            productLabel: label,
            productCode: li.productCode,
            deploymentType: depType,
            totalDepDollars: 0,
            lineItems: [],
            plan: null,
          });
        }
        const bucket = productBuckets.get(key)!;
        bucket.lineItems.push({
          productCode: li.productCode,
          productName: li.productName,
          totalPrice: li.totalPrice,
          quantity: li.quantity,
        });
      }

      const products = Array.from(productBuckets.values());
      if (products.length === 0) continue;

      // Allocate DEP-* dollars to products evenly (no per-product DEP linkage
      // exists in the data). Each product gets oppDepDollars / N.
      const perProduct = products.length > 0 ? oppDepDollars / products.length : 0;
      for (const p of products) p.totalDepDollars = perProduct;

      const ws = wsByOppId.get(opp.oppId);
      const kantata: DeploymentOppNode["kantata"] = ws
        ? {
            workspaceId: ws.id,
            title: ws.title,
            budget: ws.priceInCents != null ? ws.priceInCents / 100 : null,
            budgetUsed: ws.budgetUsedInCents / 100,
            budgetRemaining: ws.budgetRemaining,
            overBudget: ws.overBudget,
            status: ws.status?.message ?? null,
            effectiveDueDate: ws.effectiveDueDate || ws.dueDate,
            url: ws.url,
          }
        : null;

      oppNodes.push({
        oppId: opp.oppId,
        oppName: opp.oppName,
        closeDate: opp.closeDate,
        kantata,
        products,
        totalDepDollars: oppDepDollars,
      });

      customerDepDollars += oppDepDollars;
      if (kantata?.budget) customerKantataBudget += kantata.budget;
      customerProductCount += products.length;

      totals.opps++;
      totals.products += products.length;
      totals.depDollars += oppDepDollars;
      if (kantata?.budget) totals.kantataBudget += kantata.budget;
      totals.kantataUsed += kantata?.budgetUsed ?? 0;
      if (!kantata) totals.oppsWithoutKantata++;
    }

    if (oppNodes.length === 0) continue;

    // Adaptive render mode: collapse Opp level if there's exactly one opp AND
    // that one opp has exactly one product. Otherwise show 4 levels.
    const renderMode: DeploymentCustomerNode["renderMode"] =
      oppNodes.length === 1 && oppNodes[0].products.length === 1 ? "flat" : "by_opp";

    // Look up Zendesk orgs by both 18-char and 15-char SF id (one will hit).
    const zdOrgIds =
      zdOrgIdsByAccountId.get(accountId) ||
      zdOrgIdsByAccountId.get(accountId.substring(0, 15)) ||
      [];

    customers.push({
      accountId,
      accountName,
      opps: oppNodes,
      renderMode,
      totalDepDollars: customerDepDollars,
      totalKantataBudget: customerKantataBudget > 0 ? customerKantataBudget : null,
      oppCount: oppNodes.length,
      productCount: customerProductCount,
      enterpriseUuid: uuidByAccountId.get(accountId) || null,
      zendeskOrgIds: zdOrgIds,
    });
    totals.customers++;
  }

  totals.kantataRemaining = Math.max(0, totals.kantataBudget - totals.kantataUsed);

  // Sort customers alphabetically; opps within a customer by close date desc.
  customers.sort((a, b) => a.accountName.localeCompare(b.accountName));
  for (const c of customers) {
    c.opps.sort((a, b) => (b.closeDate || "").localeCompare(a.closeDate || ""));
  }

  return {
    role: "tsa",
    email,
    customers,
    totalCount: customers.length,
    totals,
  };
}
