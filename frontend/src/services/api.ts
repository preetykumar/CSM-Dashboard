import type { CustomerSummary, DetailedCustomerSummary, Organization, Ticket, CSMPortfolio, EnhancedCustomerSummary, GitHubDevelopmentStatus } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

// Default fetch options for cross-origin requests with credentials
const fetchOptions: RequestInit = {
  credentials: "include",
};

export async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${API_BASE}/organizations`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch organizations");
  const data = await res.json();
  return data.organizations;
}

export async function fetchCustomerSummary(orgId: number): Promise<CustomerSummary> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/summary`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch customer summary");
  return res.json();
}

export async function fetchDetailedCustomerSummary(orgId: number): Promise<DetailedCustomerSummary> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/detailed`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch detailed customer summary");
  return res.json();
}

export async function fetchTicketsByStatus(orgId: number, status: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/tickets/status/${status}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function fetchTicketsByPriority(orgId: number, priority: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/tickets/priority/${priority}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function fetchAllSummaries(): Promise<CustomerSummary[]> {
  const res = await fetch(`${API_BASE}/organizations/summaries/all`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch customer summaries");
  const data = await res.json();
  return data.summaries;
}

export async function fetchTickets(): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/tickets`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function searchTickets(query: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/tickets/search?q=${encodeURIComponent(query)}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to search tickets");
  const data = await res.json();
  return data.tickets;
}

// CSM Portfolio APIs
export interface CSMPortfoliosResponse {
  portfolios: CSMPortfolio[];
  count: number;
  cached: boolean;
  isAdmin: boolean;
  filteredByUser: boolean;
}

