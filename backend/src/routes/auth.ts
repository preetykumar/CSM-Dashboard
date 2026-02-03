import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";

// Admin users who can trigger syncs and see all data
const ADMIN_EMAILS = [
  "michelle.viguerie@deque.com",
  "katile.olsen@deque.com",
  "neel.sinha@deque.com",
  "preety.kumar@deque.com",
  "sujasree.kurapati@deque.com",
  "anik.ganguly@deque.com",
  "dylan.barrell@deque.com",
  "mike.farrell@deque.com",
];

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.some((admin) => admin.toLowerCase() === email.toLowerCase());
}

export function createAuthRoutes(): Router {
  const router = Router();
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  // Initiate Google OAuth
  router.get(
    "/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })
  );

  // Google OAuth callback
  router.get(
    "/google/callback",
    passport.authenticate("google", {
      failureRedirect: `${frontendUrl}/login?error=auth_failed`,
    }),
    (req: Request, res: Response) => {
      // Successful authentication
      res.redirect(`${frontendUrl}?login=success`);
    }
  );

  // Get current user
  router.get("/me", (req: Request, res: Response) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      const user = req.user as { email?: string };
      res.json({
        authenticated: true,
        user: req.user,
        isAdmin: isAdmin(user?.email),
      });
    } else {
      res.json({
        authenticated: false,
        user: null,
        isAdmin: false,
      });
    }
  });

  // Logout
  router.post("/logout", (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      req.session?.destroy((err) => {
        if (err) {
          console.error("Error destroying session:", err);
        }
        res.json({ success: true, message: "Logged out" });
      });
    });
  });

  // Check auth status (for health checks)
  router.get("/status", (req: Request, res: Response) => {
    const authEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({
      authEnabled,
      authenticated: req.isAuthenticated ? req.isAuthenticated() : false,
      allowedDomain: process.env.ALLOWED_DOMAIN || "deque.com",
    });
  });

  return router;
}
