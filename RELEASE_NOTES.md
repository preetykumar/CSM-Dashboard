# Post-sales Customer Team Portal - Release Notes

## Version 2.3.1

**Release Date:** May 29, 2026

### Hotfix: restore ARR + Usage tab, raise renewal default window

- **ARR badges visible again** on the customer banner (My Customers) and on every renewal opp row. Source switched from a non-existent `Enterprise_Subscription__c.Subscription_Total__c` field to `Account.ARR__c` — the field SF reports already use as the ARR source of truth.
- **Customer drilldown → Usage tab works again.** The same SOQL bug was blocking the subscriptions fetch, so the Usage tab could never get an Enterprise UUID. With subs flowing, exact-UUID products (DevTools Extension, Developer Hub, Deque University) match cleanly, and the existing name-contains fallback now actually fires for `axe-account-portal`, `axe-devtools-mobile`, and `axe-assistant`.
- **Renewals default window raised 60 → 365 days** on Upcoming, By CSM, and By Specialist. The 60-day default was hiding most of an open pipeline (e.g. Mark Washburn went from 2 visible opps to all 11).
- Schwarz Digits IT KG correctly shows no ARR pill — billing rolls up to the Schwarz Group parent in SF.

## Version 2.3.0

**Release Date:** May 28, 2026

### Deployment Plans, Customer 360° Page, Account Hierarchy, Deque Brand

