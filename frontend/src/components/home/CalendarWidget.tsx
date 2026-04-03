import { useEffect, useState } from "react";
import { fetchCalendarEvents, type GoogleCalendarEvent } from "../../services/api";

function formatTime(dateTime?: string, date?: string): string {
  if (dateTime) {
    return new Date(dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (date) return "All day";
  return "";
}

function getMeetingLink(event: GoogleCalendarEvent): string | undefined {
  return event.hangoutLink || event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
}

export function CalendarWidget() {
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [notAuthenticated, setNotAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCalendarEvents()
      .then((data) => {
        if (data.notAuthenticated) {
          setNotAuthenticated(true);
        } else if (data.requiresReauth) {
          setRequiresReauth(true);
        } else if (data.error) {
          setError(data.error);
        } else {
          setEvents(data.events);
        }
      })
      .catch(() => setError("Could not load calendar"))
      .finally(() => setLoading(false));
  }, []);

  const todayLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  // Hide widget entirely when auth is not configured (local dev without Google OAuth)
  if (notAuthenticated && !loading) return null;

  return (
    <section className="home-widget calendar-widget" aria-labelledby="calendar-widget-title">
      <div className="widget-header">
        <h3 id="calendar-widget-title">📅 Today — {todayLabel}</h3>
      </div>

      {loading && <p className="widget-loading">Loading calendar…</p>}

      {requiresReauth && !loading && (
        <div className="widget-reauth">
          <p>Grant calendar access to see today's meetings.</p>
          <a href="/api/auth/google" className="btn-secondary">Connect Google Calendar</a>
        </div>
      )}

      {error && !loading && !requiresReauth && (
        <p className="widget-error">{error}</p>
      )}

      {!loading && !requiresReauth && !error && events.length === 0 && (
        <p className="widget-empty">No events scheduled for today.</p>
      )}

      {!loading && !requiresReauth && !error && events.length > 0 && (
        <ul className="calendar-event-list" role="list">
          {events.map((event) => {
            const meetingLink = getMeetingLink(event);
            const startTime = formatTime(event.start.dateTime, event.start.date);
            const endTime = formatTime(event.end.dateTime, event.end.date);
            const isCancelled = event.status === "cancelled";
            return (
              <li key={event.id} className={`calendar-event${isCancelled ? " cancelled" : ""}`}>
                <span className="event-time">{startTime}{endTime && startTime !== "All day" ? `–${endTime}` : ""}</span>
                <div className="event-details">
                  <span className="event-title">{event.summary || "(No title)"}</span>
                  {event.location && <span className="event-location">📍 {event.location}</span>}
                  {meetingLink && (
                    <a href={meetingLink} target="_blank" rel="noopener noreferrer" className="event-join-link">
                      Join meeting
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
