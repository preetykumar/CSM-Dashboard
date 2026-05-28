// Template picker — modal that opens when the TSA clicks "Create plan"
// for a specific (opp, product). Auto-suggests the matching active
// template (by product + likely deployment_type), lets them override or
// pick another, then POSTs to create the plan.
//
// Phase 3a: deployment_type is inferred from the product code suffix per
// the Phase 1 spike (-ONPREM/-PRIVCLOUD/-OFFLINE → on_prem; else cloud).
// Until we surface the per-line-item code here we just default to "cloud"
// and let the TSA flip.

import { useEffect, useMemo, useState } from "react";
import {
  listAdminTemplates,
  createDeploymentPlan,
  type AdminTemplate,
  type DeploymentPlan,
} from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import { Button, LoadingRow, Badge } from "../../ui";

interface Props {
  opportunityId: string;
  opportunityName: string;
  product: string;          // e.g. "axe Monitor" — admin templates store
                            // product as "axe-monitor". Both forms are
                            // matched leniently.
  accountId: string;
  accountName: string;
  onClose: () => void;
  onCreated: (plan: DeploymentPlan) => void;
}

// Normalize for matching. "axe Monitor" / "axe-monitor" / "AxeMonitor" all
// collapse to "axemonitor".
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function TemplatePickerModal({
  opportunityId,
  opportunityName,
  product,
  accountId,
  accountName,
  onClose,
  onCreated,
}: Props) {
  const { user } = useAuth();
  const [allTemplates, setAllTemplates] = useState<AdminTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deploymentType, setDeploymentType] = useState<"cloud" | "on_prem">("cloud");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAdminTemplates({ is_active: true })
      .then((data) => {
        if (cancelled) return;
        setAllTemplates(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load templates");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter templates that match this product (loose-match on normalized name).
  const productTemplates = useMemo(() => {
    if (!allTemplates) return [];
    const targetNorm = norm(product);
    return allTemplates.filter((t) => norm(t.product) === targetNorm);
  }, [allTemplates, product]);

  // Among matching templates, narrow by deployment_type. Auto-suggest the
  // matching one when the picker opens.
  const candidates = useMemo(
    () => productTemplates.filter((t) => t.deployment_type === deploymentType),
    [productTemplates, deploymentType]
  );

  // Auto-select the first candidate when it changes (e.g., user flips
  // deployment_type). Only changes if current selection no longer matches.
  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    const stillValid = candidates.some((c) => c.id === selectedTemplateId);
    if (!stillValid) setSelectedTemplateId(candidates[0].id);
  }, [candidates, selectedTemplateId]);

  const handleCreate = async () => {
    if (!selectedTemplateId) return;
    setSubmitting(true);
    setError(null);
    try {
      const plan = await createDeploymentPlan({
        template_id: selectedTemplateId,
        opportunity_id: opportunityId,
        opportunity_name: opportunityName,
        product,
        account_id: accountId,
        account_name: accountName,
        tsa_email: user?.email || null,
        // ie_email: deferred to Phase 3b (form field).
      });
      onCreated(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create plan");
      setSubmitting(false);
    }
  };

  const selectedTemplate = candidates.find((c) => c.id === selectedTemplateId);

  return (
    <div className="template-picker-overlay" onClick={onClose}>
      <div className="template-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="template-picker-header">
          <h2>Create Deployment Plan</h2>
          <button type="button" className="template-picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="template-picker-body">
          <div className="template-picker-context">
            <div><strong>{accountName}</strong></div>
            <div className="muted">{opportunityName} · {product}</div>
          </div>

          <div className="template-picker-field">
            <label>Deployment type</label>
            <div className="template-picker-radio-group">
              {(["cloud", "on_prem"] as const).map((t) => (
                <label key={t} className={`template-picker-radio${deploymentType === t ? " active" : ""}`}>
                  <input
                    type="radio"
                    name="deployment-type"
                    value={t}
                    checked={deploymentType === t}
                    onChange={() => setDeploymentType(t)}
                  />
                  <span>{t === "cloud" ? "SaaS / Cloud" : "On-Premises"}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="template-picker-field">
            <label>Template</label>
            {loading ? (
              <LoadingRow>Loading templates…</LoadingRow>
            ) : candidates.length === 0 ? (
              <div className="template-picker-empty">
                No active <strong>{deploymentType === "cloud" ? "Cloud" : "On-Prem"}</strong> template
                exists yet for <strong>{product}</strong>.
                {productTemplates.length > 0 && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    Try switching deployment type.
                  </div>
                )}
              </div>
            ) : (
              <select
                value={selectedTemplateId || ""}
                onChange={(e) => setSelectedTemplateId(parseInt(e.target.value, 10))}
                className="template-picker-select"
              >
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedTemplate && (
            <div className="template-picker-preview">
              <Badge tone="info">v{selectedTemplate.version}</Badge>{" "}
              <strong>{selectedTemplate.name}</strong>
              {selectedTemplate.description && (
                <div className="muted" style={{ marginTop: 4 }}>
                  {selectedTemplate.description}
                </div>
              )}
              {selectedTemplate.item_count !== undefined && (
                <div className="muted" style={{ marginTop: 4 }}>
                  {selectedTemplate.item_count} milestones / epics / tasks will be copied.
                </div>
              )}
            </div>
          )}

          {error && <div className="template-picker-error">{error}</div>}
        </div>

        <div className="template-picker-footer">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!selectedTemplateId || submitting}>
            {submitting ? "Creating…" : "Create plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