**Deployment Plans (Phase 3 — full lifecycle):**
- New **Plans** sub-tab under Deployments, listing every plan grouped by customer with the same SF account hierarchy nesting used everywhere else
- **Create from template**: every deployment opp without a plan shows a "Create plan" row; opens a template picker that auto-suggests by product + deployment type (cloud / on-prem)
- **Admin manual create**: escape-hatch form for admins to spin up a plan outside their TSA tree (any account / opp / product / template combo)
- **Editable task tree**: click any row to open an inline edit panel — status (Not Started / In Progress / Complete / Delayed / At Risk / Blocked), start/end dates, Deque + customer responsibles, estimated/actual days, description, target outcome, notes. Saves immediately on click
- **Server-side parent status roll-up**: when a child status changes, the parent recomputes by worst-signal rule (Blocked > At Risk > Delayed > Complete-if-all > In Progress > Not Started). Walks bottom-up so multi-level plans settle correctly
- **Add / delete tasks**: +/× buttons on every row (cascade delete on subtree)
- **Plan-level edits**: change status or reassign TSA / IE (with a guard so non-admins can't accidentally lock themselves out)
- **Refresh from template (admin)**: pull in items added to the source template since the plan was created, preserving in-progress work — only items whose `template_item_id` isn't already in the plan get copied, with the parent chain preserved
- **Per-task audit history drawer**: clock icon on every row opens a right-side drawer showing who changed what when, rendered as a from→to diff per field. Plan-level audit available from the header
- **Filters above the tree**: free-text search across description / owner / notes, status dropdown, owner contains-match, clear button. Recursive filter keeps ancestors of matching rows so the hierarchy stays readable
- **Keyboard navigation**: `j` / `k` to walk rows, `space` to expand/collapse, `enter` to edit, `h` to open history. Suppressed when an input is focused or a modal is open
- **CSV export**: full-tree dump with hierarchy depth as a column, all editable fields, downloads as `plan-<id>-<product>.csv`
- **Permissions**: every mutation is gated to TSA / IE / admin; non-admin users see a "Read-only" badge instead of edit buttons. Audit history GET now also requires plan visibility (no leaking reassignment history to other authenticated users)

**Deployment Templates (admin):**
- New `/admin/deployment-templates` view with seed templates imported from xlsx — Milestone → Epic → Task tree per (product, deployment_type)
- Inline edit / add / delete on every template row; immediate audit-log writes
- "Session expired" recovery — admin pages now detect stale passport sessions (common after a backend restart) and offer a one-click "Sign in again" instead of a bare 403 banner

**Customer 360° page:**
- Unified **Customer** view replacing the four legacy sub-tabs — click any account to open a 4-tab drill-down: Health · Support · Usage · Active Deployments
- Active Deployments tab shows the account's SF deploy opps + line items alongside the matching Kantata workspaces
- Health / Support / Usage removed from the Deployments view; Kantata stays there for now (deployment-management tooling will grow on top of it)
- Customer page is scoped by role + logged-in user's email — TSAs see their accounts, CSMs see theirs, admins see all
- Admin sticky toggle + role selector so admins can simulate what each team will see

**Account hierarchy nesting (everywhere):**
- Parent → child SF account nesting rolled out across **every** view — Renewals (all 8 sub-views including Closed Won prototype), Deployments tree, Customer, Product, Plans, Portfolio
- Hierarchy is strict to portfolio scope — a parent only nests if it is also in the user's scope, so admins see full families and TSAs see only their own accounts
- "Phantom parent" rows when a parent has no own opps but anchors children below it (so hierarchy reads cleanly)
- Per-account rows in Support + Usage views show parent and children separately rather than merged

**Renewals — account-primary grouping:**
- Renewals views (Upcoming, By Month, By Quarter, Overdue, Closed Won, Closed Lost, By CSM, By PRS) now group by SF account first; the legacy month/quarter/CSM groupings nest inside
- Each row shows its own stats only — no rollup math across siblings, so the numbers stay easy to defend
- Closed Won + Closed Lost views use the same account-tree component so behavior is consistent

**Portfolio (Home) improvements:**
- New **right-rail layout** — portfolio cards take the full main column, calendar + personal todos stack in a 320px sticky right rail (collapses below cards on narrow screens)
- **Account search** at the top of the portfolio (substring match, recursive — searching for a subsidiary keeps its parent header visible) with live "N of M" count and X-to-clear
- **Renewal state classification** expanded from 3 buckets to 4:
  - **active** — open renewal with future date
  - **overdue** — open renewal whose date has passed (someone needs to chase it)
  - **churned** — no open renewal and had past Closed Won in renewal-relevant product family
  - **none** — no renewal history
  Overdue cards get an amber badge + pill ("Due 2026-04-15 (43d ago)") and a soft amber gradient background, sitting between active green and churned red
- **Zendesk match coverage fix** — the Home portfolio enrichment was only joining by SF ID prefix, ignoring the `salesforce_account_name` field that the sync's 8-strategy fuzzy matcher populates. Now falls back to the fuzzy-matched name, so accounts whose Zendesk org didn't have a `salesforce_id` set but were name-matched during sync no longer show as "no Zendesk match"
- **Support + Usage panels** wired into every CustomerCard (lazy-loaded behind "Load ticket list →" / "Load per-product usage →" buttons to avoid Amplitude rate limits on auto-expanded cards)

**Deployments (TSA Phase 1 + Phase 2):**
- Phase 1: TSA-scoped tree of customer → opportunity → product → Kantata workspace, with Kantata status filter and sticky preferences
- Phase 2: per-customer detail panel originally bundling Health / Support / Usage / Kantata (Health/Support/Usage subsequently moved into the Customer 360° page)
- Amplitude UUID + Monitor domain now derived from the customer's actual subscriptions (more reliable than name match)
- Support tab uses sync-time fuzzy-matched org names

**Amplitude (Axe Monitor + Axe Reports):**
- Both products switched to `gp:enterpriseId` exact-UUID match (was: Monitor on initial-referring-domain fallback, Reports on `gp:organization` name). Match rate jumps from ~30% to near-100% for accounts with a UUID

**Performance:**
- `/api/csm/portfolios` was uncached, the audit's largest unmitigated cost — now wrapped with a 90s MemoryCache, so home + admin "View as" picker feel instant on repeat clicks
- `/api/calendar/events` now cached in-process for 5 min, keyed by user email + day window. Navigating away from `/home` and back no longer re-hits Google
- Both endpoints set `Cache-Control` so browsers can short-circuit too

**Brand identity:**
- Deque horizontal logo (SVG) in the app header next to "Customer 360°"
- Brand palette pulled from the SVG fills — primary teal #2e5f7a, secondary mauve #b25295, dark #2a2826, cream #f6f3ed
- `:root` token block in `index.css` retargets `--color-brand-*` scale at the Deque teal, neutrals shift to warm grays that sit alongside the cream surface, surfaces / borders / text colors all swap to brand tokens. Every existing `var(...)` reference now resolves to the real Deque palette instead of generic blue / cool gray fallbacks
- Header tagline updated to **Customer 360° — Deque's Customer Intelligence Platform**

**Authentication:**
- Session cookies extended to 30 days with rolling refresh — fewer "please log in again" interruptions during long working sessions
- Admin allow-list updated: removed michelle.viguerie, added eric.padron + ian.flanagan

---

## Version 2.2.0

**Release Date:** May 26, 2026

### Top-Nav Restructure, Design System, SF-Driven Portfolio

**Nav consolidation:**
- Top tabs collapsed from 8 to 5: **Home / Renewals / Deployments / Customer / Product**
- Old role tabs removed: CSM, PM, Renewal Specialist, Field Engineers
- **Home** is the new landing view — role-scoped portfolio cards (CSM / TSA / IE / PRS all land here)
- **Renewals** consolidates 8 previously-scattered renewal routes under grouped sub-tabs: Pipeline (Upcoming / By Month / By Quarter / Overdue) · Closed (Won / Lost) · By Owner (By CSM / By Specialist)
- **Deployments** brings back the Kantata-driven Active Implementations view
- **Process Audit** moved into the user-menu dropdown (admin-only)
- All legacy URLs (`/csm/*`, `/pm/*`, `/renewal-specialist`, `/product/renewals/*`) redirect to the new locations

**Design system:**
- New shared primitives in `frontend/src/components/ui/`: Page, PageHeader, Card, StatCard, StatGrid, Toolbar, Badge, Button, EmptyState, Banner, SectionHeader
- Design tokens at `frontend/src/styles/tokens.css` (color / spacing / radii / shadows / typography variables) — every new view consumes these
- Renewals stat-cards changed from rigid 2-column grid to responsive auto-fit
- Customer / Product / CSM cards migrated off the saturated purple gradient onto a neutral palette with soft shadows
- Fixes the Home view that previously rendered as bare HTML (its `home-view` / `portfolio-card` / etc. classes had no CSS definitions)

**Portfolio resolver (`/api/portfolio`):**
- Single source-of-truth endpoint returning role-scoped account tree from Salesforce role-assignment fields:
  - CSM: `Customer_Success_Manager_csm__c`
  - TSA: `Customer_Success_Manager__c`
  - IE: `Customer_Success_Engineer_CSE1/2/3__c`
  - PRS: `Customer_Success_Specialist__c`
- Hierarchy walk: non-admin sees only directly-assigned accounts; admin sees full family walk
- PRS users land on the Renewals pipeline (no per-customer portfolio drill-down)
- Health scoring deferred to a separate `/api/health/batch` call so portfolio cards render fast, then pills lazy-fill
- 90-second response cache keyed by `(role, email)` — repeat loads are sub-3ms

**Deployments wiring (Kantata × Salesforce):**
- Replaces the old task-title heuristic with an authoritative join via `OpportunityLineItem.ProductCode LIKE 'DEP-%'`
- A Kantata workspace surfaces only when its SF-ref (Account or Opportunity) ties to a closed-won opp containing one of the deployment SKUs (Self-Starter, Managed, On-Demand, etc.)
- Kantata workspaces + per-workspace task summaries now cached (15-min TTL), per-workspace task fetches parallelized

**Amplitude UUID matching:**
- `gp:enterpriseId` confirmed = `Enterprise_Subscription__c.Enterprise_UUID__c` (4,162/4,162 SF subs have a UUID; sample lookups: ADP, Deque, US Bank, Gainwell, etc.)
- 5 products switched to exact UUID match: **Axe DevTools Extension, Developer Hub, Deque University, Axe MCP Server, Axe Reports**
- 4 products stay on `gp:organization` name fallback until their UUID code ships: Axe Accounts, Axe DevTools Mobile, Axe Assistant, Axe Monitor
- Re-probe coverage at any time with `backend/scripts/spike-enterpriseid-probe.mjs`

**Product Usage view rebuild:**
- Hero stat: total active users this month + trend vs previous month
- Per-product stat grid: one card per product with headline active users + trend
- Expandable detail cards with 3-month event breakdown table

**Performance:**
- Portfolio cold response with full caches warm: ~1.8s (was 25-31s for large IE portfolios)
- Renewal-opp SF query scoped to assigned account IDs (was global scan); 5-6× speedup on cold reads

---

## Version 2.1.0

**Release Date:** May 8, 2026

### PM Active Projects View (Kantata + Salesforce)

**Active Projects:**
- New **Active Projects** tab under PM view, replacing the "Coming Soon" placeholder
- Pulls active **Implementation** projects directly from Kantata (formerly Mavenlink) — the SF-side Mavenlink object lacks the project-type and budget detail this view needs, so we hit Kantata's API directly
- Each project rendered as an expand/collapse card matching the existing renewal-card pattern
- **Account linkage**: Kantata's "SF Salesforce ID" custom field stores Lightning URLs pointing to the originating Opportunity; we extract the ID, resolve Opportunity → Account in bulk, then enrich

**Team & contact data (from Salesforce Account):**
- CSM, TSA (Technical Solutions Architect), Implementation Engineers (1–3), AE (Account Owner), Service Delivery Lead (Engagement Manager 1)
- Last customer contact pulled from `Account.LastActivityDate`
- Field-name to label mapping handled internally (SF labels and API names diverge, e.g. `Customer_Success_Manager__c` is actually labeled "TSA")

**Health rules (project flagged RED if either fires):**
- **Budget**: project marked over-budget by Kantata (`over_budget` flag set)
- **Schedule**: project started >90 days ago and has no end date set
- Hover over the RED pill to see the specific reason. Red projects sort to the top.

**Filters & search:**
- Search across project title, account, and any team member name
- "RED only" toggle to focus on at-risk projects
- Budget-type filter (True T&M, FF Plan, FF/T&M Nav, Other)
- Sort by Health, Account, Project, Budget, Used Budget, Start Date, or Last Contact

**Stats:**
- Active Implementations count
- RED count (any reason), Over Budget count, Stale Schedule count

**PM Tab Cleanup:**
- Removed "Usage Data (coming soon)" tab from PM view — was a placeholder with no concrete plan

**Performance:**
- Kantata data cached server-side for 15 minutes (cold fetch ~16s due to API pagination through ~1,150 active workspaces; warm fetch is instant)
- Bulk SF queries: Opportunity → Account resolution and team-role lookup batched at 200 IDs per query
- Refresh button bypasses the cache for on-demand updates

---

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
