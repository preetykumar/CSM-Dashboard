# Post-sales Customer Team Portal - Release Notes

## Version 2.0.0

**Release Date:** April 26, 2026

### Customer Health Dashboard, Usage Data Overhaul, Account Mapping Fixes

**Customer Health Dashboard:**
- Three-dimension health scoring: **Product Adoption**, **Customer Engagement**, **Support** with green/yellow/red indicators
- **Per-product adoption scores** — each product scored individually on Activation, Depth, and Velocity
- Product-specific thresholds: DevTools (seat %, scans/user), Monitor (page capacity, projects), DU (session %, downloads), and more
- Axe Monitor scored on pages processed and projects (not seats). Linter excluded from overall score (uses lines of code, local usage not tracked)
- Monthly directionality: trend arrows showing month-over-month improvement or decline for each signal
- Manual health score from Salesforce (CS_Health__c) displayed alongside automated scores
- Scoring methodology fully transparent via info (i) button with per-product threshold tables
- Signal combination guide: interpretations for key patterns (silent adopter, shelfware, engaged-struggling, etc.)
- Health tab under both CSM and Customer views with searchable, filterable account list and drill-down
- Batch health endpoint for performance (50 accounts per call instead of individual requests)

**Usage Data:**
- **Monthly granularity**: Last 3 calendar months with trend arrows (was quarterly)
- **Unified endpoint**: Single API call fetches all product metrics in parallel (was 30+ sequential calls)
- **10 products tracked**: Axe Accounts, DevTools Extension, Developer Hub, DevTools Mobile, Axe Assistant, Deque University, Axe Monitor, Axe Reports, Axe Linter, Axe MCP Server
- **Per-product events**: Product-specific metrics with user-friendly labels (Active Users, Scans, Messages, etc.)
- **Subscription data merged into usage table**: Licensed/assigned seats shown per product inline (no separate license banner)
- **Monitor shows page tiers** (10K/25K/unlimited) and unique pages processed instead of seats
- **Enterprise UUID matching**: Amplitude data matched by Enterprise UUID for DevTools, SF Account Name fallback for other products
- **Monitor workaround**: Uses domain-based matching via initial_referring_domain until gp:organization is deployed

**Account Mapping:**
- Fixed 15-char vs 18-char Salesforce ID matching (doubled SF ID matches from 67 to 182)
- Prevented fuzzy name matching from overriding explicit SF ID mappings
- Parent expansion now only includes sibling orgs with the same CSM assigned (prevents Audi appearing under Porsche's CSM)
- "No CSM Assigned" section in admin view for unassigned accounts with tickets
- Account matching rate improved from 84% to 98%
- Batch script for Zendesk SF ID corrections (scripts/fix-zendesk-sf-ids.py)

**Navigation & UI:**
- New Home tab with role selection, admin "View as" dropdown, calendar and Calendly widgets
- Admin users bypass role selection, show "Working as: Admin (simulating CSM)" with "Simulate role" button
- Health sub-tab added to CSM and Customer views
- Renewals moved under Product tab with third-level sub-tabs
- Process Audit is now admin-only top-level tab
- "Submit Bug / Feature Request" link in footer (Jira CPI board)
- Removed Renewal_at_Risk__c checkbox from all views (grandfathered)

**Performance:**
- Cache TTLs increased: renewals 10min, amplitude 30min, salesforce 30min
- Frontend health score dedup cache (5min) prevents duplicate fetches
- HTTP Cache-Control headers for browser caching
- Per-product health scores computed on frontend from existing data (zero additional API calls)

**Accessibility:**
- Focus traps on modals (OrganizationDrilldown, TicketListModal)
- Keyboard navigation for all interactive elements (cards, stats, filters)
- ARIA attributes: combobox for search, dialog/modal roles, button roles with aria-expanded
- Focus-visible outlines on all clickable elements
- Color contrast fixes: replaced #999/#888/#666 with #595959 for WCAG compliance
- prefers-reduced-motion support for animations
- Table headers use scope="col"

---

## Version 1.5.1

**Release Date:** March 5, 2026

### Responsive Stacked Cards for Renewals, Needs Action & At Risk Modals

**Renewals:**
- **Responsive card layout**: Renewal tables now convert to stacked cards on screens under 1800px wide, eliminating horizontal scrolling on laptops. Each renewal row displays as a card with labeled fields.
- **At-risk cards** get an orange left border accent; **urgent cards** get a red left border accent.
- **Needs Action modal**: Clicking the "Needs Action" stat card opens a modal listing all renewals that require action, with required actions shown as priority-colored badges.
- **At Risk definition updated**: Renewals are now flagged "At Risk" if the Leadership Risk Status dropdown has any value OR the Renewal at Risk checkbox is checked. The At Risk modal shows both the risk reason and leadership risk status.
- **Stats grid**: Now properly displays all 5 stat cards (Total, Accounts, Value, Needs Action, At Risk) in a single row on desktop.
- **Filter bar stacking**: Search, days picker, and filter buttons stack vertically on narrower screens.

---

## Version 1.5.0

**Release Date:** March 5, 2026

### Performance, UI Polish, and New Renewal Columns

**Performance:**
- **Renewals tab loads instantly on repeat visits**: Server-side in-memory caching (5 min TTL) for Salesforce renewal queries. First load hits Salesforce API; subsequent loads within 5 minutes are served from cache.
- **Usage tab loads instantly on repeat visits**: Server-side caching (15 min TTL) for all Amplitude API endpoints. Per-org and per-product metrics are cached after first fetch.
- **Subscription data cached**: Account subscription lookups cached for 10 minutes, eliminating redundant Salesforce calls on the Usage tab.
- **Cache pre-warming on sync**: Renewals and subscription caches are pre-populated after each data sync, so the first page load after sync is also fast.

**Renewals:**
- **Renewal at Risk column**: Displays the "Renewal at Risk" checkbox value from Salesforce across all renewal views.
- **Leadership Risk Status column**: Displays the "Leadership Risk Status" picklist value with color-coded badges (green=resolved, yellow=monitor, red=other).
- **Closed Won view**: New dedicated tab showing closed-won renewals with total count and value, matching the existing Closed Lost view pattern.
- **Draft Email removed from CSM view**: Email generation actions are now only available in the PRS view, reducing clutter for CSMs.

**UI:**
- Dashboard header renamed from "Customer Success Manager Dashboard" to "Post-sales Customer Team Portal"
- Login screen updated: title is now "Support, Product Usage, and Renewals Dashboard"
- Fixed CSS styling for search input and stats cards in Closed Won and Closed Lost views (were using non-existent CSS classes)

---

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
