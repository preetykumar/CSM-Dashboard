import { Router, Request, Response } from "express";

export function createCalendarRoutes(): Router {
  const router = Router();

  // GET /api/calendar/events?date=YYYY-MM-DD (defaults to today)
  router.get("/events", async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const accessToken = user.googleAccessToken;
    if (!accessToken) {
      return res.status(403).json({
        error: "Calendar access not granted. Please log out and log back in to grant calendar permissions.",
        requiresReauth: true,
      });
    }

    // Determine the day to fetch (defaults to today)
    const dateParam = req.query.date as string | undefined;
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    const timeMin = new Date(targetDate);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(targetDate);
    timeMax.setHours(23, 59, 59, 999);

    const fetchCalendarEvents = async (token: string) => {
      return fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
          `?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}` +
          `&singleEvents=true&orderBy=startTime&maxResults=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    };

    let response = await fetchCalendarEvents(accessToken);

    // Try to refresh the token if it expired
    if (response.status === 401 && user.googleRefreshToken) {
      try {
        const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: user.googleRefreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });

        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json() as any;
          // Update the session token in-memory
          (req.user as any).googleAccessToken = refreshData.access_token;
          response = await fetchCalendarEvents(refreshData.access_token);
        } else {
          return res.status(403).json({
            error: "Calendar access expired. Please log out and log back in.",
            requiresReauth: true,
          });
        }
      } catch {
        return res.status(403).json({ error: "Failed to refresh calendar token", requiresReauth: true });
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Google Calendar API error:", response.status, errText);
      return res.status(response.status).json({ error: "Failed to fetch calendar events" });
    }

    const data = await response.json() as any;
    res.json({ events: data.items || [] });
  });

  return router;
}
