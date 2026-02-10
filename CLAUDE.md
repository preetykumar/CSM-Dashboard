# CSM Dashboard - Development Guide

## Project Overview
This is a Customer Success Management dashboard with:
- **Frontend**: React 18 + TypeScript + Vite (in `/frontend`)
- **Backend**: Node.js 20 + Express + TypeScript (in `/backend`)
- **Database**: SQLite for local caching
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
# Terminal 1: Backend
cd backend
npm install
npm run dev

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

- Backend runs on http://localhost:3001
- Frontend runs on http://localhost:5173

### Local Build
```bash
# Build backend
cd backend && npm run build

# Build frontend
cd frontend && npm run build
```

---

## Production Deployment (Google Cloud Run)

### Project Details
- **GCP Project**: `csm-dashboard-deque`
- **Cloud Run Service**: `csm-dashboard`
- **Region**: `us-central1`
- **Production URL**: `https://csm-dashboard-iow4tellka-uc.a.run.app`

### CI/CD Pipeline
- **Cloud Build Trigger**: Automatically deploys on push to `main` branch
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

---

## Key Files

| File | Description |
|------|-------------|
| `/backend/src/index.ts` | Main server entry point, initializes all services |
| `/backend/src/services/salesforce.ts` | Salesforce JWT auth and API integration |
| `/backend/src/services/agent.ts` | AI chat agent with tool definitions |
| `/frontend/src/App.tsx` | Main React app with routing and layout |
| `/Dockerfile` | Multi-stage Docker build for Cloud Run |
| `/cloudbuild.yaml` | Cloud Build configuration |

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
```
