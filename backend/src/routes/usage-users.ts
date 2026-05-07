import { Router, Request, Response } from "express";
import type { IDatabaseService, ProductUserRow } from "../services/database-interface.js";

/**
 * GET /api/usage/users/:productSlug/:accountId
 *
 * Returns the list of users active in `productSlug` for the SF account `accountId`
 * over the last 90 days, joined to SF Contact records by keycloak ID. The endpoint
 * walks the SF account hierarchy (parent + descendants) so that contacts and activity
 * across related accounts are unioned together — important for accounts like Adobe
 * where seats and usage are split across multiple SF account records.
 *
 * Query params:
 *   ?orgKey=<value>       Override the Amplitude org_key (gp:organization). Useful when
 *                         the product uses a UUID we know from Enterprise_Subscription__c.
 *   ?orgKey=a&orgKey=b    Multiple org keys are OR'd together.
 *   ?includeInactive=1    Include SF Contacts at the account that have no Amplitude
 *                         activity for the product (provisioned-but-not-active).
 *
 * Response:
 *   {
 *     productSlug, accountId,
 *     orgKeys: string[],            // resolved org keys queried
 *     relatedAccountIds: string[],  // self + ancestors + descendants in the hierarchy
 *     relatedAccounts: { account_id, account_name }[],
 *     activeCount, inactiveCount, totalContactsAtAccount,
 *     users: ProductUserRow[]       // active users (and inactive seats if requested)
 *   }
 */
