import { useState } from "react";
import { saveUserPreferences } from "../../services/api";

export type UserRole = "csm" | "pm" | "renewal-specialist" | "field-engineers";

interface RoleOption {
  id: UserRole;
  label: string;
  description: string;
  icon: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "csm",
    label: "Customer Success Manager",
    description: "Manage customer relationships, track tickets, renewals, and product usage for your portfolio",
    icon: "👥",
  },
  {
    id: "pm",
    label: "Project Manager",
    description: "Oversee service and implementation projects, track tickets and milestones for your customers",
    icon: "📋",
  },
  {
    id: "renewal-specialist",
    label: "Renewal Specialist",
    description: "Manage renewal pipeline, track at-risk opportunities, and coordinate renewal workflows",
    icon: "🔄",
  },
  {
    id: "field-engineers",
    label: "Field Engineer",
    description: "Field engineer portfolio views and customer technical engagements (coming soon)",
    icon: "🔧",
  },
];

interface RoleSelectionModalProps {
  onRoleSelected: (role: UserRole) => void;
}

export function RoleSelectionModal({ onRoleSelected }: RoleSelectionModalProps) {
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await saveUserPreferences({ role: selected });
      onRoleSelected(selected);
    } catch {
      // If backend unavailable (e.g. no auth), still proceed
      onRoleSelected(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="role-modal-overlay">
      <div className="role-modal" role="dialog" aria-modal="true" aria-labelledby="role-modal-title">
        <div className="role-modal-header">
          <h2 id="role-modal-title">Welcome to the Post-sales Customer Team Portal</h2>
          <p>Select your role to personalise your home page with relevant tasks and insights.</p>
        </div>

        <div className="role-options">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`role-option${selected === option.id ? " selected" : ""}${option.id === "field-engineers" ? " coming-soon" : ""}`}
              onClick={() => option.id !== "field-engineers" && setSelected(option.id)}
              aria-pressed={selected === option.id}
              disabled={option.id === "field-engineers"}
            >
              <span className="role-option-icon" aria-hidden="true">{option.icon}</span>
              <div className="role-option-text">
                <strong>{option.label}</strong>
                {option.id === "field-engineers" && <span className="tab-badge-soon" style={{ marginLeft: "0.5rem" }}>Soon</span>}
                <p>{option.description}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="role-modal-footer">
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!selected || saving}
          >
            {saving ? "Saving…" : "Get started"}
          </button>
          <p className="role-modal-note">You can change your role at any time from the home page.</p>
        </div>
      </div>
    </div>
  );
}
