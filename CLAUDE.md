# Post-sales Customer Team Portal - Development Guide

## Project Overview
This is a post-sales customer team portal (formerly CSM Dashboard) with:
- **Frontend**: React 18 + TypeScript + Vite (in `/frontend`)
- **Backend**: Node.js 20 + Express + TypeScript (in `/backend`)
- **Database**: SQLite (default, local) or PostgreSQL (persistent, for production)
- **Deployment**: Google Cloud Run

---

## Local Development

### Prerequisites
- **Node.js 20.x** (CRITICAL: Do NOT use Node 22+ as it has issues with native modules like better-sqlite3)
- npm or yarn

### Environment Setup
1. Copy `.env.example` to `.env` and fill in credentials
2. The `.env` file contains all API keys for:
   - Zendesk
   - Salesforce (JWT auth for production)
   - GitHub
   - Anthropic (AI agent)
   - Amplitude (usage analytics)
   - Google OAuth

### Running Locally
```bash
# Terminal 1: Backend (SQLite - default)
cd backend
npm install
npm run dev

# Terminal 1: Backend (PostgreSQL - persistent)
# First start the Docker container (one-time setup):
docker run -d --name csm-postgres -e POSTGRES_DB=csm_dashboard -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine
# Then start backend with PG:
PG_DATABASE=csm_dashboard npm run dev

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

- Backend runs on http://localhost:3001
- Frontend runs on http://localhost:5173

### Database Modes
The backend supports two database backends, selected automatically by environment variables:

- **SQLite (default)**: No config needed. Data stored in `backend/data/zendesk-cache.db`. Lost on Cloud Run restart.
- **PostgreSQL**: Set `PG_DATABASE` env var (or `INSTANCE_CONNECTION_NAME` for Cloud SQL). Data persists across restarts.

Both implement the `IDatabaseService` interface defined in `backend/src/services/database-interface.ts`.

**PostgreSQL env vars** (all optional, defaults shown):
- `PG_HOST` (default: `localhost`)
- `PG_PORT` (default: `5432`)
- `PG_DATABASE` (default: `csm_dashboard`) — **setting this triggers PostgreSQL mode**
- `PG_USER` (default: `postgres`)
- `PG_PASSWORD` (default: `postgres`)
- `INSTANCE_CONNECTION_NAME` — for Cloud SQL Unix socket connections (also triggers PostgreSQL mode)

**Docker PostgreSQL commands:**
```bash
docker start csm-postgres   # Start existing container
docker stop csm-postgres    # Stop container
docker rm -f csm-postgres   # Remove container (data lost)
docker exec -it csm-postgres psql -U postgres -d csm_dashboard  # Connect to psql
```

### Local Build
```bash
# Build backend
cd backend && npm run build

# Build frontend
cd frontend && npm run build
```

---

## Git Remotes

The repository is pushed to two GitHub remotes:
- **origin** → `https://github.com/preetykumar/CSM-Dashboard.git` (personal repo)
- **dequelabs** → `https://github.com/dequelabs/CustomerTeamPortal.git` (org repo)

The default upstream tracking branch is `dequelabs/main`. To push to both:
```bash
git push dequelabs main   # org repo (default)
git push origin main      # personal repo
```

---

## Production Deployment (Google Cloud Run)

### Project Details
- **GCP Project**: `csm-dashboard-deque`
- **Cloud Run Service**: `csm-dashboard`
- **Cloud SQL Instance**: `csm-dashboard-db` (PostgreSQL 18)
- **Region**: `us-central1`
- **Production URL**: `https://csm-dashboard-iow4tellka-uc.a.run.app`

### CI/CD Pipeline
- **Cloud Build Trigger**: Automatically deploys on push to `main` branch (on `preetykumar/CSM-Dashboard`)
- Builds Docker image and deploys to Cloud Run
- Build takes ~5-7 minutes
- **IMPORTANT**: New builds create new revisions but may NOT automatically route traffic

### Checking Build Status
```bash
gcloud builds list --limit=3 --project=csm-dashboard-deque
```

### Checking Which Revision is Serving Traffic
```bash
# This is important! New builds may not be receiving traffic
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque --format="value(status.traffic[0].revisionName)"
```

