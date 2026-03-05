import { RenewalOpportunity as ApiRenewalOpportunity } from '../services/api';

export type RenewalMilestone = 'R-6+' | 'R-6' | 'R-4' | 'R-3' | 'R-2' | 'R-1' | 'R';

export interface Opportunity {
  id: string;
  opportunityName: string;
  companyName: string;
  accountId: string;
  productName: string;
  renewalDate: string;
  amount: number;
  stage: string;
  ownerName: string;
  ownerEmail: string;
  contactName?: string;
  contactEmail?: string;
  csmName?: string;
  csmEmail?: string;
  prsName?: string;
  prsEmail?: string;
  renewalStatus?: string;
  accountingRenewalStatus?: string;
  poRequired?: boolean;
  poReceivedDate?: string;
  atRisk?: boolean;
  r6Notes?: string;
  r3Notes?: string;
  accountingNotes?: string;
  leadershipNotes?: string;
}

export interface RequiredAction {
  type: string;
  priority: 'critical' | 'urgent' | 'high' | 'medium';
  description: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export type SortField = 'opportunityName' | 'productName' | 'stage' | 'amount' | 'renewalDate' | 'action' | 'companyName' | 'ownerName' | 'renewalStatus' | 'accountingRenewalStatus' | 'poRequired';
export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export type OverdueCategory = 'critical' | 'on-hold-sync' | 'on-hold-past-r';

export interface OverdueItem {
  opportunity: Opportunity;
  milestone: RenewalMilestone;
  action: RequiredAction;
  daysPastDue: number;
  dueDate: string; // ISO date string when the action should have been executed
  stageCategory?: OverdueCategory;
}

export function transformApiOpportunity(apiOpp: ApiRenewalOpportunity): Opportunity {
  return {
    id: apiOpp.id,
    opportunityName: apiOpp.name,
    companyName: apiOpp.accountName,
    accountId: apiOpp.accountId,
    productName: apiOpp.productName || 'axe DevTools',
    renewalDate: apiOpp.renewalDate,
    amount: apiOpp.amount,
    stage: apiOpp.stageName,
    ownerName: apiOpp.ownerName,
    ownerEmail: apiOpp.ownerEmail,
    contactName: apiOpp.contactName,
    contactEmail: apiOpp.contactEmail,
    csmName: apiOpp.csmName,
    csmEmail: apiOpp.csmEmail,
    prsName: apiOpp.prsName,
    prsEmail: apiOpp.prsEmail,
    renewalStatus: apiOpp.renewalStatus,
    accountingRenewalStatus: apiOpp.accountingRenewalStatus,
    poRequired: apiOpp.poRequired,
    poReceivedDate: apiOpp.poReceivedDate,
    atRisk: apiOpp.atRisk,
    r6Notes: apiOpp.r6Notes,
    r3Notes: apiOpp.r3Notes,
    accountingNotes: apiOpp.accountingNotes,
    leadershipNotes: apiOpp.leadershipNotes,
  };
}
