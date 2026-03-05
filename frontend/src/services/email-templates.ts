import type { EmailTemplate } from '../types/renewal';

// 6 email templates matching the documented renewal process
// (Proposal: Change to Subscription Renewal Process)
export const RENEWAL_EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  // Email #1 (R-6): Usage check-in, verify renewal contact
  SEND_EMAIL_1: {
    subject: 'Upcoming Renewal - Usage Summary & Contact Verification',
    body: `Dear {{contact_name}},

I hope this message finds you well. I'm reaching out regarding the upcoming renewal for {{product_name}} at {{company_name}}.

Your current subscription is set to renew on {{renewal_date}}. Below is a summary of your current usage:

Product: {{product_name}}
Renewal Amount: {{amount}}
Renewal Date: {{renewal_date}}

I'd like to verify that you are the correct contact for this renewal. If there is another person who should be involved in the renewal process, please let me know and I'll reach out to them directly.

Your Account Executive, {{ae_name}}, is also available to assist with any questions about your account.

Please feel free to reach out if you have any questions about your subscription or usage.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  },

  // Email #2 (R-3/R-4): Quote with PO request
  SEND_EMAIL_2: {
    subject: 'Renewal Quote - PO Request for {{product_name}}',
    body: `Dear {{contact_name}},

Please find attached the renewal quote for {{product_name}} at {{company_name}}.

Renewal Details:
Product: {{product_name}}
Amount: {{amount}}
Renewal Date: {{renewal_date}}

To process this renewal, we will need a Purchase Order (PO) number. Could you please forward this quote to your procurement team and provide us with a PO number at your earliest convenience?

If a PO is not required for your organization, please let us know and we will proceed with generating the invoice directly.

If you have any questions about the quote or need any modifications, please don't hesitate to reach out.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  },

  // Email #3 (R-3 + 1 week): Reminder to procurement for PO
  SEND_EMAIL_3: {
    subject: 'Reminder: PO Required for {{product_name}} Renewal',
    body: `Dear {{contact_name}},

This is a friendly reminder regarding the renewal quote we sent for {{product_name}} at {{company_name}}.

We are still awaiting a Purchase Order (PO) number to proceed with the renewal. Could you please check with your procurement team on the status?

Renewal Details:
Product: {{product_name}}
Amount: {{amount}}
Renewal Date: {{renewal_date}}

Timely processing of the PO will help ensure there is no interruption to your service.

Please let us know if you have any questions or if there's anything we can do to help expedite the process.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  },

  // Email #4 (R-3 + 2 weeks): URGENT action required
  SEND_EMAIL_4: {
    subject: 'URGENT: Action Required - {{product_name}} Renewal PO',
    body: `Dear {{contact_name}},

We urgently need your attention regarding the {{product_name}} renewal for {{company_name}}.

We have been unable to obtain a Purchase Order (PO) number for the following renewal:

Product: {{product_name}}
Amount: {{amount}}
Renewal Date: {{renewal_date}}

Without a PO, we cannot process the invoice for your renewal. This may result in a delay in invoicing and could potentially lead to a lapse in service.

Please provide the PO number or contact us immediately if there are any issues preventing you from processing this renewal.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  },

  // R-1 Email: Payment reminder with service disruption warning
  SEND_R1_EMAIL: {
    subject: 'Payment Reminder - Service Disruption Warning',
    body: `Dear {{contact_name}},

This is an important reminder regarding your {{product_name}} subscription renewal at {{company_name}}.

Your renewal date is {{renewal_date}}, which is approximately one month away. We have not yet received confirmation of payment.

Renewal Details:
Product: {{product_name}}
Amount: {{amount}}
Renewal Date: {{renewal_date}}

Please ensure payment is processed promptly to avoid any disruption to your service. If you are having difficulty, please reach out to your Account Executive, {{ae_name}}, for assistance.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  },

  // R Email: Final reminder with 30-day grace period
  SEND_R_EMAIL: {
    subject: 'FINAL: 30-Day Grace Period - Immediate Payment Required',
    body: `Dear {{contact_name}},

Your {{product_name}} subscription for {{company_name}} has reached its renewal date of {{renewal_date}} and payment has not been received.

A 30-day grace period is now in effect. Service will be disrupted at the end of this grace period if payment is not received.

Renewal Details:
Product: {{product_name}}
Amount: {{amount}}
Renewal Date: {{renewal_date}}

Please take immediate action to process payment and avoid any interruption to your service. Your Account Executive, {{ae_name}}, has been informed of this status.

If you are experiencing any difficulties, please contact us immediately.

Best regards,
{{prs_name}}
Product Renewal Specialist
Deque Systems`
  }
};

// Get the appropriate template key for an action type
export function getTemplateForAction(actionType: string): string | null {
  if (actionType in RENEWAL_EMAIL_TEMPLATES) {
    return actionType;
  }
  return null;
}

// Get all available template keys with labels
export function getTemplateOptions(): { key: string; label: string }[] {
  return [
    { key: 'SEND_EMAIL_1', label: 'Email #1 (R-6): Usage Check-in' },
    { key: 'SEND_EMAIL_2', label: 'Email #2 (R-3): Quote & PO Request' },
    { key: 'SEND_EMAIL_3', label: 'Email #3 (R-3+1wk): PO Reminder' },
    { key: 'SEND_EMAIL_4', label: 'Email #4 (R-3+2wk): Urgent PO' },
    { key: 'SEND_R1_EMAIL', label: 'R-1 Email: Payment Reminder' },
    { key: 'SEND_R_EMAIL', label: 'R Email: Final Grace Period' },
  ];
}
