export interface Ticket {
  id: number;
  url?: string;
  subject?: string;
  description?: string;
  priority?: string;
  status: string;
  requester_id: number;
  assignee_id?: number;
  organization_id?: number;
  tags?: string[];
  created_at: string;
  updated_at: string;
  // Enhanced fields
  product?: string;
  module?: string;
  ticket_type?: string; // 'bug', 'feature', or 'other'
  workflow_status?: string;
}

export interface Organization {
  id: number;
  name: string;
  domain_names?: string[];
  salesforce_account_name?: string; // SF Account Name for display
  created_at: string;
  updated_at: string;
}

export interface CustomerSummary {
  organization: Organization;
  ticketStats: {
    total: number;
    new: number;
    open: number;
    pending: number;
    hold: number;
    solved: number;
    closed: number;
  };
  priorityBreakdown: {
    low: number;
    normal: number;
    high: number;
    urgent: number;
  };
  recentTickets: Ticket[];
}

export interface ProductStats {
  product: string;
  total: number;
  featureRequests: number;
  problemReports: number;
  other: number;
  openTickets: number;
  tickets: Ticket[];
}

export interface DetailedCustomerSummary extends CustomerSummary {
  productBreakdown: ProductStats[];
  requestTypeBreakdown: {
    featureRequests: number;
    problemReports: number;
    other: number;
  };
}

// CSM Portfolio types
export interface User {
  id: number;
  name: string;
  email: string;
  organization_id?: number;
  role: string;
}

export interface CSMCustomerSummary {
  organization: Organization;
  tickets: Ticket[];
  ticketStats: {
    total: number;
    new: number;
    open: number;
    pending: number;
    hold: number;
    solved: number;
    closed: number;
  };
  priorityBreakdown: {
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  featureRequests: number;
  problemReports: number;
}

export interface CSMPortfolio {
  csm: User;
  customers: CSMCustomerSummary[];
  totalTickets: number;
  openTickets: number;
  totalCustomers: number;
}

// Enhanced Customer Summary types

export interface VelocitySnapshot {
  closedThisMonth: number;
  bugsFixed: number;
  featuresCompleted: number;
  period: string; // e.g., "January 2026"
}

export interface QuarterlySummary {
  quarter: string; // e.g., "Q1 2026"
  period: string; // e.g., "Jan - Mar 2026"
  totalClosed: number;
  bugsFixed: number;
  featuresCompleted: number;
  otherClosed: number;
}

export interface ModuleSummary {
  moduleName: string;
  status: string; // "In Progress", "Backlogged", etc.
  features: {
    completed: number;
    total: number;
  };
  bugHealth: {
    criticalFixed: number;
    minorPending: number;
    blockers: number;
  };
  tickets: Ticket[];
}

export interface ProductBacklog {
  productName: string;
  modules: ModuleSummary[];
  totalOpenTickets: number;
}

export interface EnhancedCustomerSummary {
  organization: Organization;
  velocity: VelocitySnapshot;
  currentQuarter: QuarterlySummary;
  previousQuarter: QuarterlySummary;
  backlog: ProductBacklog[];
}
