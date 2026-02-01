import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import cron from "node-cron";
import { ZendeskService } from "./services/zendesk.js";
import { SalesforceService } from "./services/salesforce.js";
import { DatabaseService } from "./services/database.js";
import { SyncService } from "./services/sync.js";
import { configureAuth, optionalAuth } from "./services/auth.js";
import { createTicketRoutes } from "./routes/tickets.js";
import { createOrganizationRoutes } from "./routes/organizations.js";
import { createFieldRoutes } from "./routes/fields.js";
import { createCSMRoutes } from "./routes/csm.js";
import { createSalesforceRoutes } from "./routes/salesforce.js";
import { createSyncRoutes } from "./routes/sync.js";
import { createCachedRoutes } from "./routes/cached.js";
import { createAuthRoutes } from "./routes/auth.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const SYNC_SCHEDULE = process.env.SYNC_SCHEDULE || "0 2 * * *"; // Default: 2 AM daily
const SESSION_SECRET = process.env.SESSION_SECRET || "zendesk-dashboard-secret-change-me";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

function loadZendeskConfig() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const apiToken = process.env.ZENDESK_API_TOKEN;

  if (!subdomain || !email || !apiToken) {
    throw new Error(
      "Missing required environment variables: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN"
    );
  }

  return { subdomain, email, apiToken };
}

function loadSalesforceConfig() {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const loginUrl = process.env.SF_LOGIN_URL || "https://test.salesforce.com";

  if (!clientId || !clientSecret) {
    console.warn("Salesforce credentials not configured. SF features will be disabled.");
    return null;
  }

  return { clientId, clientSecret, loginUrl };
}

const app = express();

// CORS configuration to allow credentials
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());

// Session configuration
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Initialize Passport
const authConfigured = configureAuth();
if (authConfigured) {
  app.use(passport.initialize());
  app.use(passport.session());
  console.log("Google OAuth: configured");
} else {
  console.log("Google OAuth: not configured (no credentials)");
}

// Initialize services
const zendeskConfig = loadZendeskConfig();
const zendesk = new ZendeskService(zendeskConfig);

const sfConfig = loadSalesforceConfig();
const salesforce = sfConfig ? new SalesforceService(sfConfig) : null;

const db = new DatabaseService();
const sync = new SyncService(db, zendesk, salesforce);

// Auth routes (no auth required)
app.use("/api/auth", createAuthRoutes());

// Health check (no auth required)
app.get("/api/health", (_req, res) => {
  const syncStatus = sync.getSyncStatus();
  const authEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    salesforce: salesforce ? "configured" : "not configured",
    auth: authEnabled ? "enabled" : "disabled",
    cache: {
      enabled: true,
      syncStatus,
    },
  });
});

// Protected API routes - require authentication if configured
// Live API routes (direct Zendesk/SF calls - slower but always fresh)
app.use("/api/live/tickets", optionalAuth, createTicketRoutes(zendesk));
app.use("/api/live/organizations", optionalAuth, createOrganizationRoutes(zendesk));
app.use("/api/live/csm", optionalAuth, createCSMRoutes(zendesk, salesforce));

// Cached routes (fast, uses SQLite)
app.use("/api/organizations", optionalAuth, createCachedRoutes(db));
app.use("/api/csm", optionalAuth, createCachedRoutes(db));

// Other routes
app.use("/api/fields", optionalAuth, createFieldRoutes(zendesk));
app.use("/api/sync", optionalAuth, createSyncRoutes(sync));

if (salesforce) {
  app.use("/api/salesforce", optionalAuth, createSalesforceRoutes(salesforce));
}

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connected to Zendesk: ${zendeskConfig.subdomain}.zendesk.com`);
  if (salesforce) {
    console.log("Salesforce integration: enabled");
  } else {
    console.log("Salesforce integration: disabled (no credentials)");
  }
  console.log("SQLite cache: enabled");

  // Check if cache is empty and trigger initial sync
  const orgs = db.getOrganizations();
  if (orgs.length === 0) {
    console.log("Cache is empty. Starting initial sync...");
    sync.syncAll().catch((error) => {
      console.error("Initial sync failed:", error);
    });
  } else {
    console.log(`Cache contains ${orgs.length} organizations`);
  }

  // Schedule automatic nightly sync
  if (cron.validate(SYNC_SCHEDULE)) {
    cron.schedule(SYNC_SCHEDULE, async () => {
      console.log(`[${new Date().toISOString()}] Starting scheduled sync...`);
      try {
        const result = await sync.syncAll();
        console.log(`[${new Date().toISOString()}] Scheduled sync complete:`, result);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Scheduled sync failed:`, error);
      }
    });
    console.log(`Scheduled sync: ${SYNC_SCHEDULE} (cron format)`);
  } else {
    console.warn(`Invalid SYNC_SCHEDULE: ${SYNC_SCHEDULE}. Scheduled sync disabled.`);
  }
});
