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
- **Region**: `us-east1`

### CI/CD Pipeline
- **Cloud Build Trigger**: Automatically deploys on push to `main` branch
- Builds Docker image and deploys to Cloud Run
- Build takes ~5-7 minutes

### Checking Build Status
```bash
gcloud builds list --limit=3 --project=csm-dashboard-deque
```

### Production Environment Variables

**CRITICAL**: Environment variables in Cloud Run are set via the Cloud Console or gcloud CLI, NOT by editing a file.

To update environment variables:
```bash
gcloud run services update csm-dashboard \
  --region=us-east1 \
  --update-env-vars="VAR_NAME=value" \
  --project=csm-dashboard-deque
```

Or use Cloud Console: Cloud Run > csm-dashboard > Edit & Deploy New Revision > Variables & Secrets

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
- Encode the key: `base64 -i keys/private-key.pem | tr -d '\n'`
- The backend automatically detects and decodes base64-encoded keys (if they don't start with `-----BEGIN`)

### 3. Production Credentials
- **Never commit** `.env` files or private keys to git
- Production credentials are stored in Cloud Run environment variables
- The `keys/` directory is in `.gitignore`

### 4. Checking Production Logs
```bash
gcloud run services logs read csm-dashboard --region=us-east1 --project=csm-dashboard-deque --limit=50
```

### 5. Testing Production Endpoints
```bash
# Health check
curl https://csm-dashboard-<hash>-ue.a.run.app/api/health

# Check renewals (requires auth)
# Use the app UI to test authenticated endpoints
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
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
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

### Configuring in Google Cloud Console
1. Go to [APIs & Credentials](https://console.cloud.google.com/apis/credentials)
2. Click on your OAuth 2.0 Client ID
3. Under "Authorized redirect URIs", add both URIs above
4. Save changes

---

## Troubleshooting

### "secretOrPrivateKey must be an asymmetric key when using RS256"
- The Salesforce private key is not being read correctly
- In production: Ensure `SF_PRIVATE_KEY` is base64-encoded
- The code auto-detects and decodes base64 (see `loadSalesforceConfig()` in index.ts)

### Build fails with native module errors
- Check that you're using Node.js 20, not 22+
- Run `npm rebuild` if switching Node versions

### Cloud Run service not updating
- Check Cloud Build logs: `gcloud builds log <BUILD_ID> --project=csm-dashboard-deque`
- Verify the build trigger is properly configured in Cloud Console

### Local SQLite errors
- Delete `backend/data/cache.db` and restart the server to rebuild the cache

### OAuth "redirect_uri_mismatch" error
- The callback URL is not registered in Google Cloud Console
- Add the URL to "Authorized redirect URIs" in your OAuth credentials
- Local: `http://localhost:3001/api/auth/google/callback`
- Production: `https://csm-dashboard-iow4tellka-uc.a.run.app/api/auth/google/callback`
