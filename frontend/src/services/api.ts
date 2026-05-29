import type { CustomerSummary, DetailedCustomerSummary, Organization, Ticket, CSMPortfolio, CSMCustomerSummary, PMPortfolio, EnhancedCustomerSummary, GitHubDevelopmentStatus, ActiveProjectsResponse } from "../types";
import type { MockPortfolioAccount, HealthScore, HealthDimension, Role } from "../data/portfolioMocks";

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
  unassignedAccounts?: CSMCustomerSummary[];
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

// PM Portfolio APIs
export interface PMPortfoliosResponse {
  portfolios: PMPortfolio[];
  count: number;
  cached: boolean;
  isAdmin: boolean;
  filteredByUser: boolean;
}

export async function fetchPMPortfolios(): Promise<PMPortfoliosResponse> {
  const res = await fetch(`${API_BASE}/organizations/pm-portfolios`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch PM portfolios");
  const data = await res.json();
  return data;
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
    console.log("[GitHub API] No ticket IDs provided");
    return new Map();
  }

  try {
    console.log(`[GitHub API] Fetching statuses for ${ticketIds.length} tickets`);
    const res = await fetch(`${API_BASE}/github/tickets/status`, {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketIds }),
    });

    if (!res.ok) {
      console.warn("[GitHub API] Failed to fetch GitHub statuses:", res.status, res.statusText);
      return new Map();
    }

    const data = await res.json();
    console.log("[GitHub API] Response received, links count:", Object.keys(data.links || {}).length);

    const linksMap = new Map<number, GitHubDevelopmentStatus[]>();

    if (data.links) {
      for (const [ticketId, statuses] of Object.entries(data.links)) {
        linksMap.set(parseInt(ticketId, 10), statuses as GitHubDevelopmentStatus[]);
      }
    }

    return linksMap;
  } catch (error) {
    console.warn("[GitHub API] Error fetching GitHub statuses:", error);
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

export async function fetchActiveProjects(opts?: { force?: boolean }): Promise<ActiveProjectsResponse> {
  const url = `${API_BASE}/projects/active${opts?.force ? "?force=1" : ""}`;
  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch active projects");
  return res.json();
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

export async function triggerDeltaSync(): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/sync/delta`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to trigger delta sync" }));
    throw new Error(error.error || "Failed to trigger delta sync");
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
  enterpriseUuid?: string;
  enterpriseDomain?: string;
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

export async function fetchEnterpriseSubscriptionsById(accountId: string): Promise<SubscriptionsResponse> {
  const res = await fetch(
    `${API_BASE}/salesforce/subscriptions/id/${encodeURIComponent(accountId)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch enterprise subscriptions");
  return res.json();
}

// Fetch subscriptions by SF Account ID if available, fallback to name
export async function fetchEnterpriseSubscriptions(accountId?: string, accountName?: string): Promise<SubscriptionsResponse> {
  if (accountId) return fetchEnterpriseSubscriptionsById(accountId);
  if (accountName) return fetchEnterpriseSubscriptionsByName(accountName);
  throw new Error("Either accountId or accountName required");
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
  twoQuartersAgo: QuarterlyUsage;
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

// DevTools-specific metrics
export interface DevToolsDomainMetrics {
  domain: string;
  visitors: number;
  paidFeatureEvents: number;
}

export interface DevToolsMetricsResponse {
  product: string;
  period: string;
  domains: DevToolsDomainMetrics[];
}

export async function fetchDevToolsMetrics(productSlug: string, days: number = 30): Promise<DevToolsMetricsResponse> {
  const res = await fetch(`${API_BASE}/amplitude/devtools/${productSlug}/metrics?days=${days}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch DevTools metrics");
  return res.json();
}

// Quarterly product metrics
export interface QuarterlyMetrics {
  label: string;
  pageViews: number;
  timeSpentMinutes: number;
}

export interface QuarterlyProductMetricsResponse {
  product: string;
  currentQuarter: QuarterlyMetrics;
  previousQuarter: QuarterlyMetrics;
  twoQuartersAgo: QuarterlyMetrics;
}

export async function fetchQuarterlyProductMetrics(productSlug: string): Promise<QuarterlyProductMetricsResponse> {
  const res = await fetch(`${API_BASE}/amplitude/quarterly/${productSlug}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch quarterly product metrics");
  return res.json();
}

export async function fetchQuarterlyMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<QuarterlyProductMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/org/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch quarterly org metrics");
  return res.json();
}

// Quarterly login metrics
export interface QuarterlyLoginMetrics {
  label: string;
  uniqueLogins: number;
  totalLogins: number;
  paidFeatureUsers: number;
}

export interface QuarterlyLoginsResponse {
  product: string;
  organization: string;
  currentQuarter: QuarterlyLoginMetrics;
  previousQuarter: QuarterlyLoginMetrics;
  twoQuartersAgo: QuarterlyLoginMetrics;
}

export async function fetchQuarterlyLoginsByOrg(
  productSlug: string,
  organization: string
): Promise<QuarterlyLoginsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/logins/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch quarterly login metrics");
  return res.json();
}

// Account Portal quarterly metrics
export interface AccountPortalQuarterlyMetrics {
  label: string;
  jiraTestSuccess: number;
  uniqueLogins: number;
}

export interface AccountPortalMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: AccountPortalQuarterlyMetrics;
  previousQuarter: AccountPortalQuarterlyMetrics;
  twoQuartersAgo: AccountPortalQuarterlyMetrics;
}

export async function fetchAccountPortalMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<AccountPortalMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/account-portal/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch account portal metrics");
  return res.json();
}

