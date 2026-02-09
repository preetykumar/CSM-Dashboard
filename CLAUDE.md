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
- Encode the key:
  ```bash
  base64 -i keys/private-key.pem | tr -d '\n'
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

### 6. Checking Production Logs
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
- In production: Ensure `SF_PRIVATE_KEY` is base64-encoded
- The code auto-detects and decodes base64 (see `loadSalesforceConfig()` in index.ts)
- Check logs for "SF_PRIVATE_KEY: decoded from base64" to confirm decoding works

### Build fails with native module errors
- Check that you're using Node.js 20, not 22+
- Run `npm rebuild` if switching Node versions

### Cloud Run service not updating after push
1. Check build completed: `gcloud builds list --limit=1 --project=csm-dashboard-deque`
2. Check which revision is serving traffic (see above)
3. Route traffic to latest if needed (see above)

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
