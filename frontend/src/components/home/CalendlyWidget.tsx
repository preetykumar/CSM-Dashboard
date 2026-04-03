import { useEffect, useRef, useState } from "react";
import { fetchCalendlyEvents, fetchUserPreferences, saveUserPreferences, type CalendlyEvent } from "../../services/api";

function formatEventTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Inline Calendly booking embed
function CalendlyEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Calendly widget script once
    if (!document.getElementById("calendly-widget-script")) {
      const script = document.createElement("script");
      script.id = "calendly-widget-script";
      script.src = "https://assets.calendly.com/assets/external/widget.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="calendly-inline-widget"
      data-url={`${url}?hide_event_type_details=1&hide_gdpr_banner=1`}
      style={{ minWidth: "280px", height: "420px" }}
    />
  );
}

interface CalendlyWidgetProps {
  calendlyUrl: string | null;
  calendlyToken: string | null;
  onSettingsChange: (url: string, token: string) => void;
}

export function CalendlyWidget({ calendlyUrl, calendlyToken, onSettingsChange }: CalendlyWidgetProps) {
  const [upcomingEvents, setUpcomingEvents] = useState<CalendlyEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [urlInput, setUrlInput] = useState(calendlyUrl || "");
  const [tokenInput, setTokenInput] = useState(calendlyToken || "");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"book" | "upcoming">("book");

  useEffect(() => {
    if (calendlyToken) {
      setLoadingEvents(true);
      fetchCalendlyEvents()
        .then((data) => {
          if (!data.requiresToken) setUpcomingEvents(data.events);
        })
        .finally(() => setLoadingEvents(false));
    }
  }, [calendlyToken]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await saveUserPreferences({ calendly_url: urlInput || null, calendly_token: tokenInput || null });
      onSettingsChange(urlInput, tokenInput);
      setShowSettings(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="home-widget calendly-widget-section" aria-labelledby="calendly-widget-title">
      <div className="widget-header">
        <h3 id="calendly-widget-title">🗓 Calendly</h3>
        <button
          className="widget-settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          aria-label="Calendly settings"
        >
          ⚙
        </button>
      </div>

      {showSettings && (
        <div className="widget-settings-form">
          <label htmlFor="calendly-url">Your Calendly URL</label>
          <input
            id="calendly-url"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://calendly.com/yourname"
          />
          <label htmlFor="calendly-token">
            Personal Access Token <span className="optional-label">(optional — for upcoming meetings)</span>
          </label>
          <input
            id="calendly-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste token from Calendly → Integrations → API &amp; Webhooks"
          />
          <div className="settings-actions">
            <button className="btn-primary" onClick={handleSaveSettings} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!showSettings && !calendlyUrl && (
        <div className="widget-empty-state">
          <p>Add your Calendly URL to show your booking page and upcoming meetings.</p>
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>Set up Calendly</button>
        </div>
      )}

      {!showSettings && calendlyUrl && (
        <>
          <div className="widget-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "book"}
              className={activeTab === "book" ? "active" : ""}
              onClick={() => setActiveTab("book")}
            >
              Booking page
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "upcoming"}
              className={activeTab === "upcoming" ? "active" : ""}
              onClick={() => setActiveTab("upcoming")}
            >
              Upcoming ({upcomingEvents.length})
            </button>
          </div>

          {activeTab === "book" && <CalendlyEmbed url={calendlyUrl} />}

          {activeTab === "upcoming" && (
            <div className="calendly-upcoming">
              {loadingEvents && <p className="widget-loading">Loading meetings…</p>}
              {!loadingEvents && !calendlyToken && (
                <div className="widget-empty-state">
                  <p>Add a Personal Access Token in settings to see upcoming meetings.</p>
                  <button className="btn-secondary btn-sm" onClick={() => setShowSettings(true)}>Add token</button>
                </div>
              )}
              {!loadingEvents && calendlyToken && upcomingEvents.length === 0 && (
                <p className="widget-empty">No upcoming meetings in the next 30 days.</p>
              )}
              {!loadingEvents && upcomingEvents.length > 0 && (
                <ul className="calendly-event-list" role="list">
                  {upcomingEvents.map((event) => (
                    <li key={event.uri} className="calendly-event">
                      <span className="event-time">{formatEventTime(event.start_time)}</span>
                      <div className="event-details">
                        <span className="event-title">{event.name}</span>
                        {event.invitees_counter.total > 0 && (
                          <span className="event-attendees">{event.invitees_counter.total} invitee{event.invitees_counter.total !== 1 ? "s" : ""}</span>
                        )}
                        {event.location?.join_url && (
                          <a href={event.location.join_url} target="_blank" rel="noopener noreferrer" className="event-join-link">
                            Join
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