// Axe Monitor quarterly metrics
export interface AxeMonitorQuarterlyMetrics {
  label: string;
  scansStarted: number;
  scanOverviewViews: number;
  issuesPageLoads: number;
  projectSummaryViews: number;
}

export interface AxeMonitorMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: AxeMonitorQuarterlyMetrics;
  previousQuarter: AxeMonitorQuarterlyMetrics;
  twoQuartersAgo: AxeMonitorQuarterlyMetrics;
}

export async function fetchAxeMonitorMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<AxeMonitorMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/axe-monitor/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch axe monitor metrics");
  return res.json();
}

// Axe DevTools Mobile quarterly metrics
export interface AxeDevToolsMobileQuarterlyMetrics {
  label: string;
  scansCreated: number;
  dashboardViews: number;
  resultsShared: number;
  totalIssuesFound: number;
  usersGettingResultsLocally: number;
}

export interface AxeDevToolsMobileMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: AxeDevToolsMobileQuarterlyMetrics;
  previousQuarter: AxeDevToolsMobileQuarterlyMetrics;
  twoQuartersAgo: AxeDevToolsMobileQuarterlyMetrics;
}

export async function fetchAxeDevToolsMobileMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<AxeDevToolsMobileMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/axe-devtools-mobile/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch axe devtools mobile metrics");
  return res.json();
}

// Axe Assistant quarterly metrics
export interface AxeAssistantQuarterlyMetrics {
  label: string;
  messagesSent: number;
}

export interface AxeAssistantMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: AxeAssistantQuarterlyMetrics;
  previousQuarter: AxeAssistantQuarterlyMetrics;
  twoQuartersAgo: AxeAssistantQuarterlyMetrics;
}

export async function fetchAxeAssistantMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<AxeAssistantMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/axe-assistant/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch axe assistant metrics");
  return res.json();
}

// Developer Hub quarterly metrics
export interface DeveloperHubQuarterlyMetrics {
  label: string;
  commits: number;
  scans: number;
  uniqueApiKeysRun: number;
}

export interface DeveloperHubMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: DeveloperHubQuarterlyMetrics;
  previousQuarter: DeveloperHubQuarterlyMetrics;
  twoQuartersAgo: DeveloperHubQuarterlyMetrics;
}

