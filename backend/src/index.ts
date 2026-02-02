import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ZendeskService } from "./services/zendesk.js";
import { SalesforceService } from "./services/salesforce.js";
import { GitHubService } from "./services/github.js";
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
import { createGitHubRoutes } from "./routes/github.js";
import { AgentService } from "./services/agent.js";
import { createAgentRoutes } from "./routes/agent.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const SYNC_SCHEDULE = process.env.SYNC_SCHEDULE || "0 2 * * *"; // Default: 2 AM daily
const SESSION_SECRET = process.env.SESSION_SECRET || "zendesk-dashboard-secret-change-me";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Extract origin from FRONTEND_URL for CORS (remove path, keep protocol://host)
function getOriginFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}
const CORS_ORIGIN = getOriginFromUrl(FRONTEND_URL);

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
  const authType = process.env.SF_AUTH_TYPE || "client_credentials";
  const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;

  if (authType === "jwt") {
    // JWT Bearer Flow (production)
    const username = process.env.SF_USERNAME;
    const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;

    if (!clientId || !username || !privateKeyPath) {
      console.warn("Salesforce JWT credentials not configured. SF features will be disabled.");
      console.warn("Required: SF_CLIENT_ID, SF_USERNAME, SF_PRIVATE_KEY_PATH");
      return null;
    }

    return {
      authType: "jwt" as const,
      clientId,
      username,
      privateKeyPath,
      loginUrl,
    };
  } else {
    // Client Credentials Flow (sandbox)
    const clientSecret = process.env.SF_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn("Salesforce credentials not configured. SF features will be disabled.");
      return null;
    }

    return {
      authType: "client_credentials" as const,
      clientId,
      clientSecret,
      loginUrl,
    };
  }
}

function loadGitHubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG || "dequelabs";
  const projectNumbersStr = process.env.GITHUB_PROJECT_NUMBERS;

  if (!token) {
    console.warn("GitHub token not configured. GitHub features will be disabled.");
    return null;
  }

  const projectNumbers = projectNumbersStr
    ? projectNumbersStr.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
    : [];

  if (projectNumbers.length === 0) {
    console.warn("No GitHub project numbers configured. Set GITHUB_PROJECT_NUMBERS env var.");
  }

  return { token, org, projectNumbers };
}

function loadAnthropicConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const maxTokens = parseInt(process.env.AGENT_MAX_TOKENS || "4096", 10);

  if (!apiKey) {
    console.warn("Anthropic API key not configured. AI Agent features will be disabled.");
    return null;
  }

  return { apiKey, model, maxTokens };
}

const app = express();

// CORS configuration to allow credentials
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

// Trust proxy for Cloud Run (required for secure cookies behind load balancer)
app.set("trust proxy", 1);

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
      sameSite: "lax", // Same-origin since frontend is served from same Cloud Run instance
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

const ghConfig = loadGitHubConfig();
const github = ghConfig ? new GitHubService(ghConfig) : null;

const db = new DatabaseService();
const sync = new SyncService(db, zendesk, salesforce, github);

// Initialize AI Agent
const anthropicConfig = loadAnthropicConfig();
const agent = anthropicConfig ? new AgentService(db, zendesk, anthropicConfig) : null;

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
    github: github ? "configured" : "not configured",
    agent: agent ? "configured" : "not configured",
    auth: authEnabled ? "enabled" : "disabled",
    cache: {
      enabled: true,
      syncStatus,
    },
  });
});

// Test endpoint for GitHub links (no auth, for debugging)
app.get("/api/test/github-links", (_req, res) => {
  const ticketId = parseInt((_req.query.ticketId as string) || "44641", 10);
  const links = db.getGitHubLinksByTicketId(ticketId);
  res.json({
    ticketId,
    linkCount: links.length,
    links: links.map((l) => ({
      repo: l.github_repo,
      issue: l.github_issue_number,
      status: l.project_status,
      sprint: l.sprint,
    })),
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

// GitHub routes (for development status)
app.use("/api/github", optionalAuth, createGitHubRoutes(db));

// AI Agent routes
if (agent) {
  app.use("/api/agent", optionalAuth, createAgentRoutes(agent));
}

// Serve static frontend files in production
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

// SPA fallback - serve index.html for non-API routes
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(publicPath, "index.html"));
  } else {
    res.status(404).json({ error: "API endpoint not found" });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connected to Zendesk: ${zendeskConfig.subdomain}.zendesk.com`);
  if (salesforce) {
    console.log("Salesforce integration: enabled");
  } else {
    console.log("Salesforce integration: disabled (no credentials)");
  }
  if (github) {
    console.log(`GitHub integration: enabled (org: ${ghConfig?.org}, projects: ${ghConfig?.projectNumbers?.join(", ") || "none"})`);
  } else {
    console.log("GitHub integration: disabled (no token)");
  }
  if (agent) {
    console.log(`AI Agent: enabled (model: ${anthropicConfig?.model})`);
  } else {
    console.log("AI Agent: disabled (no ANTHROPIC_API_KEY)");
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
