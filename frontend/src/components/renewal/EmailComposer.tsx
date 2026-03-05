import React, { useState, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import type { EmailTemplate, Opportunity } from '../../types/renewal';
import { RENEWAL_EMAIL_TEMPLATES, getTemplateOptions } from '../../services/email-templates';
import { formatCurrency } from '../../utils/format';

interface EmailComposerProps {
  template: EmailTemplate | null;
  opportunity: Opportunity | null;
  prsName: string;
  onClose: () => void;
  readOnly?: boolean;
}

export const EmailComposer: React.FC<EmailComposerProps> = ({
  template,
  opportunity,
  prsName,
  onClose,
  readOnly = false
}) => {
  const [subject, setSubject] = useState(template?.subject || '');
  const [body, setBody] = useState(template?.body || '');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('');

  useEffect(() => {
    if (template && opportunity) {
      processTemplate(template);
    }
  }, [template, opportunity, prsName]);

  function processTemplate(tmpl: EmailTemplate) {
    if (!opportunity) return;

    let processedSubject = tmpl.subject;
    let processedBody = tmpl.body;

    const formattedRenewalDate = opportunity.renewalDate
      ? new Date(opportunity.renewalDate).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : 'TBD';

    const invoiceNumber = `INV-${opportunity.id.substring(0, 8).toUpperCase()}`;

    const replacements: Record<string, string | number> = {
      '{{contact_name}}': opportunity.contactName || opportunity.ownerName || 'Customer',
      '{{product_name}}': opportunity.productName || 'axe DevTools',
      '{{renewal_date}}': formattedRenewalDate,
      '{{prs_name}}': prsName,
      '{{amount}}': opportunity.amount ? formatCurrency(opportunity.amount) : 'As quoted',
      '{{company_name}}': opportunity.companyName,
      '{{invoice_number}}': invoiceNumber,
      '{{due_date}}': formattedRenewalDate,
      '{{ae_name}}': opportunity.ownerName || 'your Account Executive'
    };

    Object.entries(replacements).forEach(([key, value]) => {
      processedSubject = processedSubject.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), String(value));
      processedBody = processedBody.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), String(value));
    });

    setSubject(processedSubject);
    setBody(processedBody);
  }

  const handleTemplateChange = (templateKey: string) => {
    setSelectedTemplateKey(templateKey);
    const tmpl = RENEWAL_EMAIL_TEMPLATES[templateKey];
    if (tmpl) {
      processTemplate(tmpl);
    }
  };

  const toEmail = opportunity?.contactEmail || opportunity?.ownerEmail || '';
  const toName = opportunity?.contactName || opportunity?.ownerName || 'Customer';

  return (
    <div className="renewal-email-modal">
      <div className="renewal-email-content">
        <div className="renewal-email-header">
          <h3 className="renewal-email-title">{readOnly ? 'Email Preview' : 'Draft Email'}</h3>
          <button onClick={onClose} className="renewal-close-btn">
            <X size={20} />
          </button>
        </div>
        <div className="renewal-email-body">
          {!readOnly && (
            <div className="renewal-email-field">
              <label>Template</label>
              <select
                value={selectedTemplateKey}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="renewal-email-input"
              >
                <option value="">-- Select a template --</option>
                {getTemplateOptions().map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="renewal-email-field">
            <label>To</label>
            <input
              type="text"
              value={toEmail ? `${toName} <${toEmail}>` : 'No email address on file'}
              readOnly
              className="renewal-email-input readonly"
            />
          </div>
          <div className="renewal-email-field">
            <label>From</label>
            <input
              type="text"
              value={`${prsName} <${prsName.toLowerCase().replace(/\s+/g, '.')}@deque.com>`}
              readOnly
              className="renewal-email-input readonly"
            />
          </div>
          <div className="renewal-email-field">
            <label>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              readOnly={readOnly}
              className={`renewal-email-input ${readOnly ? 'readonly' : ''}`}
            />
          </div>
          <div className="renewal-email-field">
            <label>Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              readOnly={readOnly}
              className={`renewal-email-textarea ${readOnly ? 'readonly' : ''}`}
            />
          </div>
        </div>
        <div className="renewal-email-footer">
          <button className="renewal-btn secondary" onClick={onClose}>
            Close
          </button>
          {!readOnly && toEmail && (
            <a
              className="renewal-btn primary"
              href={`mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Send size={16} /> Open in Email Client
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