export async function fetchDeveloperHubMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<DeveloperHubMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/developer-hub/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch developer hub metrics");
  return res.json();
}

// Axe Reports quarterly metrics
export interface AxeReportsQuarterlyMetrics {
  label: string;
  usageChartViews: number;
  outcomesChartViews: number;
}

export interface AxeReportsMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: AxeReportsQuarterlyMetrics;
  previousQuarter: AxeReportsQuarterlyMetrics;
  twoQuartersAgo: AxeReportsQuarterlyMetrics;
}

export async function fetchAxeReportsMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<AxeReportsMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/axe-reports/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch axe reports metrics");
  return res.json();
}

// Deque University quarterly metrics
export interface DequeUniversityQuarterlyMetrics {
  label: string;
  pageViews: number;
}

export interface DequeUniversityMetricsResponse {
  product: string;
  organization: string;
  currentQuarter: DequeUniversityQuarterlyMetrics;
  previousQuarter: DequeUniversityQuarterlyMetrics;
  twoQuartersAgo: DequeUniversityQuarterlyMetrics;
}

export async function fetchDequeUniversityMetricsByOrg(
  productSlug: string,
  organization: string
): Promise<DequeUniversityMetricsResponse> {
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/deque-university/${encodeURIComponent(organization)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch deque university metrics");
  return res.json();
}

// Generic quarterly metrics (for products without custom metrics)
export interface GenericQuarterlyMetrics {
  label: string;
  eventCount: number;
  uniqueUsers: number;
}

export interface GenericMetricsResponse {
  product: string;
  organization: string;
  eventType: string;
  currentQuarter: GenericQuarterlyMetrics;
  previousQuarter: GenericQuarterlyMetrics;
  twoQuartersAgo: GenericQuarterlyMetrics;
}

export async function fetchGenericQuarterlyMetricsByOrg(
  productSlug: string,
  organization: string,
  eventType: string,
  orgProperty?: string
): Promise<GenericMetricsResponse> {
  const params = new URLSearchParams({ event: eventType });
  if (orgProperty) params.append("orgProperty", orgProperty);
  const res = await fetch(
    `${API_BASE}/amplitude/quarterly/${productSlug}/generic/${encodeURIComponent(organization)}?${params}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch generic quarterly metrics");
  return res.json();
}

// ==================
// Renewal Opportunities APIs
// ==================

export interface RenewalOpportunity {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  amount: number;
  stageName: string;
  renewalDate: string;
  type: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  createdDate: string;
  lastModifiedDate: string;
  productName?: string;
  contactName?: string;
  contactEmail?: string;
  // CSM from Account
  csmName?: string;
  csmEmail?: string;
  // PRS from Product Success object
  prsId?: string;
  prsName?: string;
  prsEmail?: string;
  // Additional renewal fields
  renewalStatus?: string;
  accountingRenewalStatus?: string;
  poRequired?: boolean;
  poReceivedDate?: string;
  atRisk?: boolean;
  r6Notes?: string;
  r3Notes?: string;
  accountingNotes?: string;
  leadershipNotes?: string;
  leadershipRiskStatus?: string;
}

export interface RenewalOpportunitiesResponse {
  opportunities: RenewalOpportunity[];
  count: number;
}

export async function fetchRenewalOpportunities(daysAhead: number = 180): Promise<RenewalOpportunitiesResponse> {
  const res = await fetch(`${API_BASE}/salesforce/renewals?days=${daysAhead}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch renewal opportunities");
  return res.json();
}

// ── User Preferences ─────────────────────────────────────────────────────────

export interface UserPreferences {
  email: string;
  role: string | null;
  calendly_url: string | null;
  calendly_token: string | null;
}

export async function fetchUserPreferences(): Promise<UserPreferences> {
  const res = await fetch(`${API_BASE}/user/preferences`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch user preferences");
  return res.json();
}

export async function saveUserPreferences(prefs: Partial<Omit<UserPreferences, "email">>): Promise<void> {
  const res = await fetch(`${API_BASE}/user/preferences`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Failed to save user preferences");
}

// ── Google Calendar ───────────────────────────────────────────────────────────

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { uri: string; entryPointType: string }[] };
  attendees?: { email: string; displayName?: string; responseStatus: string }[];
  status?: string;
}

export async function fetchCalendarEvents(date?: string): Promise<{ events: GoogleCalendarEvent[]; requiresReauth?: boolean; notAuthenticated?: boolean; error?: string }> {
  const params = date ? `?date=${date}` : "";
  const res = await fetch(`${API_BASE}/calendar/events${params}`, fetchOptions);
  if (res.status === 401) {
    // Not logged in — hide the widget silently
    return { events: [], notAuthenticated: true };
  }
  if (res.status === 403) {
    // Logged in but calendar scope not granted — prompt re-auth
    const data = await res.json();
    return { events: [], requiresReauth: true, error: data.error };
  }
  if (!res.ok) return { events: [], error: "Failed to fetch calendar events" };
  return res.json();
}

// ── Unified Amplitude Usage ──────────────────────────────────────────────────

export interface UnifiedEventMetric {
  event: string;
  label: string;
  metric: "uniques" | "totals";
  current: number;
  previous: number;
  twoAgo: number;
  labels: [string, string, string];
  error?: string;
}

export interface UnifiedProductMetrics {
  slug: string;
  displayName: string;
  events: UnifiedEventMetric[];
}

export interface UnifiedUsageResponse {
  orgIdentifier: string;
  products: Record<string, UnifiedProductMetrics>;
}

export async function fetchAggregateUsageMetrics(): Promise<UnifiedUsageResponse> {
  const res = await fetch(`${API_BASE}/amplitude/aggregate`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch aggregate usage metrics");
  return res.json();
}

export async function fetchUnifiedUsageMetrics(orgIdentifier: string, monitorDomain?: string, accountName?: string): Promise<UnifiedUsageResponse> {
  const queryParts: string[] = [];
  if (monitorDomain) queryParts.push(`monitorDomain=${encodeURIComponent(monitorDomain)}`);
  if (accountName) queryParts.push(`accountName=${encodeURIComponent(accountName)}`);
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  // Path param can't be empty — when no Enterprise UUID is known we still want to
  // fetch usage for products that use SF account name (passed via accountName query).
  const pathId = orgIdentifier && orgIdentifier.length > 0 ? orgIdentifier : "_";
  const res = await fetch(`${API_BASE}/amplitude/unified/${encodeURIComponent(pathId)}${query}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch unified usage metrics");
  return res.json();
}

// ── Product Users (per-product user list scoped to an SF account) ────────────

export interface ProductUserRow {
  keycloak_id: string;
  email: string | null;
  name: string | null;
  title: string | null;
  account_id: string | null;
  account_name: string | null;
  last_seen: string | null;
  event_count_90d: number;
  matched: boolean;
}

export interface RelatedAccount {
  account_id: string;
  account_name: string;
}

export interface ProductUsersResponse {
  productSlug: string;
  accountId: string;
  orgKeys: string[];
  relatedAccountIds?: string[];
  relatedAccounts?: RelatedAccount[];
  activeCount: number;
  inactiveCount: number;
  totalContactsAtAccount: number;
  users: ProductUserRow[];
  warning?: string;
}

export async function fetchProductUsers(
  productSlug: string,
  accountId: string,
  options: { orgKeys?: string[]; includeInactive?: boolean } = {}
): Promise<ProductUsersResponse> {
  const params: string[] = [];
  for (const k of options.orgKeys || []) params.push(`orgKey=${encodeURIComponent(k)}`);
  if (options.includeInactive) params.push("includeInactive=1");
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const res = await fetch(
    `${API_BASE}/usage/users/${encodeURIComponent(productSlug)}/${encodeURIComponent(accountId)}${query}`,
    fetchOptions
  );
  if (!res.ok) throw new Error("Failed to fetch product users");
  return res.json();
}

// ── Health Scores ───────────────────────────────────────────────────────────

export type Trend = "improving" | "worsening" | "flat" | null;

export interface HealthSignal {
  signal: "green" | "yellow" | "red";
  label: string;
  detail?: string;
  trend?: Trend;
  trendDetail?: string;
}

export interface DimensionScore {
  signal: "green" | "yellow" | "red";
  signals: HealthSignal[];
  trend?: Trend;
}

export interface HealthScoreResponse {
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

// In-memory frontend cache for health scores (avoids duplicate fetches across components)
const healthScoreCache = new Map<string, { data: HealthScoreResponse; expiresAt: number }>();
const HEALTH_CLIENT_TTL = 5 * 60 * 1000; // 5 minutes client-side

export async function fetchHealthScore(accountName: string): Promise<HealthScoreResponse> {
  const key = accountName.toLowerCase();
  const cached = healthScoreCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const res = await fetch(`${API_BASE}/health/${encodeURIComponent(accountName)}`, fetchOptions);
  if (!res.ok) throw new Error("Failed to fetch health score");
  const data: HealthScoreResponse = await res.json();
  healthScoreCache.set(key, { data, expiresAt: Date.now() + HEALTH_CLIENT_TTL });
  return data;
}

export async function fetchHealthScoresBatch(accountNames: string[]): Promise<Record<string, HealthScoreResponse>> {
  // Check client cache first, collect misses
  const results: Record<string, HealthScoreResponse> = {};
  const misses: string[] = [];

  for (const name of accountNames) {
    const key = name.toLowerCase();
    const cached = healthScoreCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      results[name] = cached.data;
    } else {
      misses.push(name);
    }
  }

  if (misses.length > 0) {
    const res = await fetch(`${API_BASE}/health/batch`, {
      ...fetchOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountNames: misses }),
    });
    if (res.ok) {
      const data = await res.json();
      for (const [name, score] of Object.entries(data.scores || {})) {
        const s = score as HealthScoreResponse;
        healthScoreCache.set(name.toLowerCase(), { data: s, expiresAt: Date.now() + HEALTH_CLIENT_TTL });
        results[name] = s;
      }
    }
  }

  return results;
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export interface PortfolioResponse {
  role: Role;
  email: string;
  accounts: MockPortfolioAccount[]; // backend PortfolioAccount aligns with this shape (joined.healthScore is null at this stage)
  totalCount: number;
  warnings: string[];
  tookMs?: number;
  resolvedMs?: number;
  cacheHit?: boolean;
}

export async function fetchPortfolio(role: Role, email: string): Promise<PortfolioResponse> {
  const params = new URLSearchParams({ role });
  if (email) params.set("email", email);
  const res = await fetch(`${API_BASE}/portfolio?${params}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to fetch portfolio: ${res.status}`);
  return res.json();
}

// ── Deployments tree ────────────────────────────────────────────────────────

export type DeploymentType = "cloud" | "on_prem";

export interface DeploymentProductNode {
  productLabel: string;
  productCode: string;
  deploymentType: DeploymentType;
  totalDepDollars: number;
  lineItems: Array<{ productCode: string; productName: string | null; totalPrice: number; quantity: number }>;
  plan: null;
}

export interface DeploymentOppKantata {
  workspaceId: string | null;
  title: string | null;
  budget: number | null;
  budgetUsed: number;
  budgetRemaining: string | null;
  overBudget: boolean;
  status: string | null;
  effectiveDueDate: string | null;
  url: string | null;
}

export interface DeploymentOppNode {
  oppId: string;
  oppName: string;
  closeDate: string | null;
  kantata: DeploymentOppKantata | null;
  products: DeploymentProductNode[];
  totalDepDollars: number;
}

export interface DeploymentCustomerNode {
  accountId: string;
  accountName: string;
  opps: DeploymentOppNode[];
  renderMode: "flat" | "by_opp";
  totalDepDollars: number;
  totalKantataBudget: number | null;
  oppCount: number;
  productCount: number;
  enterpriseUuid: string | null;
  zendeskOrgIds: number[];
  parentId: string | null;
  children: DeploymentCustomerNode[];
}

export interface DeploymentTreeResponse {
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
  tookMs?: number;
  resolvedMs?: number;
  cacheHit?: boolean;
}

export async function fetchDeploymentTree(role: "tsa", email: string): Promise<DeploymentTreeResponse> {
  const params = new URLSearchParams({ role, email });
  const res = await fetch(`${API_BASE}/deployments?${params}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to fetch deployments tree: ${res.status}`);
  return res.json();
}

// Single-account deployment summary used by the Customer drill-down's
// "Active Deployments" tab. Returns SF deploy opps with raw line items +
// the matching Kantata workspace per opp (1:1 per spike).
export interface AccountDeploymentOpp {
  oppId: string;
  oppName: string;
  closeDate: string | null;
  lineItems: Array<{
    productCode: string;
    productName: string | null;
    family: string | null;
    quantity: number;
    totalPrice: number;
  }>;
  kantata: DeploymentOppKantata | null;
}

export interface AccountDeploymentsResponse {
  accountId: string;
  opps: AccountDeploymentOpp[];
  oppCount: number;
  tookMs?: number;
  cacheHit?: boolean;
}

export async function fetchAccountDeployments(accountId: string): Promise<AccountDeploymentsResponse> {
  const res = await fetch(
    `${API_BASE}/deployments/account/${encodeURIComponent(accountId)}`,
    fetchOptions
  );
  if (!res.ok) throw new Error(`Failed to fetch account deployments: ${res.status}`);
  return res.json();
}

// ── Deployment Plans (Phase 3a) ──────────────────────────────────────────

export type PlanStatus = "not_started" | "in_progress" | "completed" | "paused";
export type ProgressStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "delayed"
  | "at_risk"
  | "blocked";

export interface DeploymentPlan {
  id: number;
  template_id: number;
  opportunity_id: string;
  opportunity_name: string | null;
  product: string;
  account_id: string;
  account_name: string | null;
  tsa_email: string | null;
  ie_email: string | null;
  status: PlanStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentPlanItem {
  id: number;
  plan_id: number;
  template_item_id: number | null;
  parent_id: number | null;
  item_id: string | null;
  position: number;
  activity_type: "milestone" | "epic" | "task";
  description: string;
  target_outcome: string | null;
  progress_status: ProgressStatus;
  notes: string | null;
  deque_responsible: string | null;
  customer_responsible: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_days: number | null;
  actual_days: number | null;
  updated_at: string;
}

export interface DeploymentPlanItemTree extends DeploymentPlanItem {
  children: DeploymentPlanItemTree[];
}

export async function listDeploymentPlans(filter?: {
  tsa_email?: string;
  ie_email?: string;
  account_id?: string;
  opportunity_id?: string;
}): Promise<DeploymentPlan[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter || {})) {
    if (v) params.set(k, v as string);
  }
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/deployments/plans${qs ? "?" + qs : ""}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to list plans: ${res.status}`);
  const data = await res.json();
  return data.plans;
}

export async function getDeploymentPlan(id: number): Promise<{
  plan: DeploymentPlan;
  items: DeploymentPlanItem[];
  tree: DeploymentPlanItemTree[];
  canEdit: boolean;
}> {
  const res = await fetch(`${API_BASE}/deployments/plans/${id}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to get plan: ${res.status}`);
  return res.json();
}

export async function createDeploymentPlan(body: {
  template_id: number;
  opportunity_id: string;
  opportunity_name?: string | null;
  product: string;
  account_id: string;
  account_name?: string | null;
  tsa_email?: string | null;
  ie_email?: string | null;
}): Promise<DeploymentPlan> {
  const res = await fetch(`${API_BASE}/deployments/plans`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to create plan: ${res.status}`);
  }
  const data = await res.json();
  return data.plan;
}

// Editable fields on a plan item. Pass only the fields you want to change.
// Empty string is treated as null on the server.
export type DeploymentPlanItemUpdate = Partial<{
  progress_status: ProgressStatus;
  description: string;
  target_outcome: string | null;
  notes: string | null;
  deque_responsible: string | null;
  customer_responsible: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_days: number | null;
  actual_days: number | null;
}>;

export async function updateDeploymentPlanItem(
  planId: number,
  itemId: number,
  updates: DeploymentPlanItemUpdate
): Promise<DeploymentPlanItem> {
  const res = await fetch(`${API_BASE}/deployments/plans/${planId}/items/${itemId}`, {
    ...fetchOptions,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to update item: ${res.status}`);
  }
  const data = await res.json();
  return data.item;
}

export async function addDeploymentPlanItem(
  planId: number,
  body: {
    parent_id: number | null;
    activity_type: "milestone" | "epic" | "task";
    description: string;
    item_id?: string | null;
    target_outcome?: string | null;
    notes?: string | null;
    deque_responsible?: string | null;
    customer_responsible?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    estimated_days?: number | null;
  }
): Promise<DeploymentPlanItem> {
  const res = await fetch(`${API_BASE}/deployments/plans/${planId}/items`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to add item: ${res.status}`);
  }
  const data = await res.json();
  return data.item;
}

export async function deleteDeploymentPlanItem(planId: number, itemId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/deployments/plans/${planId}/items/${itemId}`, {
    ...fetchOptions,
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to delete item: ${res.status}`);
  }
}

// Walk the account tree (parents + children) and collect distinct names suitable
// for /api/health/batch. We pass names, not IDs, because the health batch
// endpoint is keyed by accountName.
export function collectAccountNames(accounts: MockPortfolioAccount[]): string[] {
  const names = new Set<string>();
  const walk = (accs: MockPortfolioAccount[]) => {
    for (const a of accs) {
      if (a.name && a.name !== a.id) names.add(a.name);
      if (a.children?.length) walk(a.children);
    }
  };
  walk(accounts);
  return Array.from(names);
}

// Backend → frontend health shape. The backend returns a richer signal model
// (`DimensionScore.signal` + per-signal `detail`/`trend`); the frontend's
// wireframe types use `status` + `currentValue`/`thresholds`. We bridge here
// instead of changing the frontend types so existing CustomerCard +
// HealthDrilldown renderers work unmodified.
export function transformHealth(b: HealthScoreResponse): HealthScore {
  return {
    adoption: transformDim(b.adoption),
    engagement: transformDim(b.engagement),
    support: transformDim(b.support),
    manual: b.manualHealthScore
      ? {
          status: manualToStatus(b.manualHealthScore),
          note: b.manualHealthDescription || "",
        }
      : undefined,
  };
}

function transformDim(d: DimensionScore): HealthDimension {
  const trendMap: Record<string, "up" | "down" | "flat" | undefined> = {
    improving: "up",
    worsening: "down",
    flat: "flat",
  };
  return {
    status: d.signal,
    signals: d.signals.map((s) => ({
      name: s.label,
      currentValue: s.detail || "",
      status: s.signal,
      trend: s.trend ? trendMap[s.trend] : undefined,
      thresholds: "",
    })),
    calculationLogic: "",
  };
}

function manualToStatus(raw: string): "good" | "ok" | "at-risk" {
  const s = raw.toLowerCase();
  if (s.includes("good") || s.includes("green") || s === "healthy") return "good";
  if (s.includes("risk") || s.includes("red") || s === "at-risk") return "at-risk";
  return "ok";
}

// Immutable merge of a name→HealthScore map into the account tree. Used after
// the lazy /api/health/batch fetch resolves to update the rendered portfolio.
export function applyHealthScores(
  accounts: MockPortfolioAccount[],
  healthByName: Map<string, HealthScore>
): MockPortfolioAccount[] {
  return accounts.map((a) => {
    const next: MockPortfolioAccount = {
      ...a,
      joined: {
        ...a.joined,
        healthScore: healthByName.get(a.name) ?? a.joined.healthScore ?? null,
      },
    };
    if (a.children?.length) next.children = applyHealthScores(a.children, healthByName);
    return next;
  });
}

// ── Calendly ─────────────────────────────────────────────────────────────────

// ── Admin: Deployment Templates ──────────────────────────────────────────────

export type AdminDeploymentType = "cloud" | "on_prem";
export type AdminActivityType = "milestone" | "epic" | "task";

export interface AdminTemplate {
  id: number;
  product: string;
  deployment_type: AdminDeploymentType;
  name: string;
  version: number;
  is_active: boolean;
  description: string | null;
  source_file: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface AdminTemplateItem {
  id: number;
  template_id: number;
  parent_id: number | null;
  item_id: string;
  position: number;
  activity_type: AdminActivityType;
  description: string;
  target_outcome: string | null;
  default_deque_role: string | null;
  default_estimated_days: number | null;
  notes: string | null;
}

export interface AdminTemplateItemTree extends AdminTemplateItem {
  children: AdminTemplateItemTree[];
}

const ADMIN_BASE = `${API_BASE}/admin/deployment-templates`;

export async function listAdminTemplates(filter?: {
  product?: string;
  deployment_type?: AdminDeploymentType;
  is_active?: boolean;
}): Promise<AdminTemplate[]> {
  const params = new URLSearchParams();
  if (filter?.product) params.set("product", filter.product);
  if (filter?.deployment_type) params.set("deployment_type", filter.deployment_type);
  if (filter?.is_active !== undefined) params.set("is_active", String(filter.is_active));
  const qs = params.toString();
  const res = await fetch(`${ADMIN_BASE}${qs ? "?" + qs : ""}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to list templates: ${res.status}`);
  const data = await res.json();
  return data.templates;
}

export async function getAdminTemplate(id: number): Promise<{
  template: AdminTemplate;
  items: AdminTemplateItem[];
  tree: AdminTemplateItemTree[];
}> {
  const res = await fetch(`${ADMIN_BASE}/${id}`, fetchOptions);
  if (!res.ok) throw new Error(`Failed to get template ${id}: ${res.status}`);
  return res.json();
}

export async function updateAdminTemplate(
  id: number,
  updates: { name?: string; description?: string | null; is_active?: boolean }
): Promise<AdminTemplate> {
  const res = await fetch(`${ADMIN_BASE}/${id}`, {
    ...fetchOptions,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update template ${id}: ${res.status}`);
  const data = await res.json();
  return data.template;
}

export async function addAdminTemplateItem(
  templateId: number,
  item: {
    item_id: string;
    activity_type: AdminActivityType;
    description: string;
    parent_id?: number | null;
    target_outcome?: string | null;
    default_deque_role?: string | null;
    default_estimated_days?: number | null;
    notes?: string | null;
  }
): Promise<number> {
  const res = await fetch(`${ADMIN_BASE}/${templateId}/items`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to add item: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.id;
}

export async function updateAdminTemplateItem(
  templateId: number,
  itemId: number,
  updates: Partial<{
    item_id: string;
    parent_id: number | null;
    position: number;
    activity_type: AdminActivityType;
    description: string;
    target_outcome: string | null;
    default_deque_role: string | null;
    default_estimated_days: number | null;
    notes: string | null;
  }>
): Promise<void> {
  const res = await fetch(`${ADMIN_BASE}/${templateId}/items/${itemId}`, {
    ...fetchOptions,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update item: ${res.status} ${err}`);
  }
}

export async function deleteAdminTemplateItem(
  templateId: number,
  itemId: number
): Promise<void> {
  const res = await fetch(`${ADMIN_BASE}/${templateId}/items/${itemId}`, {
    ...fetchOptions,
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete item: ${res.status}`);
}

