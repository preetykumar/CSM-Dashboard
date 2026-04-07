import { useState } from "react";
import { saveUserPreferences } from "../../services/api";

interface CalendlyWidgetProps {
  calendlyUrl: string | null;
  onSettingsChange: (url: string) => void;
}

export function CalendlyWidget({ calendlyUrl, onSettingsChange }: CalendlyWidgetProps) {
  const [editing, setEditing] = useState(false);
  const [urlInput, setUrlInput] = useState(calendlyUrl || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveUserPreferences({ calendly_url: urlInput || null, calendly_token: null });
      onSettingsChange(urlInput);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="home-widget calendly-widget-section" aria-labelledby="calendly-widget-title">
      <div className="widget-header">
        <h3 id="calendly-widget-title">Calendly</h3>
        <button
          className="widget-settings-btn"
          onClick={() => { setEditing(!editing); setUrlInput(calendlyUrl || ""); }}
          aria-label={editing ? "Cancel editing Calendly link" : "Edit Calendly link"}
        >
          {editing ? "✕" : "✎"}
        </button>
      </div>

      {editing ? (
        <div className="widget-settings-form">
          <label htmlFor="calendly-url">Your Calendly URL</label>
          <input
            id="calendly-url"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://calendly.com/yourname"
          />
          <div className="settings-actions">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : calendlyUrl ? (
        <div className="calendly-link-display">
          <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="calendly-link">
            {calendlyUrl}
          </a>
          <button className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(calendlyUrl)}>
            Copy link
          </button>
        </div>
      ) : (
        <div className="widget-empty-state">
          <p>Add your Calendly link for easy access.</p>
          <button className="btn-secondary" onClick={() => setEditing(true)}>Add Calendly link</button>
        </div>
      )}
    </section>
  );
}
