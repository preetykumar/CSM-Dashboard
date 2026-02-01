#!/bin/bash

# CSM Dashboard Deployment Script
# Usage: ./deploy.sh [backend|frontend|all]

set -e

PROJECT_ID="${GCP_PROJECT_ID:-csm-dashboard-deque}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="csm-dashboard-api"

print_usage() {
    echo "Usage: $0 [backend|frontend|all]"
    echo ""
    echo "Commands:"
    echo "  backend   - Deploy backend to Cloud Run"
    echo "  frontend  - Deploy frontend to Firebase Hosting"
    echo "  all       - Deploy both backend and frontend"
    echo ""
    echo "Environment variables:"
    echo "  GCP_PROJECT_ID - Google Cloud project ID (default: csm-dashboard)"
    echo "  GCP_REGION     - Cloud Run region (default: us-central1)"
}

check_gcloud() {
    if ! command -v gcloud &> /dev/null; then
        echo "Error: gcloud CLI is not installed."
        echo "Install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi
}

check_firebase() {
    if ! command -v firebase &> /dev/null; then
        echo "Error: Firebase CLI is not installed."
        echo "Install it with: npm install -g firebase-tools"
        exit 1
    fi
}

deploy_backend() {
    echo "=== Deploying Backend to Cloud Run ==="
    check_gcloud

    cd backend

    echo "Building and deploying to Cloud Run..."
    gcloud run deploy $SERVICE_NAME \
        --source . \
        --project $PROJECT_ID \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated \
        --set-env-vars "NODE_ENV=production" \
        --memory 512Mi \
        --timeout 300

    # Get the service URL
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
        --project $PROJECT_ID \
        --region $REGION \
        --format 'value(status.url)')

    echo ""
    echo "Backend deployed to: $SERVICE_URL"
    echo ""
    echo "IMPORTANT: Set environment variables in Cloud Run console:"
    echo "  - ZENDESK_SUBDOMAIN"
    echo "  - ZENDESK_EMAIL"
    echo "  - ZENDESK_API_TOKEN"
    echo "  - SF_CLIENT_ID"
    echo "  - SF_CLIENT_SECRET"
    echo "  - SF_LOGIN_URL"
    echo "  - GOOGLE_CLIENT_ID"
    echo "  - GOOGLE_CLIENT_SECRET"
    echo "  - GOOGLE_CALLBACK_URL (set to $SERVICE_URL/api/auth/google/callback)"
    echo "  - SESSION_SECRET"
    echo "  - FRONTEND_URL"

    cd ..
}

deploy_frontend() {
    echo "=== Deploying Frontend to Firebase Hosting ==="
    check_firebase

    cd frontend

    echo "Building frontend..."
    npm run build

    echo "Deploying to Firebase Hosting..."
    firebase deploy --only hosting --project $PROJECT_ID

    cd ..

    echo ""
    echo "Frontend deployed successfully!"
}

case "$1" in
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        ;;
    all)
        deploy_backend
        deploy_frontend
        ;;
    *)
        print_usage
        exit 1
        ;;
esac

echo ""
echo "=== Deployment Complete ==="
