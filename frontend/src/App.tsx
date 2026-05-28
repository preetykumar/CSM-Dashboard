import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { SyncButton } from "./components/SyncButton";
import { SupportCustomersView } from "./components/SupportCustomersView";
import { PMProjectsView } from "./components/PMProjectsView";
import { DeploymentsView } from "./components/deployments/DeploymentsView";
import { ProductView } from "./components/ProductView";
import { LoginPage } from "./components/LoginPage";
import { UserMenu } from "./components/UserMenu";
import { ChatWidget } from "./components/chat";
import { CustomerUsageView } from "./components/CustomerUsageView";
import RenewalAgent from "./components/RenewalAgent";
import { PRSRenewalView } from "./components/PRSRenewalView";
import { CSMRenewalView } from "./components/CSMRenewalView";
import { CustomerRenewalView } from "./components/CustomerRenewalView";
import { MonthlyRenewalView } from "./components/MonthlyRenewalView";
import { QuarterlyRenewalView } from "./components/QuarterlyRenewalView";
import { ClosedWonView } from "./components/ClosedWonView";
import { ClosedLostView } from "./components/ClosedLostView";
import { ProcessAuditView } from "./components/ProcessAuditView";
import { HomePage } from "./components/HomePage";
import { HomeView } from "./components/portfolio/HomeView";
import { PortfolioView } from "./components/portfolio/PortfolioView";
import { HealthView } from "./components/HealthView";
import { ProductUsageView } from "./components/ProductUsageView";
import { OverdueRenewalsView } from "./components/OverdueRenewalsView";
import { DeploymentTemplatesView } from "./components/admin/DeploymentTemplatesView";
import { DeploymentTemplateDetailView } from "./components/admin/DeploymentTemplateDetailView";
import { useAuth } from "./contexts/AuthContext";
import { ChatProvider } from "./contexts/ChatContext";
import { ToastProvider } from "./components/renewal/ToastProvider";

// Route configuration for easy reference
const ROUTES = {
  // Home (role-scoped portfolio + widgets)
  HOME: "/home",

  // Renewals — consolidated top-level tab (Pipeline / Closed / By Owner)
  RENEWALS_UPCOMING: "/renewals/upcoming",
  RENEWALS_MONTHLY: "/renewals/monthly",
  RENEWALS_QUARTERLY: "/renewals/quarterly",
  RENEWALS_OVERDUE: "/renewals/overdue",
  RENEWALS_CLOSED_WON: "/renewals/closed-won",
  RENEWALS_CLOSED_LOST: "/renewals/closed-lost",
  RENEWALS_BY_CSM: "/renewals/by-csm",
  RENEWALS_BY_SPECIALIST: "/renewals/by-specialist",

  // Deployments — deep-link target only (no top-nav tab yet)
  DEPLOYMENTS: "/deployments",

  // Customer persona (entity drilldown)
  CUSTOMER_SUPPORT: "/customer/support",
  CUSTOMER_USAGE: "/customer/usage",
  CUSTOMER_RENEWALS: "/customer/renewals",
  CUSTOMER_HEALTH: "/customer/health",

  // Product persona (product-wide views)
  PRODUCT_SUPPORT: "/product/support",
  PRODUCT_USAGE: "/product/usage",

  // Process Audit (admin-only, reached from UserMenu)
  PROCESS_AUDIT: "/process-audit",
} as const;

