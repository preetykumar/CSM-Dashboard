// Shared "Draft Email" wiring for Renewal views.
//
// Returns three things callers compose into their JSX:
//   - openComposer:  callback (opp, action) => void, designed to be passed
//                    to <OpportunityCard onDraftEmail={...}> (or the
//                    RenewalAccountTree's onDraftEmail prop, which forwards
//                    to the card).
//   - composer:      JSX node to render at the bottom of the view. It's the
//                    EmailComposer modal, which renders nothing when closed.
//   - isOpen:        useful when a view wants to disable other UI while the
//                    modal is up.
//
// Template lookup: action.type is the RENEWAL_EMAIL_TEMPLATES key
// (SEND_EMAIL_1 / _2 / etc.). Actions that aren't email-shaped (e.g.
// SYNC_WITH_AE, MARK_READY_FOR_INVOICING) fall through to a null template;
// EmailComposer handles that by showing the template picker so the user can
// still draft something manually.

import { useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { EmailComposer } from "../components/renewal/EmailComposer";
import { RENEWAL_EMAIL_TEMPLATES } from "../services/email-templates";
import type { Opportunity, RequiredAction, EmailTemplate } from "../types/renewal";

export function useEmailComposer() {
  const { user } = useAuth();
  const userName = user?.name || user?.email?.split("@")[0] || "PRS User";

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const isOpen = opp !== null;

  const openComposer = useCallback((o: Opportunity, action: RequiredAction) => {
    setOpp(o);
    setTemplateKey(action.type);
  }, []);

  const close = useCallback(() => {
    setOpp(null);
    setTemplateKey(null);
  }, []);

  const template: EmailTemplate | null =
    templateKey && RENEWAL_EMAIL_TEMPLATES[templateKey]
      ? RENEWAL_EMAIL_TEMPLATES[templateKey]
      : null;

  const composer = isOpen ? (
    <EmailComposer
      template={template}
      templateKey={templateKey}
      opportunity={opp}
      prsName={userName}
      onClose={close}
    />
  ) : null;

  return { openComposer, composer, isOpen };
}