export async function fetchCSMPortfolios(): Promise<CSMPortfoliosResponse> {
  const res = await fetch(`${API_BASE}/csm/portfolios`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch CSM portfolios");
  const data = await res.json();
  return data;
}

export async function fetchCSMPortfolio(csmId: number): Promise<CSMPortfolio> {
  const res = await fetch(`${API_BASE}/csm/portfolios/${csmId}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch CSM portfolio");
  return res.json();
}

// Enhanced Customer Summary API
export async function fetchEnhancedCustomerSummary(orgId: number): Promise<EnhancedCustomerSummary> {
  const res = await fetch(`${API_BASE}/csm/customers/${orgId}/summary`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch enhanced customer summary");
  return res.json();
}

export async function fetchTicketsByProductModule(
  orgId: number,
  product: string,
  module?: string
): Promise<Ticket[]> {
  const params = new URLSearchParams({ product });
  if (module) params.append("module", module);
  const res = await fetch(`${API_BASE}/csm/customers/${orgId}/tickets?${params}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

// Product-grouped tickets API
export interface ProductTicket {
  id: number;
  url: string;
  subject?: string;
  status: string;
  priority?: string;
  ticket_type?: string;
  is_escalated: boolean;
  product?: string;
  module?: string;
  issue_subtype?: string;
  workflow_status?: string;
  updated_at: string;
  created_at: string;
  organization_id: number;
  organization_name: string;
}

export interface ProductSubtype {
  subtype: string;
  tickets: ProductTicket[];
}

export interface ProductType {
  type: string;
  totalTickets: number;
  openTickets: number;
  subtypes: ProductSubtype[];
}

export interface ProductGroup {
  product: string;
  totalTickets: number;
  openTickets: number;
  types: ProductType[];
}

export interface ProductsResponse {
  products: ProductGroup[];
  totalProducts: number;
  totalTickets: number;
  cached: boolean;
}

export async function fetchProducts(): Promise<ProductsResponse> {
  const res = await fetch(`${API_BASE}/csm/products`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch products");
  return res.json();
}

// GitHub Development Status API
export async function fetchGitHubStatusForTickets(
  ticketIds: number[]
): Promise<Map<number, GitHubDevelopmentStatus[]>> {
  if (ticketIds.length === 0) {
    return new Map();
  }

  try {
    const res = await fetch(`${API_BASE}/github/tickets/status`, {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketIds }),
    });

    if (!res.ok) {
      console.warn("Failed to fetch GitHub statuses:", res.status);
      return new Map();
    }

    const data = await res.json();
    const linksMap = new Map<number, GitHubDevelopmentStatus[]>();

    if (data.links) {
      for (const [ticketId, statuses] of Object.entries(data.links)) {
        linksMap.set(parseInt(ticketId, 10), statuses as GitHubDevelopmentStatus[]);
      }
    }

    return linksMap;
  } catch (error) {
    console.warn("Error fetching GitHub statuses:", error);
    return new Map();
  }
}

// ==================
// Chat Agent APIs
// ==================

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  toolsUsed?: string[];
}

export interface ChatConversation {
  id: string;
  created_at: string;
  updated_at: string;
}

export async function sendChatMessage(
  message: string,
  conversationId?: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/agent/chat`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to send message" }));
    throw new Error(error.error || error.details || "Failed to send message");
  }
  return res.json();
}

export async function fetchChatConversations(): Promise<ChatConversation[]> {
  const res = await fetch(`${API_BASE}/agent/conversations`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  const data = await res.json();
  return data.conversations;
}

export async function fetchConversationHistory(conversationId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/agent/conversations/${conversationId}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch conversation history");
  const data = await res.json();
  return data.messages;
}

export async function deleteChatConversation(conversationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/agent/conversations/${conversationId}`, {
    ...fetchOptions,
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

// ==================
// Sync APIs (Admin only)
// ==================

export interface SyncStatusItem {
  type: string;
  last_sync: string;
  status: string;
  record_count: number;
  error_message: string | null;
}

export interface SyncStatus {
  status: SyncStatusItem[];
  inProgress: boolean;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${API_BASE}/sync/status`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch sync status");
  return res.json();
}

export async function triggerFullSync(): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/sync`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to trigger sync" }));
    throw new Error(error.error || "Failed to trigger sync");
  }
  return res.json();
}

// ==================
// Amplitude Usage Analytics APIs
// ==================

export interface AmplitudeProduct {
  name: string;
  slug: string;
  projectId: string;
}

export interface AmplitudeUsageDay {
  date: string;
  activeUsers: number;
  newUsers: number;
}

export interface AmplitudeUsageData {
  product: string;
  projectId: string;
  period: string;
  startDate: string;
  endDate: string;
  dailyUsage: AmplitudeUsageDay[];
  totalActiveUsers: number;
  totalNewUsers: number;
  topEvents: { eventType: string; count: number }[];
}

export interface AmplitudeUsageSummary {
  slug?: string;
  product: string;
  last7Days: { activeUsers: number; newUsers: number };
  last30Days: { activeUsers: number; newUsers: number };
  error?: string;
}

export async function fetchAmplitudeProducts(): Promise<AmplitudeProduct[]> {
  const res = await fetch(`${API_BASE}/amplitude/products`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch Amplitude products");
  const data = await res.json();
  return data.products;
}

export async function fetchAmplitudeUsage(productSlug: string, days: number = 30): Promise<AmplitudeUsageData> {
  const res = await fetch(`${API_BASE}/amplitude/usage/${productSlug}?days=${days}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch Amplitude usage data");
  return res.json();
}

export async function fetchAmplitudeUsageSummary(productSlug: string): Promise<AmplitudeUsageSummary> {
  const res = await fetch(`${API_BASE}/amplitude/summary/${productSlug}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch Amplitude usage summary");
  return res.json();
}

export async function fetchAllAmplitudeSummaries(): Promise<AmplitudeUsageSummary[]> {
  const res = await fetch(`${API_BASE}/amplitude/summary`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch Amplitude summaries");
  const data = await res.json();
  return data.summaries;
}

// Organization-filtered Amplitude APIs
export interface AmplitudeOrgUsageSummary extends AmplitudeUsageSummary {
  organization: string;
}

export interface AmplitudeOrgUsageResponse {
  organization: string;
  summaries: AmplitudeOrgUsageSummary[];
}

export async function fetchAmplitudeUsageByOrg(organization: string): Promise<AmplitudeOrgUsageResponse> {
  const res = await fetch(`${API_BASE}/amplitude/org/${encodeURIComponent(organization)}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch organization usage data");
  return res.json();
}

export async function fetchAmplitudeProductUsageByOrg(
  productSlug: string,
  organization: string,
  days: number = 30
): Promise<AmplitudeUsageData & { organization: string }> {
  const res = await fetch(
    `${API_BASE}/amplitude/usage/${productSlug}/org/${encodeURIComponent(organization)}?days=${days}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch organization product usage data");
  return res.json();
}

// ==================
// Salesforce License/Subscription APIs
// ==================

export interface EnterpriseSubscription {
  id: string;
  name: string;
  accountId: string;
  productType: string;
  licenseCount: number;
  assignedSeats: number;
  percentageAssigned: number;
  environment: string;
  type: string;
  startDate: string;
  endDate: string;
  monitorPageCount?: number;
  monitorProjectCount?: number;
}

export interface SubscriptionsResponse {
  subscriptions: EnterpriseSubscription[];
  count: number;
}

export async function fetchEnterpriseSubscriptionsByName(accountName: string): Promise<SubscriptionsResponse> {
  const res = await fetch(
    `${API_BASE}/salesforce/subscriptions/account/${encodeURIComponent(accountName)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch enterprise subscriptions");
  return res.json();
}

export interface AccountsWithSubscriptionsResponse {
  accountNames: string[];
  count: number;
}

export async function fetchAccountsWithSubscriptions(): Promise<AccountsWithSubscriptionsResponse> {
  const res = await fetch(`${API_BASE}/salesforce/accounts-with-subscriptions`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch accounts with subscriptions");
  return res.json();
}

// ==================
// Amplitude Quarterly Event Usage APIs
// ==================

export interface DomainUsageData {
  domain: string;
  uniqueUsers: number;
  eventCount: number;
}

export interface QuarterlyUsage {
  quarter: string;
  startDate: string;
  endDate: string;
  domains: DomainUsageData[];
  totalUniqueUsers: number;
  totalEventCount: number;
}

export interface QuarterlyEventUsageResponse {
  product: string;
  eventType: string;
  groupBy: string;
  currentQuarter: QuarterlyUsage;
  previousQuarter: QuarterlyUsage;
}

export async function fetchQuarterlyEventUsage(
  productSlug: string,
  eventType?: string,
  groupBy?: string
): Promise<QuarterlyEventUsageResponse> {
  const params = new URLSearchParams();
  if (eventType) params.append("event", eventType);
  if (groupBy) params.append("groupBy", groupBy);
  const queryString = params.toString();
  const url = `${API_BASE}/amplitude/events/${productSlug}/quarterly${queryString ? `?${queryString}` : ""}`;
  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch quarterly event usage");
  return res.json();
}

// ==================
// Domain to Account Mapping API
// ==================

export interface DomainMappingResponse {
  mapping: Record<string, string>;
  count: number;
}

export async function fetchDomainMapping(): Promise<DomainMappingResponse> {
  const res = await fetch(`${API_BASE}/organizations/domain-mapping`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch domain mapping");
  return res.json();
}
