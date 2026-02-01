# Zendesk Customer Dashboard

A full-stack application that connects to your Zendesk instance and provides a dashboard to view ticket summaries by customer.

## Features

- **Customer Summaries**: View ticket statistics for each organization
- **Status Breakdown**: See open, pending, and solved ticket counts
- **Priority Analysis**: Visualize ticket priority distribution
- **Recent Tickets**: Quick access to the most recent tickets per customer

## Project Structure

```
zendesk-dashboard/
├── backend/                 # Express.js API server
│   └── src/
│       ├── index.ts        # Server entry point
│       ├── routes/         # API route handlers
│       ├── services/       # Zendesk API client
│       └── types/          # TypeScript definitions
├── frontend/               # React + Vite application
│   └── src/
│       ├── App.tsx         # Main application
│       ├── components/     # React components
│       └── services/       # API client
└── package.json            # Monorepo configuration
```

## Prerequisites

- Node.js 18+
- A Zendesk instance with API access
- Zendesk API token

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example environment file and add your Zendesk credentials:

```bash
cp .env.example backend/.env
```

Edit `backend/.env` with your credentials:

```
ZENDESK_SUBDOMAIN=dequehelp
ZENDESK_EMAIL=your-email@example.com
ZENDESK_API_TOKEN=your-api-token
```

### 3. Get a Zendesk API Token

1. Log into your Zendesk instance as an admin
2. Go to **Admin Center** > **Apps and integrations** > **APIs** > **Zendesk API**
3. Enable token access and create a new API token
4. Copy the token value

## Running the Application

### Development mode

Run both backend and frontend concurrently:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Backend (runs on http://localhost:3001)
npm run dev:backend

# Terminal 2 - Frontend (runs on http://localhost:5173)
npm run dev:frontend
```

### Production build

```bash
npm run build
npm start
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/tickets` | List all tickets |
| `GET /api/tickets/:id` | Get ticket by ID |
| `GET /api/tickets/search?q=` | Search tickets |
| `GET /api/organizations` | List all organizations |
| `GET /api/organizations/:id` | Get organization by ID |
| `GET /api/organizations/:id/summary` | Get customer summary |
| `GET /api/organizations/summaries/all` | Get all customer summaries |

## Tech Stack

- **Backend**: Express.js, TypeScript, Axios
- **Frontend**: React, Vite, TypeScript
- **API**: Zendesk REST API
