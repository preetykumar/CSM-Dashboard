import { useState } from "react";
import { saveUserPreferences } from "../../services/api";

export type UserRole =
  | "csm"
  | "pm"
  | "renewal-specialist"
  | "tsa"
  | "ie"
  // Legacy value — kept for backward compatibility with previously saved
  // preferences. No longer offered in the picker (superseded by "ie").
  | "field-engineers";

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
    id: "tsa",
    label: "Technical Solution Architect",
    description: "Track technical engagements and solution design across your assigned accounts",
    icon: "🛠️",
  },
  {
    id: "ie",
    label: "Implementation Engineer",
    description: "Drive implementation projects and technical onboarding for your assigned accounts",
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
          <h2 id="role-modal-title">Welcome to Customer 360° — Deque's Customer Intelligence Platform</h2>
          <p>Select your role to personalise your home page with relevant tasks and insights.</p>
        </div>

        <div className="role-options">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`role-option${selected === option.id ? " selected" : ""}`}
              onClick={() => setSelected(option.id)}
              aria-pressed={selected === option.id}
            >
              <span className="role-option-icon" aria-hidden="true">{option.icon}</span>
              <div className="role-option-text">
                <strong>{option.label}</strong>
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
