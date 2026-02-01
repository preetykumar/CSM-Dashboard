import type { CustomerSummary, DetailedCustomerSummary, Organization, Ticket, CSMPortfolio, EnhancedCustomerSummary } from "../types";

const API_BASE = "/api";

export async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${API_BASE}/organizations`);
  if (!res.ok) throw new Error("Failed to fetch organizations");
  const data = await res.json();
  return data.organizations;
}

export async function fetchCustomerSummary(orgId: number): Promise<CustomerSummary> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/summary`);
  if (!res.ok) throw new Error("Failed to fetch customer summary");
  return res.json();
}

export async function fetchDetailedCustomerSummary(orgId: number): Promise<DetailedCustomerSummary> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/detailed`);
  if (!res.ok) throw new Error("Failed to fetch detailed customer summary");
  return res.json();
}

export async function fetchTicketsByStatus(orgId: number, status: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/tickets/status/${status}`);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function fetchTicketsByPriority(orgId: number, priority: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/tickets/priority/${priority}`);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function fetchAllSummaries(): Promise<CustomerSummary[]> {
  const res = await fetch(`${API_BASE}/organizations/summaries/all`);
  if (!res.ok) throw new Error("Failed to fetch customer summaries");
  const data = await res.json();
  return data.summaries;
}

export async function fetchTickets(): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/tickets`);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}

export async function searchTickets(query: string): Promise<Ticket[]> {
  const res = await fetch(`${API_BASE}/tickets/search?q=${encodeURIComponent(query)}`);
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
  const res = await fetch(`${API_BASE}/csm/portfolios`);
  if (!res.ok) throw new Error("Failed to fetch CSM portfolios");
  const data = await res.json();
  return data;
}

export async function fetchCSMPortfolio(csmId: number): Promise<CSMPortfolio> {
  const res = await fetch(`${API_BASE}/csm/portfolios/${csmId}`);
  if (!res.ok) throw new Error("Failed to fetch CSM portfolio");
  return res.json();
}

// Enhanced Customer Summary API
export async function fetchEnhancedCustomerSummary(orgId: number): Promise<EnhancedCustomerSummary> {
  const res = await fetch(`${API_BASE}/csm/customers/${orgId}/summary`);
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
  const res = await fetch(`${API_BASE}/csm/customers/${orgId}/tickets?${params}`);
  if (!res.ok) throw new Error("Failed to fetch tickets");
  const data = await res.json();
  return data.tickets;
}