// Dashboard with routing
function Dashboard() {
  const location = useLocation();

  // Determine active main tab based on current path
  const getActiveMainTab = () => {
    if (location.pathname.startsWith("/home")) return "home";
    if (location.pathname.startsWith("/renewals")) return "renewals";
    if (location.pathname.startsWith("/customer")) return "customer";
    if (location.pathname.startsWith("/product")) return "product";
    if (location.pathname.startsWith("/process-audit")) return "process-audit";
    if (location.pathname.startsWith("/deployments")) return "deployments";
    return "home";
  };

  const activeMainTab = getActiveMainTab();

  // Get hint text based on current route
  const getHintText = () => {
    switch (location.pathname) {
      case ROUTES.CUSTOMER_SUPPORT:
        return null; // Handled in SupportCustomersView
      case ROUTES.CUSTOMER_USAGE:
        return "View product usage metrics by customer organization";
      case ROUTES.CUSTOMER_RENEWALS:
        return "View renewal opportunities grouped by customer account";
      case ROUTES.CUSTOMER_HEALTH:
        return "Customer health scores — adoption, engagement, and support";
      case ROUTES.RENEWALS_UPCOMING:
        return "All upcoming renewal opportunities across accounts";
      case ROUTES.RENEWALS_MONTHLY:
        return "Renewal opportunities grouped by calendar month";
      case ROUTES.RENEWALS_QUARTERLY:
        return "Renewal opportunities grouped by fiscal quarter";
      case ROUTES.RENEWALS_OVERDUE:
        return "Renewals past their close date that have not been closed won or lost";
      case ROUTES.RENEWALS_CLOSED_WON:
        return "Renewals with Closed Won status";
      case ROUTES.RENEWALS_CLOSED_LOST:
        return "Renewals with Closed Lost status";
      case ROUTES.RENEWALS_BY_CSM:
        return "Renewal opportunities grouped by Customer Success Manager";
      case ROUTES.RENEWALS_BY_SPECIALIST:
        return "Renewal opportunities grouped by Product Renewal Specialist";
      case ROUTES.PRODUCT_SUPPORT:
        return "View tickets grouped by product, request type, and issue subtype";
      case ROUTES.PRODUCT_USAGE:
        return "Aggregate usage metrics across all customers by product";
      case ROUTES.DEPLOYMENTS:
        return "Active implementation projects from Kantata, with team and budget health from Salesforce";
      case ROUTES.PROCESS_AUDIT:
        return "Stale R-6 actions (>5 months overdue) for process review";
      default:
        return null;
    }
  };

  const hintText = getHintText();
  const isRenewals = activeMainTab === "renewals";

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div className="app-brand">
            <span className="app-brand-name">Post-sales Customer Team Portal</span>
          </div>
          <div className="header-actions">
            <SyncButton />
            <UserMenu />
          </div>
        </div>

        {/* Main Tab Navigation */}
        <nav className="main-tabs" aria-label="Main navigation">
          <NavLink
            to={ROUTES.HOME}
            className={activeMainTab === "home" ? "active" : ""}
            aria-current={activeMainTab === "home" ? "page" : undefined}
          >
            Home
          </NavLink>
          <NavLink
            to={ROUTES.RENEWALS_UPCOMING}
            className={activeMainTab === "renewals" ? "active" : ""}
            aria-current={activeMainTab === "renewals" ? "page" : undefined}
          >
            Renewals
          </NavLink>
          <NavLink
            to={ROUTES.DEPLOYMENTS}
            className={activeMainTab === "deployments" ? "active" : ""}
            aria-current={activeMainTab === "deployments" ? "page" : undefined}
          >
            Deployments
          </NavLink>
          <NavLink
            to={ROUTES.CUSTOMER_SUPPORT}
            className={activeMainTab === "customer" ? "active" : ""}
            aria-current={activeMainTab === "customer" ? "page" : undefined}
          >
            Customer
          </NavLink>
          <NavLink
            to={ROUTES.PRODUCT_SUPPORT}
            className={activeMainTab === "product" ? "active" : ""}
            aria-current={activeMainTab === "product" ? "page" : undefined}
          >
            Product
          </NavLink>
        </nav>

        {/* Renewals Sub-tabs — grouped: Pipeline / Closed / By Owner */}
        {isRenewals && (
          <nav className="sub-tabs sub-tabs-grouped" aria-label="Renewals views">
            <span className="sub-tab-group-label">Pipeline:</span>
            <NavLink to={ROUTES.RENEWALS_UPCOMING}>Upcoming</NavLink>
            <NavLink to={ROUTES.RENEWALS_MONTHLY}>By Month</NavLink>
            <NavLink to={ROUTES.RENEWALS_QUARTERLY}>By Quarter</NavLink>
            <NavLink to={ROUTES.RENEWALS_OVERDUE}>Overdue</NavLink>

            <span className="sub-tab-group-divider" aria-hidden />
            <span className="sub-tab-group-label">Closed:</span>
            <NavLink to={ROUTES.RENEWALS_CLOSED_WON}>Won</NavLink>
            <NavLink to={ROUTES.RENEWALS_CLOSED_LOST}>Lost</NavLink>

            <span className="sub-tab-group-divider" aria-hidden />
            <span className="sub-tab-group-label">By Owner:</span>
            <NavLink to={ROUTES.RENEWALS_BY_CSM}>By CSM</NavLink>
            <NavLink to={ROUTES.RENEWALS_BY_SPECIALIST}>By Specialist</NavLink>
          </nav>
        )}

        {/* Customer Sub-tabs */}
        {activeMainTab === "customer" && (
          <nav className="sub-tabs" aria-label="Customer views">
            <NavLink to={ROUTES.CUSTOMER_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.CUSTOMER_USAGE}>
              Usage Data
            </NavLink>
            <NavLink to={ROUTES.CUSTOMER_RENEWALS}>
              Renewals
            </NavLink>
            <NavLink to={ROUTES.CUSTOMER_HEALTH}>
              Health
            </NavLink>
          </nav>
        )}

        {/* Product Sub-tabs */}
        {activeMainTab === "product" && (
          <nav className="sub-tabs" aria-label="Product views">
            <NavLink to={ROUTES.PRODUCT_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_USAGE}>
              Usage Data
            </NavLink>
          </nav>
        )}

        {hintText && <p className="hint">{hintText}</p>}
      </header>

      {/* Route-based content */}
      <main>
        <Routes>
          {/* Home — merged HomeView (greeting + widgets + portfolio cards).
              Legacy HomePage kept at /home-legacy for layout comparison. */}
          <Route path="/home" element={<HomeView />} />
          <Route path="/home-legacy" element={<HomePage />} />
          <Route path="/portfolio" element={<PortfolioView />} />

          {/* Renewals — consolidated top-level tab */}
          <Route path="/renewals/upcoming" element={<RenewalAgent />} />
          <Route path="/renewals/monthly" element={<MonthlyRenewalView />} />
          <Route path="/renewals/quarterly" element={<QuarterlyRenewalView />} />
          <Route path="/renewals/overdue" element={<OverdueRenewalsView />} />
          <Route path="/renewals/closed-won" element={<ClosedWonView />} />
          <Route path="/renewals/closed-lost" element={<ClosedLostView />} />
          <Route path="/renewals/by-csm" element={<CSMRenewalView />} />
          <Route path="/renewals/by-specialist" element={<PRSRenewalView />} />

          {/* Deployments — deep-link target from card pills; no top-nav tab */}
          <Route path="/deployments" element={<DeploymentsView />} />
          {/* Legacy: PM Projects view kept at /deployments/projects for the
              broader Kantata-implementations view until DeploymentsView
              reaches feature parity */}
          <Route path="/deployments/projects" element={<PMProjectsView />} />

          {/* Customer Routes */}
          <Route path="/customer/support" element={<SupportCustomersView />} />
          <Route path="/customer/usage" element={<CustomerUsageView />} />
          <Route path="/customer/renewals" element={<CustomerRenewalView />} />
          <Route path="/customer/health" element={<HealthView />} />

          {/* Product Routes */}
          <Route path="/product/support" element={<ProductView />} />
          <Route path="/product/usage" element={<ProductUsageView />} />

          {/* Process Audit (admin-only, reached from UserMenu) */}
          <Route path="/process-audit" element={<ProcessAuditView />} />

          {/* Admin: Deployment Templates (Phase 2) */}
          <Route path="/admin/deployment-templates" element={<DeploymentTemplatesView />} />
          <Route path="/admin/deployment-templates/:id" element={<DeploymentTemplateDetailView />} />

          {/* Default redirects */}
          <Route path="/" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/renewals" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />
          <Route path="/customer" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />

          {/* Legacy URL redirects for bookmarks ────────────────────────── */}
          {/* Old role-based tabs → Home */}
          <Route path="/csm" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/csm/*" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/pm" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/pm/support" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/pm/usage" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/pm/projects" element={<Navigate to={ROUTES.DEPLOYMENTS} replace />} />
          <Route path="/field-engineers" element={<Navigate to={ROUTES.HOME} replace />} />

          {/* Old renewal URLs → new /renewals/* */}
          <Route path="/csm/renewals" element={<Navigate to={ROUTES.RENEWALS_BY_CSM} replace />} />
          <Route path="/renewal-specialist" element={<Navigate to={ROUTES.RENEWALS_BY_SPECIALIST} replace />} />
          <Route path="/product/renewals/upcoming" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />
          <Route path="/product/renewals/monthly" element={<Navigate to={ROUTES.RENEWALS_MONTHLY} replace />} />
          <Route path="/product/renewals/quarterly" element={<Navigate to={ROUTES.RENEWALS_QUARTERLY} replace />} />
          <Route path="/product/renewals/closed-won" element={<Navigate to={ROUTES.RENEWALS_CLOSED_WON} replace />} />
          <Route path="/product/renewals/closed-lost" element={<Navigate to={ROUTES.RENEWALS_CLOSED_LOST} replace />} />
          <Route path="/product/renewals/overdue" element={<Navigate to={ROUTES.RENEWALS_OVERDUE} replace />} />
          <Route path="/product/renewals" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />

          {/* Old support/usage URLs */}
          <Route path="/support/customers" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/support/csm" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/support/pm" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/support/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />
          <Route path="/usage/customers" element={<Navigate to={ROUTES.CUSTOMER_USAGE} replace />} />
          <Route path="/usage/csm" element={<Navigate to={ROUTES.HOME} replace />} />

          {/* Old PipelineStubs deep-links */}
          <Route path="/renewals-pipeline" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />
          <Route path="/deployments-pipeline" element={<Navigate to={ROUTES.DEPLOYMENTS} replace />} />

          {/* Old generic renewal URLs */}
          <Route path="/renewals/csm" element={<Navigate to={ROUTES.RENEWALS_BY_CSM} replace />} />
          <Route path="/renewals/prs" element={<Navigate to={ROUTES.RENEWALS_BY_SPECIALIST} replace />} />
          <Route path="/renewals/audit" element={<Navigate to={ROUTES.PROCESS_AUDIT} replace />} />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
        </Routes>
      </main>

      {/* AI Chat Assistant */}
      <ChatWidget />

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <span>CSM Dashboard v1.0.0 (MVP)</span>
          <span className="footer-separator">|</span>
          <a
            href="https://github.com/preetykumar/CSM-Dashboard/blob/main/RELEASE_NOTES.md"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            Release Notes
          </a>
          <span className="footer-separator">|</span>
          <a
            href="https://dequesrc.atlassian.net/jira/software/projects/CPI/boards/601"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            Submit Bug / Feature Request
          </a>
          <span className="footer-separator">|</span>
          <span>&copy; {new Date().getFullYear()} Deque Systems</span>
        </div>
      </footer>
    </div>
  );
}

function App() {
  const { authenticated, authEnabled, loading } = useAuth();

  if (loading) {
    return (
      <div className="app">
        <div className="loading" aria-live="polite">Loading...</div>
      </div>
    );
  }

  // If auth is enabled and user is not authenticated, show login
  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  // Otherwise show the dashboard with chat and routing
  return (
    <BrowserRouter>
      <ToastProvider>
        <ChatProvider>
          <Dashboard />
        </ChatProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
