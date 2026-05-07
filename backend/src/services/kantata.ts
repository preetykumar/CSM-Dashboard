import axios, { AxiosInstance } from "axios";

// Kantata (formerly Mavenlink) custom field IDs - resolved during Phase 0 discovery
// against the Deque Kantata account. These are stable per account.
const FIELD_OPS_PROJECT_TYPE = "936414";
const FIELD_PROJECT_BUDGET_TYPE = "929033";
const FIELD_SF_SALESFORCE_ID = "386615";

// Choice IDs for "Ops: Project Type"
const TYPE_CHOICE_IMPLEMENTATIONS = "5194763";

// Choice IDs for "Project Budget Type"
const BUDGET_CHOICE_TRUE_TM = "5048604";
const BUDGET_CHOICE_FF_TM_NAV = "5048605";
const BUDGET_CHOICE_FF_PLAN = "5048606";
const BUDGET_CHOICE_OTHER = "5048607";

const BUDGET_TYPE_LABELS: Record<string, string> = {
  [BUDGET_CHOICE_TRUE_TM]: "True T&M",
  [BUDGET_CHOICE_FF_TM_NAV]: "FF/T&M Nav",
  [BUDGET_CHOICE_FF_PLAN]: "FF Plan",
  [BUDGET_CHOICE_OTHER]: "Other",
};

export interface KantataConfig {
  apiToken: string;
  baseUrl?: string;
}

// The Kantata custom field "SF Salesforce ID" frequently holds a Lightning URL
// pointing to an Opportunity record (because projects are created off Opps),
// not the Account ID directly. We expose the parsed pieces so the route can
// resolve Opportunity → Account via SOQL.
export interface KantataSFRef {
  rawValue: string;          // original cell content (URL, ID, or anything)
  sfId: string | null;       // 15- or 18-char SF ID extracted from URL or value
  objectType: "Account" | "Opportunity" | "Other" | null;
}

export interface KantataProject {
  id: string;
  title: string;
  archived: boolean;
  startDate: string | null;
  dueDate: string | null;
  effectiveDueDate: string | null;
  budgetUsedInCents: number;
  priceInCents: number | null;
  budgetRemaining: string | null;
  overBudget: boolean;
  percentOfBudgetUsed: number;
  defaultRate: string | null;
  status: { color: string; key: number; message: string } | null;
  // Resolved from custom fields:
  sfRef: KantataSFRef | null;
  budgetTypeId: string | null;
  budgetTypeLabel: string | null;
  projectTypeIds: string[];
  // Source URL for opening in Kantata
  url: string;
}

function parseSfRef(raw: string | null): KantataSFRef | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  // Try to extract a SF 15/18-char ID. SF IDs are alphanumeric, exactly 15 or 18 chars.
  // Also try to detect object type from a Lightning URL like
  //   https://*.lightning.force.com/lightning/r/Opportunity/006xxxxxxxxxxxxxx/view
  let sfId: string | null = null;
  let objectType: KantataSFRef["objectType"] = null;

  const urlMatch = value.match(/lightning\/r\/([A-Za-z_]+)\/([A-Za-z0-9]{15,18})/);
  if (urlMatch) {
    objectType = (urlMatch[1] as KantataSFRef["objectType"]) === "Account" ? "Account"
              : (urlMatch[1] === "Opportunity" ? "Opportunity" : "Other");
    sfId = urlMatch[2];
  } else {
    // Bare ID? Standalone token of length 15 or 18, alphanumeric only.
    const idMatch = value.match(/\b([A-Za-z0-9]{15}|[A-Za-z0-9]{18})\b/);
    if (idMatch) sfId = idMatch[1];
  }

  // Infer object type from ID prefix when we don't have one yet.
  if (sfId && !objectType) {
    if (sfId.startsWith("001")) objectType = "Account";
    else if (sfId.startsWith("006")) objectType = "Opportunity";
    else objectType = "Other";
  }

  return { rawValue: value, sfId, objectType };
}

interface KantataWorkspaceResponse {
  results?: Array<{ key: string; id: string }>;
  count?: number;
  workspaces?: Record<string, RawWorkspace>;
  custom_field_values?: Record<string, RawCustomFieldValue>;
  meta?: { count: number; page_count: number; page_number: number };
}

