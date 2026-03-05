# CSM Dashboard - Release Notes

## Version 1.4.0

**Release Date:** March 4, 2026

### Performance, Renewal Labels, and CSM Portfolio Matching

**Performance:**
- **By Customer view loads 50-100x faster**: Replaced sequential per-org API calls (N+1 pattern) with a single bulk endpoint. Page loads in under 1 second instead of 30+ seconds.

**Renewal Views:**
- Overdue banner now reads "X missed milestones across all renewals" (was "X renewal actions are overdue")
- Stat card renamed from "Urgent Actions" to "Needs Action" for clarity
- Filter button renamed from "Urgent" to "Needs Action"
- Closed Lost renewals excluded from all stat cards and toast counts
- Toast notifications now show separate counts for critical (past renewal date), urgent (R-2/R-3 overdue), and high (R-6 overdue)

**CSM Portfolio Matching:**
- Improved account name matching between Salesforce and Zendesk:
  - Reverse word-boundary matching (e.g., "Purina" now matches "Nestle Purina")
  - Parenthesized acronym matching (e.g., "British American Tobacco" matches "...Limited (BAT)")
  - Reverse startsWith matching (e.g., "KPMG" matches "KPMG UK", "British Telecom" matches "British Telecommunications PLC")
- Engagement Manager fallback: accounts with no CSM but with an EM who is a known CSM are added to that CSM's portfolio
- Re-introduced parent hierarchy expansion for grouping related subsidiaries

---

## Version 1.3.0

**Release Date:** February 27, 2026

### Salesforce Parent Account Consolidation

Support ticket views now consolidate child Zendesk organizations under their Salesforce ultimate parent account. For example, "ADP-Corp", "ADP Enterprise", "ADP, Inc.", and "ADP-WFN" all roll up under a single "ADP" entry.

**Changes:**
- **By Customer view**: Accounts are grouped by Salesforce parent hierarchy. Consolidated accounts show "(X accounts)" subtitle and aggregate all ticket stats across child orgs.
- **By CSM / By PM views**: Portfolio endpoints now expand org assignments to include all sibling orgs sharing the same parent account, so ticket counts match the By Customer view.
- **Critical Defects pill**: CSM and PM card headers now show an orange "critical" pill for accounts with urgent or high priority active tickets (clickable for drilldown).
- **Salesforce pagination**: Account hierarchy fetch now supports paginated SOQL queries (previously capped at 2,000 records, now fetches all 12,000+).
- **New database table**: `account_hierarchy` stores resolved Salesforce parent-child relationships with ultimate parent resolution.

---

## Version 1.2.0

**Release Date:** February 26, 2026

### PostgreSQL Support & Persistent Storage

- Added Cloud SQL PostgreSQL as production database for persistent cache across deployments
- SQLite remains available for local development

---

## Version 1.1.0

**Release Date:** February 24-26, 2026

### GitHub Integration, Subscription Dates & PM Portfolio

- GitHub development status pills on all ticket views (By Customer, By CSM, By PM, By Product)
- Enterprise subscription start/end dates in license views
- PM Portfolio view for support tickets

---

## Version 1.0.0 (MVP)

**Release Date:** February 9, 2026

---

## Overview

The CSM Dashboard is a comprehensive Customer Success Management platform designed for Deque Systems. It consolidates customer support data, product usage analytics, and renewal management into a single unified interface, empowering Customer Success Managers (CSMs) and Product Renewal Specialists (PRS) to proactively manage customer relationships.

---

## Key Features

### 1. Support Tickets Module

#### By Customer View
- **Customer Summary Cards**: At-a-glance view of each customer's support ticket status
- **Smart Filters**: Quickly filter accounts by status
  - All Accounts
  - Escalated (accounts with escalated tickets)
  - Critical Defects (accounts with urgent/high priority active tickets)
- **Alphabetical Navigation**: Browse accounts by name (A-D, E-H, I-L, M-P, Q-T, U-Z)
- **Search with Autocomplete**: Fast account lookup with real-time suggestions
- **Pagination**: Configurable page sizes (10, 25, 50, 100) for large customer lists
- **Drill-down Details**: Click any account to view full ticket history and details
- **Status/Priority Filtering**: Click on status or priority counts to filter tickets

#### By CSM (QBR View)
- **CSM Portfolio Grouping**: View tickets organized by assigned CSM
- **QBR-Ready Data**: Pre-aggregated metrics for quarterly business reviews
- **CSM Assignment Matching**: Intelligent matching using accent-normalized names from Salesforce

