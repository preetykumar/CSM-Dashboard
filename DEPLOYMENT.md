# CSM Dashboard Deployment Guide

This guide covers deploying the CSM Dashboard to Google Cloud Platform using:
- **Cloud Run** for the backend API
- **Firebase Hosting** for the frontend

## Prerequisites

### 1. Install Google Cloud SDK

```bash
# macOS (using Homebrew)
brew install --cask google-cloud-sdk

# Or download from:
# https://cloud.google.com/sdk/docs/install
```

After installation, authenticate:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### 2. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 3. Enable Required APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

## Project Setup

### 1. Create a Google Cloud Project

```bash
gcloud projects create csm-dashboard --name="CSM Dashboard"
gcloud config set project csm-dashboard
```

### 2. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Select your existing Google Cloud project (csm-dashboard)
4. Enable Firebase Hosting

### 3. Link Firebase to the Project

```bash
cd frontend
firebase init hosting
# Select "Use an existing project" and choose csm-dashboard
# Public directory: dist
# Single-page app: Yes
# Don't overwrite firebase.json (it's already configured)
```

## Backend Deployment (Cloud Run)

### Option A: Using the Deployment Script

```bash
chmod +x deploy.sh
GCP_PROJECT_ID=csm-dashboard ./deploy.sh backend
```

### Option B: Manual Deployment

```bash
cd backend

# Deploy to Cloud Run
gcloud run deploy csm-dashboard-api \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi
```

### Configure Environment Variables

After deployment, set environment variables in Cloud Run:

```bash
gcloud run services update csm-dashboard-api \
  --region us-central1 \
  --set-env-vars "ZENDESK_SUBDOMAIN=your-subdomain" \
  --set-env-vars "ZENDESK_EMAIL=your-email@example.com" \
  --set-env-vars "ZENDESK_API_TOKEN=your-token" \
  --set-env-vars "SF_CLIENT_ID=your-sf-client-id" \
  --set-env-vars "SF_CLIENT_SECRET=your-sf-client-secret" \
  --set-env-vars "SF_LOGIN_URL=https://login.salesforce.com" \
  --set-env-vars "GOOGLE_CLIENT_ID=your-google-client-id" \
  --set-env-vars "GOOGLE_CLIENT_SECRET=your-google-client-secret" \
  --set-env-vars "GOOGLE_CALLBACK_URL=https://YOUR-CLOUD-RUN-URL/api/auth/google/callback" \
  --set-env-vars "SESSION_SECRET=your-random-secret" \
  --set-env-vars "FRONTEND_URL=https://csm-dashboard.web.app"
```

Or use the Cloud Run Console:
1. Go to [Cloud Run Console](https://console.cloud.google.com/run)
2. Click on your service
3. Click "Edit & Deploy New Revision"
4. Under "Variables & Secrets", add the environment variables

## Frontend Deployment (Firebase Hosting)

### Option A: Using the Deployment Script

```bash
GCP_PROJECT_ID=csm-dashboard ./deploy.sh frontend
```

### Option B: Manual Deployment

```bash
cd frontend
npm run build
firebase deploy --only hosting
```

## Full Deployment

Deploy both backend and frontend:

```bash
GCP_PROJECT_ID=csm-dashboard ./deploy.sh all
```

## Post-Deployment Configuration

### 1. Update Google OAuth Redirect URI

After getting your Cloud Run URL, update the Google OAuth credentials:

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add the authorized redirect URI: `https://YOUR-CLOUD-RUN-URL/api/auth/google/callback`

### 2. Update Firebase Hosting Rewrites

The frontend's `firebase.json` is configured to proxy `/api/**` requests to Cloud Run. Make sure the `serviceId` matches your Cloud Run service name.

### 3. Custom Domain (Optional)

**For Firebase Hosting:**
1. Go to Firebase Console > Hosting
2. Click "Add custom domain"
3. Follow the DNS configuration steps

**For Cloud Run:**
1. Go to Cloud Run Console
2. Click on your service > "Manage Custom Domains"
3. Add your domain and configure DNS

## Troubleshooting

### Cloud Run Build Fails

Check that all dependencies are in package.json:
```bash
cd backend
npm ci
npm run build
```

### Firebase Deploy Fails

Ensure you're logged in and have the correct project:
```bash
firebase login
firebase use csm-dashboard
```

### CORS Issues

Make sure `FRONTEND_URL` environment variable in Cloud Run matches your Firebase Hosting URL exactly.

### SQLite in Cloud Run

The backend uses SQLite which is ephemeral on Cloud Run. Data persists until the container is recycled. For production, consider:
- Using Cloud SQL (PostgreSQL/MySQL)
- Using Cloud Firestore
- Mounting a persistent volume (Cloud Run with GCS FUSE)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Firebase Hosting                      │
│                  (csm-dashboard.web.app)                │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │              React SPA (Vite)                    │   │
│   └─────────────────────────────────────────────────┘   │
│                          │                               │
│                    /api/* proxy                          │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      Cloud Run                           │
│               (csm-dashboard-api)                        │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │            Express.js Backend                    │   │
│   │           - Zendesk API Client                   │   │
│   │           - Salesforce API Client                │   │
│   │           - SQLite Cache                         │   │
│   │           - Google OAuth                         │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌─────────────────┐      ┌─────────────────┐
     │   Zendesk API    │      │  Salesforce API  │
     └─────────────────┘      └─────────────────┘
```
