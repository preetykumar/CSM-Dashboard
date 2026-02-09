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