### Routing Traffic to Latest Revision
If a new build deploys but traffic is still going to an old revision:
```bash
gcloud run services update-traffic csm-dashboard \
  --region=us-central1 \
  --to-latest \
  --project=csm-dashboard-deque
```

### Production Environment Variables

**CRITICAL**: Environment variables in Cloud Run are set via the Cloud Console or gcloud CLI, NOT by editing a file.

To update environment variables:
```bash
gcloud run services update csm-dashboard \
  --region=us-central1 \
  --update-env-vars="VAR_NAME=value" \
  --project=csm-dashboard-deque
```

Or use Cloud Console: Cloud Run > csm-dashboard > Edit & Deploy New Revision > Variables & Secrets

---

## Production Credentials Reference

### Salesforce JWT (Production)
- **Consumer Key (SF_CLIENT_ID)**: `3MVG9Km_cBLhsuPyh7uEuxH3ac6yE0s7jclxrmg.C4h_AfZAnBOcZ1WpoNQL_OxRIVT2IrieisnHDjBv0CzA4`
- **Username (SF_USERNAME)**: `preetycsmdashboard@deque.com`
- **Auth Type (SF_AUTH_TYPE)**: `jwt`
- **Login URL (SF_LOGIN_URL)**: `https://login.salesforce.com`
- **Private Key**: Download from 1Password Secret 4214 "Deque Salesforce Production JWT"

### Google OAuth
- **Client ID**: `333298140178-h95f6thubnnae4v0021nm2ujcqoju90q.apps.googleusercontent.com`
- **Client Secret**: Stored in Cloud Run (do not commit)
- **Callback URL**: `https://csm-dashboard-iow4tellka-uc.a.run.app/api/auth/google/callback`

---

## Important Lessons Learned

### 1. Node.js Version
**Always use Node.js 20.x** - The Dockerfile specifies `node:20-alpine`. Node 22+ causes issues with native modules like `better-sqlite3`.

### 2. Salesforce Private Key (SF_PRIVATE_KEY)

**For Local Development:**
- Set `SF_PRIVATE_KEY_PATH` to the path of your PEM file (e.g., `keys/private-key.pem`)
- OR set `SF_PRIVATE_KEY` with the raw PEM content

**For Production (Cloud Run):**
- The private key must be **base64-encoded** when stored in Cloud Run env vars
- **CRITICAL: PEM File Must Have Unix Line Endings (LF, not CRLF)**
  - Windows-style line endings in the PEM file will cause JWT signing to fail with "secretOrPrivateKey must be an asymmetric key when using RS256"
  - Check your PEM file: `file keys/salesforce.pem` (should show "ASCII text", NOT "ASCII text, with CRLF line terminators")
  - Convert to Unix line endings if needed: `tr -d '\r' < keys/salesforce.pem > keys/salesforce_unix.pem`
- Encode the key (after ensuring Unix line endings):
  ```bash
  # Convert to Unix line endings and encode
  tr -d '\r' < keys/salesforce.pem | base64 | tr -d '\n'
  ```
