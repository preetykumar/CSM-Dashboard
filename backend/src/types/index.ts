export interface ZendeskConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface TicketField {
  id: number;
  type: string;
  title: string;
  description?: string;
  active: boolean;
  custom_field_options?: Array<{
    id: number;
    name: string;
    value: string;
  }>;
}

export interface Ticket {
  id: number;
  url: string;
  subject?: string;
  description?: string;
  priority?: string;
  status: string;
  requester_id: number;
  submitter_id: number;
  assignee_id?: number;
  organization_id?: number;
  group_id?: number;
  tags?: string[];
  custom_fields?: Array<{
    id: number;
    value: any;
  }>;
  created_at: string;
  updated_at: string;
  // Enhanced fields
  product?: string;
  module?: string;
  ticket_type?: string;
  workflow_status?: string;
  issue_subtype?: string;
  is_escalated?: boolean;
}

export interface Organization {
  id: number;
  url: string;
  name: string;
  domain_names?: string[];
  details?: string;
  notes?: string;
  tags?: string[];
  organization_fields?: Record<string, any>; // Custom fields like salesforce_id
  salesforce_account_name?: string; // SF Account Name for display (from CSM sync)
  created_at: string;
  updated_at: string;
}

export interface OrganizationField {
  id: number;
  key: string;
  title: string;
  type: string;
  active: boolean;
}

export interface User {
  id: number;
  url: string;
  name: string;
  email: string;
  organization_id?: number;
  role: string;
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
  avgResolutionTime?: number;
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

export interface FieldMapping {
  productFieldId?: number;
  requestTypeFieldId?: number;
  productFieldName?: string;
  requestTypeFieldName?: string;
}

// CSM Portfolio types
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
  escalations: number;
}

export interface CSMPortfolio {
  csm: User;
  customers: CSMCustomerSummary[];
  totalTickets: number;
  openTickets: number;
  totalCustomers: number;
}

// Enhanced CSM Customer Summary types

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
    tickets: Ticket[]; // Feature tickets for drill-down
  };
  bugs: {
    total: number;
    open: number;
    fixed: number;
    blockers: number;
    tickets: Ticket[]; // Bug tickets for drill-down
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

// Extended field mapping for new custom fields
export interface ExtendedFieldMapping extends FieldMapping {
  moduleFieldId?: number;
  moduleFieldName?: string;
  ticketTypeFieldId?: number;
  ticketTypeFieldName?: string;
  workflowStatusFieldId?: number;
  workflowStatusFieldName?: string;
  issueSubtypeFieldId?: number;
  issueSubtypeFieldName?: string;
}

// GitHub Development Status types
export interface GitHubDevelopmentStatus {
  projectTitle?: string;
  projectStatus?: string; // "In Progress", "Done", "Backlog"
  sprint?: string; // "Sprint 24"
  milestone?: string; // "v5.0"
  releaseVersion?: string; // "5.0.0"
  githubUrl: string;
  repoName: string;
  issueNumber: number;
  updatedAt?: string;
}

export interface TicketWithGitHub extends Ticket {
  githubStatus?: GitHubDevelopmentStatus[];
}