export function createUsageUsersRoutes(db: IDatabaseService): Router {
  const router = Router();

  router.get("/:productSlug/:accountId", async (req: Request, res: Response) => {
    try {
      const productSlug = req.params.productSlug;
      const accountId = req.params.accountId;
      const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";

      // Walk the account hierarchy to find every related account
      const relatedAccounts = await db.getRelatedAccountIds(accountId);
      const relatedAccountIds = relatedAccounts.map((a) => a.account_id);

      // Collect org keys: ?orgKey=foo or ?orgKey=foo&orgKey=bar, plus the account_id
      // itself as a fallback (some products use SF account name; the caller can pass it).
      const rawOrgKeys = req.query.orgKey;
      const orgKeys: string[] = [];
      if (Array.isArray(rawOrgKeys)) {
        for (const k of rawOrgKeys) if (typeof k === "string" && k.trim()) orgKeys.push(k.trim());
      } else if (typeof rawOrgKeys === "string" && rawOrgKeys.trim()) {
        orgKeys.push(rawOrgKeys.trim());
      }

      // Also seed org keys with each related account's name (some products store
      // gp:organization as the SF account name). De-duped below.
      for (const a of relatedAccounts) {
        if (a.account_name) {
          orgKeys.push(a.account_name);
          orgKeys.push(`-${a.account_name}`);
        }
      }
      const dedupedOrgKeys = Array.from(new Set(orgKeys.filter(Boolean)));

      if (dedupedOrgKeys.length === 0) {
        // No explicit org key and no hierarchy names; fall back to seat list at the account
        const contacts = await db.getOrgContactsByAccountIds(relatedAccountIds);
        if (contacts.length === 0) {
          return res.json({
            productSlug,
            accountId,
            orgKeys: [],
            relatedAccountIds,
            relatedAccounts: relatedAccounts.map((a) => ({ account_id: a.account_id, account_name: a.account_name })),
            activeCount: 0,
            inactiveCount: 0,
            totalContactsAtAccount: 0,
            users: [],
          });
        }
        const users: ProductUserRow[] = contacts.map((c) => ({
          keycloak_id: c.keycloak_id,
          email: c.email,
          name: c.name,
          title: c.title,
          account_id: c.account_id,
          account_name: c.account_name,
          last_seen: null,
          event_count_90d: 0,
          matched: true,
        }));
        return res.json({
          productSlug,
          accountId,
          orgKeys: [],
          relatedAccountIds,
          relatedAccounts: relatedAccounts.map((a) => ({ account_id: a.account_id, account_name: a.account_name })),
          activeCount: 0,
          inactiveCount: users.length,
          totalContactsAtAccount: contacts.length,
          users: includeInactive ? users : [],
          warning: "No orgKey provided — returning seat list only. Pass ?orgKey=<gp:organization value> to see activity.",
        });
      }

      // Fetch activity by org_key (matches anonymous Amplitude users tagged with this account
      // even when they're not in SF) and by keycloak ID (matches SF Contacts/Leads at the
      // account active under any org_key, including abbreviations or stale strings). Union
      // both — the org_key path catches users we can't link to SF, the keycloak path catches
      // SF-known users tagged with non-matching gp:organization values.
      const accountContactsAll = await db.getOrgContactsByAccountIds(relatedAccountIds);
      const accountKeycloakIds = accountContactsAll.map((c) => c.keycloak_id);
      const [byOrgKey, byKeycloak] = await Promise.all([
        db.getProductUserActivity(productSlug, dedupedOrgKeys),
        accountKeycloakIds.length > 0
          ? db.getProductUserActivityByKeycloakIds(productSlug, accountKeycloakIds)
          : Promise.resolve([]),
      ]);
      // Union by keycloak_id, preferring the row with the higher event_count_90d.
      const activityMap = new Map<string, typeof byOrgKey[number]>();
      for (const a of byOrgKey) activityMap.set(a.keycloak_id, a);
      for (const a of byKeycloak) {
        const existing = activityMap.get(a.keycloak_id);
        if (!existing || a.event_count_90d > existing.event_count_90d) {
          activityMap.set(a.keycloak_id, a);
        }
      }
      const activity = Array.from(activityMap.values()).sort(
        (a, b) => b.event_count_90d - a.event_count_90d
      );
      const orgKeyOnly = byOrgKey.length;
      const keycloakOnly = byKeycloak.length;

      // Resolve SF Contact details for each active keycloak_id
      const keycloakIds = activity.map((a) => a.keycloak_id);
      const contactByKey = await db.getOrgContactsByKeycloakIds(keycloakIds);

      const activeUsers: ProductUserRow[] = activity.map((a) => {
        const c = contactByKey.get(a.keycloak_id);
        return {
          keycloak_id: a.keycloak_id,
          email: c?.email ?? null,
          name: c?.name ?? null,
          title: c?.title ?? null,
          account_id: c?.account_id ?? null,
          account_name: c?.account_name ?? null,
          last_seen: a.last_seen,
          event_count_90d: a.event_count_90d,
          matched: !!c,
        };
      });

      // Inactive seats = SF records at any related account whose keycloak_id is not in the active set.
      const totalContactsAtAccount = accountContactsAll.length;
      let inactiveUsers: ProductUserRow[] = [];
      if (includeInactive) {
        const activeKeys = new Set(activity.map((a) => a.keycloak_id));
        inactiveUsers = accountContactsAll
          .filter((c) => !activeKeys.has(c.keycloak_id))
          .map((c) => ({
            keycloak_id: c.keycloak_id,
            email: c.email,
            name: c.name,
            title: c.title,
            account_id: c.account_id,
            account_name: c.account_name,
            last_seen: null,
            event_count_90d: 0,
            matched: true,
          }));
      }

      const users = includeInactive ? [...activeUsers, ...inactiveUsers] : activeUsers;

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        productSlug,
        accountId,
        orgKeys: dedupedOrgKeys,
        relatedAccountIds,
        relatedAccounts: relatedAccounts.map((a) => ({ account_id: a.account_id, account_name: a.account_name })),
        activeCount: activeUsers.length,
        inactiveCount: inactiveUsers.length,
        totalContactsAtAccount,
        users,
        matchBreakdown: { byOrgKey: orgKeyOnly, byKeycloak: keycloakOnly, union: activity.length },
      });
    } catch (error) {
      console.error("Usage users API error:", error);
      res.status(500).json({
        error: "Failed to fetch product users",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
