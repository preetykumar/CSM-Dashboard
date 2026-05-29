// Admin-only list of deployment templates. Each row links to its detail view
// where the playbook tree can be edited inline.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  listAdminTemplates,
  updateAdminTemplate,
  type AdminTemplate,
} from "../../services/api";
import {
  Page,
  PageHeader,
  Card,
  Badge,
  Button,
  EmptyState,
  LoadingRow,
  SectionHeader,
  Banner,
} from "../ui";

const DEPLOYMENT_LABELS: Record<string, string> = {
  cloud: "SaaS / Cloud",
  on_prem: "On-Premises",
};

export function DeploymentTemplatesView() {
  const { isAdmin, login } = useAuth();
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    listAdminTemplates()
      .then((data) => {
        setTemplates(data);
        setLoading(false);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Failed to load templates";
        // "session_expired:" prefix comes from api.ts when the server returns
        // 403 even though useAuth thinks we're an admin. The user's passport
        // session has lapsed — log back in.
        if (msg.startsWith("session_expired:") || msg.startsWith("not_authenticated:")) {
          setSessionExpired(true);
        } else {
          setError(msg);
        }
        setLoading(false);
      });
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <Page>
        <PageHeader title="Deployment Templates" />
        <Card>
          <EmptyState
            title="Admin access required"
            detail="This page is only available to portal admins."
          />
        </Card>
      </Page>
    );
  }

  const onToggleActive = async (tpl: AdminTemplate) => {
    setToggling(tpl.id);
    try {
      const updated = await updateAdminTemplate(tpl.id, { is_active: !tpl.is_active });
      setTemplates((prev) => prev.map((t) => (t.id === tpl.id ? { ...t, is_active: updated.is_active } : t)));
    } catch (e) {
      alert(`Failed to toggle: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setToggling(null);
    }
  };

  // Group by product for tidier rendering.
  const byProduct = new Map<string, AdminTemplate[]>();
  for (const t of templates) {
    if (!byProduct.has(t.product)) byProduct.set(t.product, []);
    byProduct.get(t.product)!.push(t);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="Deployment Templates"
        subtitle="Implementation playbooks per product and deployment type. Versioned — creating a new version deactivates the previous."
      />

      {loading ? (
        <Card><LoadingRow>Loading templates…</LoadingRow></Card>
      ) : sessionExpired ? (
        <Card>
          <EmptyState
            title="Session expired"
            detail="Your sign-in is no longer valid. This usually happens after the backend restarts or your cookie ages out. Sign in again to continue."
            action={
              <Button size="sm" onClick={login}>Sign in again</Button>
            }
          />
        </Card>
      ) : error ? (
        <Banner tone="danger">{error}</Banner>
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState
            title="No templates yet"
            detail="Run the seed script to import from xlsx, or build one from scratch (upload coming soon)."
          />
        </Card>
      ) : (
        <>
          {[...byProduct.entries()].map(([product, list]) => (
            <section key={product} style={{ marginBottom: "var(--space-6, 24px)" }}>
              <SectionHeader title={product} count={`${list.length} ${list.length === 1 ? "template" : "templates"}`} />
              <Card>
                <table className="admin-tpl-table">
                  <thead>
                    <tr>
                      <th>Deployment</th>
                      <th>Name</th>
                      <th style={{ textAlign: "right" }}>Version</th>
                      <th style={{ textAlign: "right" }}>Items</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => (
                      <tr key={t.id}>
                        <td>{DEPLOYMENT_LABELS[t.deployment_type] || t.deployment_type}</td>
                        <td>
                          <Link to={`/admin/deployment-templates/${t.id}`} className="admin-tpl-link">
                            {t.name}
                          </Link>
                          {t.description && (
                            <div className="admin-tpl-desc">{t.description}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>v{t.version}</td>
                        <td style={{ textAlign: "right" }}>{t.item_count ?? "—"}</td>
                        <td>
                          {t.is_active ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="neutral">Inactive</Badge>
                          )}
                        </td>
                        <td>
                          <span className="admin-tpl-date">
                            {t.updated_at ? new Date(t.updated_at).toLocaleDateString() : "—"}
                          </span>
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onToggleActive(t)}
                            disabled={toggling === t.id}
                          >
                            {toggling === t.id ? "…" : t.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          ))}
        </>
      )}
    </Page>
  );
}