#### By Product View
- **Product Categorization**: Tickets grouped by product, request type, and issue subtype
- **GitHub Integration**: Status pills showing related GitHub issue status
- **Product Backlog Cards**: Visual representation of product-specific ticket backlogs

### 2. Usage Analytics Module

#### By Customer View
- **Product Usage Metrics**: Quarterly usage data from Amplitude
- **Product Categories**:
  - axe DevTools (Pro, Linter, Mobile, Developer Hub, MCP Server, axe Assistant)
  - axe Monitor
  - Deque University
  - axe Auditor
  - axe Reports
  - axe Account Portal
- **Quarterly Comparisons**: View usage trends across current, previous, and two quarters ago
- **License Management**: View license allocations from Salesforce Enterprise Subscriptions
- **Organization Consolidation**: Intelligent matching of Amplitude organizations to Salesforce accounts

#### By CSM (QBR View)
- **Portfolio Usage Overview**: Aggregate usage across all accounts in a CSM's portfolio
- **Expandable Account Details**: Drill down into individual account usage
- **Loading State Management**: Smooth loading spinners for async data fetching

### 3. Renewals Module

#### Upcoming Renewals (All)
- **Renewal Agent Interface**: View all upcoming renewal opportunities
- **Time-Based Filtering**: 30, 60, 90, 120, or 180-day lookahead windows
- **Sortable Columns**: Sort by any field including renewal date, amount, stage
- **Search Functionality**: Find specific accounts or opportunities
- **At Risk Indicators**: Visual highlighting of at-risk renewals

#### By PRS (QBR View)
- **PRS Portfolio Grouping**: Renewals organized by Product Renewal Specialist
- **Expandable PRS Cards**: Click to view detailed opportunity list
- **Workflow Engine**: Automatic action recommendations based on renewal timeline
  - R-6: Initial contact
  - R-4/R-3: Send quote
  - R-2: Mark ready for invoicing
  - R-1: Send payment reminder
  - R: Final reminder (grace period)
- **Email Composer**: Template-based email generation for renewal communications
- **Stats Dashboard**:
  - Total Renewals count
  - Unique Accounts
  - Total Pipeline Value
  - Urgent Actions needed
  - At Risk count and value

### 4. Authentication & Security

- **Google OAuth Integration**: Secure login with @deque.com domain restriction
- **Admin Controls**: Admin users can trigger data synchronization
- **Session Management**: Secure session handling with user menu

### 5. AI Chat Assistant

- **Contextual Help**: AI-powered assistant for dashboard guidance
- **Chat Widget**: Floating chat interface accessible from any view

---

## Technical Architecture

### Frontend
- **React 18** with TypeScript
- **Vite** build tooling
- **CSS Modules** for styling
- Responsive design for various screen sizes

### Backend
- **Node.js 20** with Express
- **TypeScript** for type safety
- **SQLite** for local caching
- RESTful API architecture

### Integrations
- **Zendesk**: Support ticket data via REST API
- **Salesforce**: CSM assignments, enterprise subscriptions, renewal opportunities via JWT OAuth
- **Amplitude**: Product usage analytics via Export API
- **GitHub**: Issue tracking status

### Deployment
- **Google Cloud Run**: Auto-scaling containerized backend
- **Cloud Build**: CI/CD pipeline with automated deployments on push to main
- **Docker**: Multi-stage builds for optimized images

---

## Data Sources

| Source | Data Retrieved |
|--------|----------------|
| Zendesk | Organizations, tickets, ticket metrics, comments |
| Salesforce | CSM assignments, PRS assignments, enterprise subscriptions, renewal opportunities, account details |
| Amplitude | Product usage events (logins, feature usage, page views) |
| GitHub | Issue status for linked tickets |

---

## Known Limitations (MVP)

1. **Email Sending**: Email composer generates templates but doesn't actually send emails (integration pending)
2. **Real-time Updates**: Data is cached; manual sync required for latest updates
3. **Amplitude Rate Limits**: Usage data fetching respects API rate limits
4. **Browser Support**: Optimized for modern browsers (Chrome, Firefox, Safari, Edge)

---

## Upcoming Features (Post-MVP)

- Real-time WebSocket updates for ticket changes
- Automated email sending via SendGrid/Mailgun
- Custom dashboard layouts and saved views
- Export functionality (CSV, PDF reports)
- Slack integration for notifications
- Mobile-responsive improvements

---

## Support

For issues or feature requests, please contact the development team or file an issue in the repository.

---

## Credits

Built by the Deque Systems Engineering Team with assistance from Claude AI.