- The backend automatically detects and decodes base64-encoded keys (if they don't start with `-----BEGIN`)
- Update in Cloud Run:
  ```bash
  gcloud run services update csm-dashboard \
    --region=us-central1 \
    --update-env-vars="SF_PRIVATE_KEY=<base64-encoded-key>" \
    --project=csm-dashboard-deque
  ```

### 3. Google OAuth - Client ID and Secret Must Match
- The `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Cloud Run MUST be from the SAME OAuth client
- If you update one, you must update both
- Verify the Client ID matches what's in Google Cloud Console

### 4. Cloud Run Traffic Routing
- New builds create new revisions but may NOT automatically receive traffic
- Always check which revision is serving: `gcloud run services describe csm-dashboard --region=us-central1 --format="value(status.traffic[0].revisionName)"`
- Route to latest if needed: `gcloud run services update-traffic csm-dashboard --region=us-central1 --to-latest`

### 5. Production Credentials
- **Never commit** `.env` files or private keys to git
- Production credentials are stored in Cloud Run environment variables
- The `keys/` directory is in `.gitignore`

### 6. Cloud Run Environment Variables - CRITICAL
**DANGER: `--set-env-vars` REPLACES ALL env vars!**
- Using `--set-env-vars` will DELETE all existing environment variables and only set the ones you specify
- This will break your deployment if you forget any required variables (Zendesk, Salesforce, OAuth, etc.)
- **Always use `--update-env-vars` to add or modify individual variables**
- If you need to set multiple variables at once, use `--env-vars-file` with a YAML file

**Handling commas in env var values:**
- Cloud Run interprets commas as separators in `--update-env-vars`
- For values with commas (like `GITHUB_PROJECT_NUMBERS=1,2,3`), use semicolons instead: `GITHUB_PROJECT_NUMBERS=1;2;3`
- The backend code must support both separators (see `loadGitHubConfig()` which uses `/[,;]/` regex)
- Alternative: Use `--env-vars-file` with a YAML file where commas work normally

**Recovering from broken env vars:**
1. Get env vars from a working revision: `gcloud run revisions describe REVISION_NAME --region=us-central1 --format="get(spec.containers[0].env)"`
2. Create a YAML file with all required variables
3. Deploy with `--env-vars-file`: `gcloud run deploy csm-dashboard --image=gcr.io/PROJECT/IMAGE:tag --env-vars-file=env.yaml`
4. Route traffic to the new revision: `gcloud run services update-traffic csm-dashboard --to-revisions=NEW_REVISION=100`

**Why Cloud Build fails after broken env vars:**
- Cloud Build's `gcloud run deploy` inherits the service's CURRENT env vars configuration
- If a previous manual `--set-env-vars` wiped the env vars, ALL subsequent Cloud Build deployments will fail
- The new image builds successfully but the deploy step fails because the service has missing required vars
- Error looks like: `Revision 'xxx' is not ready... container failed to start`

**Automation: Preventing this in CI/CD:**

Option 1: Use Google Secret Manager (Recommended for production)
- Store all env vars in Secret Manager
- Reference them in cloudbuild.yaml using `--set-secrets`
- Env vars are never lost since they're stored externally

Option 2: Maintain an env-vars backup file
- Keep a `production-env-vars.yaml` in a secure location (NOT in git)
- After any manual env var change, update this backup file
- If Cloud Build fails, restore using `--env-vars-file`

Option 3: Add env vars to cloudbuild.yaml (Less secure - env vars in build logs)
```yaml
# In cloudbuild.yaml, modify the deploy step:
- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  entrypoint: gcloud
  args:
    - 'run'
    - 'deploy'
    - 'csm-dashboard'
    - '--image'
    - 'gcr.io/$PROJECT_ID/csm-dashboard:$COMMIT_SHA'
    - '--region'
    - 'us-central1'
    - '--platform'
    - 'managed'
    - '--env-vars-file'
    - 'production-env-vars.yaml'  # Must exist in repo or be generated
```

**Quick fix when Cloud Build is broken:**
```bash
# 1. Find a working revision
gcloud run revisions list --service=csm-dashboard --region=us-central1 --limit=5

# 2. Route traffic to working revision immediately
gcloud run services update-traffic csm-dashboard --to-revisions=WORKING_REVISION=100 --region=us-central1

# 3. Get env vars from working revision and save to file
gcloud run revisions describe WORKING_REVISION --region=us-central1 --format="get(spec.containers[0].env)" > /tmp/env-backup.txt

# 4. Manually deploy with correct env vars (creates new revision)
gcloud run deploy csm-dashboard --image=gcr.io/csm-dashboard-deque/csm-dashboard:latest --env-vars-file=/path/to/env.yaml --region=us-central1

# 5. Future Cloud Builds will now work since service has correct env vars
```

### 7. GitHub Integration
- **Required env vars**: `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_PROJECT_NUMBERS`
- `GITHUB_PROJECT_NUMBERS` should be semicolon-separated in Cloud Run (e.g., `246;248;212`)
- Current projects: `246;248;212;186;64;188;181;243;179;114;216`

### 8. Checking Production Logs
```bash
# Recent logs
gcloud run services logs read csm-dashboard --region=us-central1 --project=csm-dashboard-deque --limit=50

# Search for errors
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="csm-dashboard" AND severity>=ERROR' --project=csm-dashboard-deque --limit=20

# Check startup logs for config issues
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="csm-dashboard" AND textPayload:("Server running" OR "OAuth" OR "SF_PRIVATE_KEY")' --project=csm-dashboard-deque --limit=10
```

### 9. Cloud Run Service Updates Create New Revisions - Always Route Traffic!

**CRITICAL**: When you run `gcloud run services update` (e.g., to change min-instances, env vars, or other settings), it creates a **new revision** but may NOT automatically route traffic to it.

**Symptoms**: You made a change but it's not taking effect, or you see regressions (old code running).

**Always follow service updates with:**
```bash
gcloud run services update-traffic csm-dashboard --region=us-central1 --to-latest --project=csm-dashboard-deque
```

**Check current traffic routing:**
```bash
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque --format="value(status.traffic[0].revisionName)"
```

### 10. Database Persistence (Cloud SQL PostgreSQL)

**Production uses Cloud SQL PostgreSQL 18** (as of Feb 2026):
- **Instance**: `csm-dashboard-db` (connection: `csm-dashboard-deque:us-central1:csm-dashboard-db`)
- **Database**: `csm_dashboard`
- **User**: `postgres`
- Data persists across restarts, deployments, and scale-to-zero events
- Cloud Run connects via Cloud SQL Auth Proxy (Unix socket at `/cloudsql/<instance>`)
- `min-instances=0` is safe — no data loss on scale-to-zero

**SQLite mode** (local development fallback):
- Default when no `PG_DATABASE` or `INSTANCE_CONNECTION_NAME` env var is set
- Stored in `backend/data/zendesk-cache.db`
- Data lost on Cloud Run restart (not used in production)

**Cloud SQL env vars** (set in Cloud Run):
- `INSTANCE_CONNECTION_NAME=csm-dashboard-deque:us-central1:csm-dashboard-db`
- `PG_DATABASE=csm_dashboard`
- `PG_USER=postgres`
- `PG_PASSWORD=<stored in Cloud Run>`

**BIGINT requirement**: Zendesk IDs (e.g., `37418035591188`) exceed PostgreSQL `INTEGER` max (~2.1B). All ID columns use `BIGINT`. The `pg` library returns BIGINT as strings by default — we use `types.setTypeParser(20, ...)` to parse as JS numbers (safe since Zendesk IDs are within `Number.MAX_SAFE_INTEGER`).

**Check min-instances setting:**
```bash
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque \
  --format="yaml(spec.template.metadata.annotations)" | grep -E "minScale|maxScale"
```

### 11. Release Notes
**Always update `/RELEASE_NOTES.md` when deploying new features or significant changes to production.** This file is linked from the dashboard footer and serves as the user-facing changelog. Add a new version section at the top with the date and a summary of changes.

### 12. CSS Class Naming Convention
**All renewal view components must use `renewal-*` CSS classes**, NOT `prs-*` classes. The CSS is defined in `frontend/src/index.css`:
- `renewal-filter-bar`, `renewal-search-wrapper`, `renewal-search-icon`, `renewal-search-input` — for filter/search controls
- `renewal-stats-grid`, `renewal-stat-card`, `renewal-stat-content`, `renewal-stat-icon`, `renewal-stat-value`, `renewal-stat-label` — for stat cards
- `renewal-table-container`, `renewal-table` — for data tables
- `renewal-loading`, `renewal-empty-state` — for loading/empty states

When creating new views (like ClosedWonView, ClosedLostView), always verify the CSS classes exist in `index.css` before using them. The `prs-*` prefix is only for PRS card components in `cached.ts` route views, not for renewal tab views.

### 13. Server-Side API Response Caching
External API calls (Salesforce, Amplitude) are cached in memory with TTL to eliminate redundant requests:
- **Cache utility**: `backend/src/services/cache.ts` — `MemoryCache` class with configurable TTL
- **Three cache instances**: `renewalsCache` (5 min TTL), `amplitudeCache` (15 min TTL), `salesforceCache` (10 min TTL)
- **Pre-warming**: After each sync (`syncAll()`), renewals and subscriptions caches are pre-populated
- **Cache invalidation**: Caches are cleared at the start of sync pre-warming, so fresh data replaces stale entries
- When adding new external API routes, always wrap them with caching to prevent slow page loads

### 14. Salesforce Account ID Matching (15 vs 18 characters)
- Salesforce returns **18-character** Account IDs (e.g., `0015000001Z0wZ3AAJ`)
- Zendesk stores IDs as **15-character** in the `salesforce_id` custom field (e.g., `0015000001Z0wZ3`)
- The sync code must match by 15-char prefix: index by both `sfIdToOrg.set(id, org)` and `sfIdToOrg.set(id.substring(0, 15), org)`
- **CRITICAL**: Zendesk orgs with a real Account ID (`001*`) in `salesforce_id` must NOT be re-mapped by fuzzy name matching to a different account. Only Enterprise object IDs (`a4o*`) can be overridden.
- When looking up SF Account IDs, always use the CSM assignment data (source of truth) — never guess IDs by fuzzy name search

### 15. Account Hierarchy and Org Matching
- SF accounts form a tree: parent accounts have child accounts (e.g., "The Walt Disney Co" → "Disney Technology Services Co. LLC")
- CSM assignments exist on both parent and child accounts
- Zendesk orgs map to individual SF accounts via `salesforce_id`
- The sync matches by: (1) SF ID exact match, (2) fuzzy name match as fallback
- Fuzzy matching uses: collapsed alphanumeric comparison, domain-to-name matching, acronym-to-initials, word boundary matching
- Common words (bank, university, digital, service, etc.) are blacklisted from substring matching to prevent false positives
- Script to batch-fix Zendesk SF IDs: `scripts/fix-zendesk-sf-ids.py` (--dry-run or --apply)

### 16. Amplitude Usage Data Architecture
- Enterprise UUID (`Enterprise_UUID__c` on `Enterprise_Subscription__c`) is the linking key between SF and Amplitude
- `gp:organization` in Amplitude stores UUIDs for DevTools Extension; human-readable names for other products
- Unified endpoint `GET /api/amplitude/unified/:orgIdentifier` fetches all products in parallel
- Axe Monitor uses `gp:initial_referring_domain` with `contains` match (workaround until UUID is deployed)
- Products tracked: Axe Accounts, DevTools Extension, Developer Hub, DevTools Mobile, Axe Assistant, Deque University, Axe Monitor
- Products removed: Axe Auditor (no org tracking), Axe Linter (no data), MCP Server (no data), Axe Reports (no gp:organization data)
- Cache TTLs: renewals 10min, amplitude 30min, salesforce 30min, health scores 30min

### 17. Customer Health Dashboard
- Three dimensions: Product Adoption, Customer Engagement, Support
- Each gets green/yellow/red signal with individual sub-signals
- Adoption: seat activation % (SF subscriptions), product breadth
- Engagement: exec sponsor (SF AccountContactRole), stakeholder breadth, last contact date
- Support: sev-weighted ticket volume, escalations, bug:how-to ratio (Zendesk tickets)
- Support trends computed by comparing last-90d vs prior-90d ticket windows
- Manual health score from `CS_Health__c` field in SF displayed alongside automated score
- Batch endpoint `POST /api/health/batch` for bulk scoring (reduces N individual calls to 3 bulk SF queries)
- Frontend caches health scores client-side for 5 minutes to avoid duplicate fetches

---

## Key Files

| File | Description |
|------|-------------|
| `/backend/src/index.ts` | Main server entry point, initializes all services |
| `/backend/src/services/database-interface.ts` | Shared `IDatabaseService` interface and type definitions |
| `/backend/src/services/database.ts` | SQLite implementation of `IDatabaseService` |
| `/backend/src/services/database-pg.ts` | PostgreSQL implementation of `IDatabaseService` |
| `/backend/src/services/salesforce.ts` | Salesforce JWT auth and API integration |
| `/backend/src/services/sync.ts` | Sync service (Zendesk, Salesforce, GitHub) |
| `/backend/src/services/agent.ts` | AI chat agent with tool definitions |
| `/backend/src/services/cache.ts` | In-memory TTL cache for Salesforce/Amplitude API responses |
| `/backend/src/routes/health.ts` | Customer health score computation (adoption, engagement, support) |
| `/backend/src/routes/amplitude.ts` | Amplitude routes including unified usage endpoint |
| `/frontend/src/components/HealthView.tsx` | Health tab with drill-down and scoring methodology |
| `/frontend/src/components/CustomerHealthCard.tsx` | Health score card (compact and full modes) |
| `/frontend/src/components/UnifiedUsageSection.tsx` | Unified usage data display by product |
| `/frontend/src/App.tsx` | Main React app with routing and layout |
| `/scripts/fix-zendesk-sf-ids.py` | Batch-fix Zendesk SF ID fields (15→18 char upgrade) |
| `/RELEASE_NOTES.md` | User-facing changelog (linked from dashboard footer) |
| `/Dockerfile` | Multi-stage Docker build for Cloud Run |
| `/cloudbuild.yaml` | Cloud Build configuration (includes Cloud SQL instance) |

---

## Google OAuth Configuration

### Required Environment Variables
- `GOOGLE_CLIENT_ID`: OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET`: OAuth client secret (must match Client ID)
- `GOOGLE_CALLBACK_URL`: The redirect URI (must match Console)
- `ALLOWED_DOMAIN`: Domain to restrict login (default: `deque.com`)

### Authorized Redirect URIs
The following URIs must be added to your Google Cloud Console OAuth credentials:

**Local Development:**
```
http://localhost:3001/api/auth/google/callback
```

**Production (Cloud Run):**
```
https://csm-dashboard-iow4tellka-uc.a.run.app/api/auth/google/callback
```

### Authorized JavaScript Origins
Also add these to "Authorized JavaScript origins":
```
http://localhost:3001
https://csm-dashboard-iow4tellka-uc.a.run.app
```

### Configuring in Google Cloud Console
1. Go to [APIs & Credentials](https://console.cloud.google.com/apis/credentials)
2. Click on your OAuth 2.0 Client ID (must be "Web application" type)
3. Under "Authorized redirect URIs", add both callback URIs above
4. Under "Authorized JavaScript origins", add both origins above
5. Save changes
6. **Copy both Client ID and Client Secret** and update Cloud Run if needed

---

## Troubleshooting

### "secretOrPrivateKey must be an asymmetric key when using RS256"
- The Salesforce private key is not being read correctly
- **Most Common Cause**: PEM file has Windows line endings (CRLF instead of LF)
  - Check: `file keys/salesforce.pem` - should NOT say "with CRLF line terminators"
  - Fix: `tr -d '\r' < keys/salesforce.pem > keys/salesforce_unix.pem` then re-encode
- In production: Ensure `SF_PRIVATE_KEY` is base64-encoded with Unix line endings
- The code auto-detects and decodes base64 (see `loadSalesforceConfig()` in index.ts)
- Check logs for "SF_PRIVATE_KEY: decoded from base64" to confirm decoding works
- Even if decoding shows success, the decoded key may be invalid if original had CRLF

### Build fails with native module errors
- Check that you're using Node.js 20, not 22+
- Run `npm rebuild` if switching Node versions

### Cloud Run service not updating after push
1. Check build completed: `gcloud builds list --limit=1 --project=csm-dashboard-deque`
2. Check which revision is serving traffic (see above)
3. Route traffic to latest if needed (see above)

### Cloud Build succeeds but deployment fails with "container failed to start"
- **Most likely cause**: A previous `--set-env-vars` wiped all environment variables
- Cloud Build inherits the service's current (broken) env vars configuration
- The build step succeeds but deploy step fails because required env vars are missing
- **Fix**: See "Quick fix when Cloud Build is broken" in section 6 above
- Check logs for the failing revision to confirm: `gcloud logging read "resource.labels.revision_name=FAILING_REVISION"` - look for "Missing required environment variables"

### Local SQLite errors
- Delete `backend/data/cache.db` and restart the server to rebuild the cache

### PostgreSQL "value is out of range for type integer"
- Zendesk IDs exceed PostgreSQL `INTEGER` max (~2.1B). All ID columns must be `BIGINT`.
- If you see this after a schema change, drop and recreate tables: `docker exec csm-postgres psql -U postgres -d csm_dashboard -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`

### PostgreSQL returns empty data but sync shows success
- The `pg` library returns `BIGINT` as strings. If `types.setTypeParser(20, ...)` is missing, Set/Map lookups fail (string vs number mismatch).
- Check `database-pg.ts` has: `types.setTypeParser(20, (val: string) => parseInt(val, 10));`

### API routes return "API endpoint not found" (404)
- Routes depending on `db`/`sync`/`agent` are registered in `startServer()` after async initialization
- Static files and SPA fallback must be registered AFTER all API routes (also in `startServer()`)
- If you move route registration, ensure it happens before `app.listen()` but after service initialization

### OAuth "redirect_uri_mismatch" error
- The callback URL is not registered in Google Cloud Console
- OR the GOOGLE_CLIENT_ID in Cloud Run doesn't match the OAuth client where URIs are configured
- Verify Client ID matches: check Cloud Run env vars vs Google Console

### OAuth "TokenError: Unauthorized"
- The GOOGLE_CLIENT_SECRET doesn't match the GOOGLE_CLIENT_ID
- Both must be from the same OAuth client in Google Cloud Console
- Update both if you change either one

### Renewals not loading in production
1. Check Salesforce auth: look for JWT errors in logs
2. Verify SF_CLIENT_ID, SF_USERNAME, and SF_PRIVATE_KEY are set correctly
3. Ensure SF_AUTH_TYPE=jwt and SF_LOGIN_URL=https://login.salesforce.com
4. Confirm traffic is routed to the latest revision with the fixes

### "Missing required environment variables: ZENDESK_SUBDOMAIN..." after deployment
- You likely used `--set-env-vars` instead of `--update-env-vars`, which deleted all other env vars
- Recovery steps:
  1. Route traffic back to a working revision: `gcloud run services update-traffic csm-dashboard --to-revisions=WORKING_REVISION=100`
  2. Get env vars from working revision: `gcloud run revisions describe WORKING_REVISION --format="get(spec.containers[0].env)"`
  3. Create a YAML file with all variables and redeploy with `--env-vars-file`

### Dashboard is slow or shows "Loading..." for extended time
- **Cause**: Cold start - the instance was scaled to zero. With Cloud SQL PostgreSQL, data is preserved but the instance still needs ~30s to start.
- **Check**: `gcloud run services describe csm-dashboard --region=us-central1 --format="yaml(spec.template.metadata.annotations)" | grep minScale`
- **Fix**: Set `min-instances=1` to eliminate cold starts (see section 10 above)
- **Note**: With PostgreSQL, cold starts are faster since data doesn't need to be re-synced from APIs. After deployment, new revisions still need ~1-2 min to warm up, but old revision serves traffic during this time.

### Changes not taking effect after `gcloud run services update`
- **Cause**: Service updates create new revisions but may not route traffic to them
- **Check**: `gcloud run services describe csm-dashboard --region=us-central1 --format="value(status.traffic[0].revisionName)"` - compare with latest revision
- **Fix**: `gcloud run services update-traffic csm-dashboard --region=us-central1 --to-latest` (see section 9 above)
- **Prevention**: Always run `--to-latest` after any service update

---

## Quick Reference Commands

```bash
# Check build status
gcloud builds list --limit=3 --project=csm-dashboard-deque

# Check current serving revision
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque --format="value(status.traffic[0].revisionName)"

# Route traffic to latest
gcloud run services update-traffic csm-dashboard --region=us-central1 --to-latest --project=csm-dashboard-deque

# Update env var
gcloud run services update csm-dashboard --region=us-central1 --update-env-vars="VAR=value" --project=csm-dashboard-deque

# View recent logs
gcloud run services logs read csm-dashboard --region=us-central1 --project=csm-dashboard-deque --limit=50

# Get service URL
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque --format="value(status.url)"

# Check min-instances setting
gcloud run services describe csm-dashboard --region=us-central1 --project=csm-dashboard-deque --format="yaml(spec.template.metadata.annotations)" | grep -E "minScale|maxScale"

# Enable always-on (eliminate cold starts, ~$15-30/month) - ALWAYS route traffic after!
gcloud run services update csm-dashboard --region=us-central1 --min-instances=1 --project=csm-dashboard-deque && \
gcloud run services update-traffic csm-dashboard --region=us-central1 --to-latest --project=csm-dashboard-deque

# Disable always-on (scale to zero, $0 when idle) — safe with Cloud SQL PostgreSQL
gcloud run services update csm-dashboard --region=us-central1 --min-instances=0 --project=csm-dashboard-deque

# Cloud SQL: connect to production database
gcloud sql connect csm-dashboard-db --database=csm_dashboard --user=postgres --project=csm-dashboard-deque

# Cloud SQL: check instance status
gcloud sql instances describe csm-dashboard-db --project=csm-dashboard-deque --format="value(state)"
```
