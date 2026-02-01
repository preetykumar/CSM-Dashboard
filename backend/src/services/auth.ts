import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { Request, Response, NextFunction } from "express";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

export function configureAuth() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3001/api/auth/google/callback";
  const allowedDomain = process.env.ALLOWED_DOMAIN || "deque.com";

  if (!clientID || !clientSecret) {
    console.warn("Google OAuth not configured. Authentication disabled.");
    return null;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      (accessToken, refreshToken, profile, done) => {
        // Extract email and verify domain
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("No email found in Google profile"));
        }

        const domain = email.split("@")[1];
        if (domain !== allowedDomain) {
          return done(new Error(`Only ${allowedDomain} users are allowed`));
        }

        const user: AuthUser = {
          id: profile.id,
          email,
          name: profile.displayName,
          picture: profile.photos?.[0]?.value,
          domain,
        };

        return done(null, user);
      }
    )
  );

  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  // Deserialize user from session
  passport.deserializeUser((user: AuthUser, done) => {
    done(null, user);
  });

  return passport;
}

// Middleware to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Authentication required", loginUrl: "/api/auth/google" });
}

// Middleware to check if auth is enabled (skip auth check if not configured)
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authEnabled = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

  if (!authEnabled) {
    // Auth not configured, allow all requests
    return next();
  }

  return requireAuth(req, res, next);
}
