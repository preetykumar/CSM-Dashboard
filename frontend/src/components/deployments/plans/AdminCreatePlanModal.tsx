// Admin escape-hatch for creating a plan when the normal "ready to plan"
// row isn't available (the actor isn't the TSA on the opp, the SF data
// hasn't synced, the opp is parked under a parent customer not in the
// admin's portfolio, etc).
//
// Reuses the same POST /api/deployments/plans endpoint; just exposes every
// field as a text/select input.

import { useEffect, useMemo, useState } from "react";
import {
  listAdminTemplates,
  createDeploymentPlan,
  type AdminTemplate,
  type DeploymentPlan,
} from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import { Button, LoadingRow } from "../../ui";

interface Props {
  onClose: () => void;
  onCreated: (plan: DeploymentPlan) => void;
}

// Products supported by the create flow — the seed templates cover these.
const PRODUCT_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: "axe-monitor", label: "axe Monitor" },
  { slug: "axe-devtools", label: "axe DevTools" },
  { slug: "axe-reports", label: "axe Reports" },
  { slug: "axe-account-portal", label: "axe Accounts" },
  { slug: "axe-assistant", label: "axe Assistant" },
  { slug: "deque-university", label: "Deque University" },
];

export function AdminCreatePlanModal({ onClose, onCreated }: Props) {
  const { user } = useAuth();

  const [allTemplates, setAllTemplates] = useState<AdminTemplate[] | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [opportunityName, setOpportunityName] = useState("");
  const [productSlug, setProductSlug] = useState(PRODUCT_OPTIONS[0].slug);
  const [deploymentType, setDeploymentType] = useState<"cloud" | "on_prem">("cloud");
  const [tsaEmail, setTsaEmail] = useState(user?.email || "");
  const [ieEmail, setIeEmail] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminTemplates({ is_active: true })
      .then((data) => {
        if (cancelled) return;
        setAllTemplates(data);
        setLoadingTemplates(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load templates");
        setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Narrow templates by product + deployment_type. Auto-select first.
  const candidates = useMemo(() => {
    if (!allTemplates) return [];
    return allTemplates.filter(
      (t) => t.product === productSlug && t.deployment_type === deploymentType
    );
  }, [allTemplates, productSlug, deploymentType]);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    const stillValid = candidates.some((c) => c.id === selectedTemplateId);
    if (!stillValid) setSelectedTemplateId(candidates[0].id);
  }, [candidates, selectedTemplateId]);

  const canSubmit =
    accountId.trim() &&
    opportunityId.trim() &&
    selectedTemplateId &&
    !submitting;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // The POST endpoint expects `product` to match what the picker uses —
      // the seed flow passes the SF product label (e.g. "axe Monitor") but
      // the duplicate-detection key is just (opp_id, product), so either
      // form is fine as long as we're consistent. We pass the slug so it
      // round-trips cleanly back into the templates dropdown.
      const plan = await createDeploymentPlan({
        template_id: selectedTemplateId!,
        opportunity_id: opportunityId.trim(),
        opportunity_name: opportunityName.trim() || null,
        product: productSlug,
        account_id: accountId.trim(),
        account_name: accountName.trim() || null,
        tsa_email: tsaEmail.trim() || null,
        ie_email: ieEmail.trim() || null,
      });
      onCreated(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create plan");
      setSubmitting(false);
    }
  };

  return (
    <div className="template-picker-overlay" onClick={onClose}>
      <div
        className="template-picker-modal admin-create-plan-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="template-picker-header">
          <h2>Admin: Create Plan Manually</h2>
          <button
            type="button"
            className="template-picker-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="template-picker-body">
          <p className="admin-create-plan-help">
            Admin escape-hatch. The normal create flow auto-suggests opps from
            your TSA-assigned deployment tree — use this form when you need to
            create a plan outside that scope (e.g. for testing, or on behalf of
            another TSA).
          </p>

          <div className="admin-create-plan-grid">
            <label>
              SF Account ID *
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="001..."
              />
            </label>
            <label>
              Account name
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Used for display only"
              />
            </label>
            <label>
              SF Opportunity ID *
              <input
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                placeholder="006..."
              />
            </label>
            <label>
              Opportunity name
              <input
                value={opportunityName}
                onChange={(e) => setOpportunityName(e.target.value)}
                placeholder="Used for display only"
              />
            </label>
            <label>
              Product *
              <select value={productSlug} onChange={(e) => setProductSlug(e.target.value)}>
                {PRODUCT_OPTIONS.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              Deployment type *
              <select
                value={deploymentType}
                onChange={(e) => setDeploymentType(e.target.value as "cloud" | "on_prem")}
              >
                <option value="cloud">SaaS / Cloud</option>
                <option value="on_prem">On-Premises</option>
              </select>
            </label>
            <label>
              TSA email
              <input
                type="email"
                value={tsaEmail}
                onChange={(e) => setTsaEmail(e.target.value)}
                placeholder="who.owns@deque.com"
              />
            </label>
            <label>
              IE email
              <input
                type="email"
                value={ieEmail}
                onChange={(e) => setIeEmail(e.target.value)}
                placeholder="ie@deque.com"
              />
            </label>
            <label className="admin-create-plan-full">
              Template *
              {loadingTemplates ? (
                <LoadingRow>Loading templates…</LoadingRow>
              ) : candidates.length === 0 ? (
                <div className="template-picker-empty">
                  No active{" "}
                  <strong>{deploymentType === "cloud" ? "Cloud" : "On-Prem"}</strong>{" "}
                  template for <strong>{productSlug}</strong>. Try switching deployment
                  type, or seed/activate a template in Admin → Deployment Templates.
                </div>
              ) : (
                <select
                  value={selectedTemplateId || ""}
                  onChange={(e) => setSelectedTemplateId(parseInt(e.target.value, 10))}
                >
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (v{t.version})
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>

          {error && <div className="template-picker-error">{error}</div>}
        </div>

        <div className="template-picker-footer">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