interface RawWorkspace {
  id: string;
  title: string;
  archived: boolean;
  start_date: string | null;
  due_date: string | null;
  effective_due_date: string | null;
  budget_used_in_cents: number;
  price_in_cents: number | null;
  budget_remaining: string | null;
  over_budget: boolean;
  percent_of_budget_used: number;
  default_rate: string | null;
  status: { color: string; key: number; message: string } | null;
  custom_field_value_ids: string[];
}

interface RawCustomFieldValue {
  id: string;
  custom_field_id: string | number;
  custom_field_name: string;
  value: string | number | Array<string | number> | null;
}

export class KantataService {
  private client: AxiosInstance;

  constructor(config: KantataConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || "https://api.mavenlink.com/api/v1",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
      timeout: 30000,
    });
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; accountId?: string; error?: string }> {
    try {
      const r = await this.client.get("/users/me.json");
      const u = r.data.users && (Object.values(r.data.users)[0] as any);
      return { ok: true, user: u?.full_name, accountId: u?.account_id };
    } catch (e: any) {
      return { ok: false, error: e.response?.data?.errors?.[0]?.message || e.message };
    }
  }

  // Fetch active (non-archived) projects of type "Implementations".
  // The Kantata API does not reliably support filtering by custom-field choice
  // for multi-select fields via query params, so we page through all active
  // workspaces and filter client-side. Result is cached for 15 min upstream.
  async getActiveImplementationProjects(): Promise<KantataProject[]> {
    const all: KantataProject[] = [];
    let page = 1;
    const perPage = 200;
    const maxPages = 20; // safety bound: 4000 workspaces

    while (page <= maxPages) {
      const params = new URLSearchParams({
        per_page: String(perPage),
        page: String(page),
        archived: "false",
        include: "custom_field_values",
      });

      const { data } = await this.client.get<KantataWorkspaceResponse>(
        `/workspaces.json?${params.toString()}`
      );

      const cfvMap = data.custom_field_values || {};
      const workspaces = data.workspaces ? Object.values(data.workspaces) : [];
      if (workspaces.length === 0) break;

      for (const ws of workspaces) {
        all.push(this.mapWorkspace(ws, cfvMap));
      }
      if (workspaces.length < perPage) break;
      page++;
    }

    return all.filter((p) => p.projectTypeIds.includes(TYPE_CHOICE_IMPLEMENTATIONS));
  }

  private mapWorkspace(ws: RawWorkspace, cfvMap: Record<string, RawCustomFieldValue>): KantataProject {
    let sfRefRaw: string | null = null;
    let budgetTypeId: string | null = null;
    const projectTypeIds: string[] = [];

    for (const cfvId of ws.custom_field_value_ids || []) {
      const cfv = cfvMap[cfvId];
      if (!cfv) continue;
      // Kantata returns custom_field_id as a number; our constants are
      // strings — coerce both sides for safe equality.
      const fieldId = String(cfv.custom_field_id);
      if (fieldId === FIELD_SF_SALESFORCE_ID) {
        const v = Array.isArray(cfv.value) ? cfv.value[0] : cfv.value;
        sfRefRaw = v != null ? String(v) : null;
      } else if (fieldId === FIELD_PROJECT_BUDGET_TYPE) {
        const v = Array.isArray(cfv.value) ? cfv.value[0] : cfv.value;
        budgetTypeId = v != null ? String(v) : null;
      } else if (fieldId === FIELD_OPS_PROJECT_TYPE) {
        const vals = Array.isArray(cfv.value) ? cfv.value : cfv.value != null ? [cfv.value] : [];
        for (const v of vals) projectTypeIds.push(String(v));
      }
    }
    const sfRef = parseSfRef(sfRefRaw);

    return {
      id: ws.id,
      title: ws.title,
      archived: ws.archived,
      startDate: ws.start_date || null,
      dueDate: ws.due_date || null,
      effectiveDueDate: ws.effective_due_date || null,
      budgetUsedInCents: ws.budget_used_in_cents || 0,
      priceInCents: ws.price_in_cents,
      budgetRemaining: ws.budget_remaining,
      overBudget: !!ws.over_budget,
      percentOfBudgetUsed: ws.percent_of_budget_used || 0,
      defaultRate: ws.default_rate,
      status: ws.status || null,
      sfRef,
      budgetTypeId,
      budgetTypeLabel: budgetTypeId ? BUDGET_TYPE_LABELS[budgetTypeId] || null : null,
      projectTypeIds,
      url: `https://deque.mavenlink.com/workspaces/${ws.id}`,
    };
  }
}
