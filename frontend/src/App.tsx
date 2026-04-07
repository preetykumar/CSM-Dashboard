import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { SyncButton } from "./components/SyncButton";
import { SupportCustomersView } from "./components/SupportCustomersView";
import { CSMPortfolioView } from "./components/CSMPortfolioView";
import { PMPortfolioView } from "./components/PMPortfolioView";
import { ProductView } from "./components/ProductView";
import { LoginPage } from "./components/LoginPage";
import { UserMenu } from "./components/UserMenu";
import { ChatWidget } from "./components/chat";
import { CustomerUsageView } from "./components/CustomerUsageView";
import { CSMUsageView } from "./components/CSMUsageView";
import RenewalAgent from "./components/RenewalAgent";
import { PRSRenewalView } from "./components/PRSRenewalView";
import { CSMRenewalView } from "./components/CSMRenewalView";
import { CustomerRenewalView } from "./components/CustomerRenewalView";
import { MonthlyRenewalView } from "./components/MonthlyRenewalView";
import { QuarterlyRenewalView } from "./components/QuarterlyRenewalView";
import { ClosedWonView } from "./components/ClosedWonView";
import { ClosedLostView } from "./components/ClosedLostView";
import { ProcessAuditView } from "./components/ProcessAuditView";
import { ComingSoonPlaceholder } from "./components/ComingSoonPlaceholder";
import { HomePage } from "./components/HomePage";
import { useAuth } from "./contexts/AuthContext";
import { ChatProvider } from "./contexts/ChatContext";
import { ToastProvider } from "./components/renewal/ToastProvider";

// Route configuration for easy reference
const ROUTES = {
  // Home
  HOME: "/home",
  // CSM persona (role-based)
  CSM_SUPPORT: "/csm/support",
  CSM_USAGE: "/csm/usage",
  CSM_RENEWALS: "/csm/renewals",
  CSM_PROJECTS: "/csm/projects",
  // PM persona (role-based)
  PM_SUPPORT: "/pm/support",
  PM_USAGE: "/pm/usage",
  PM_PROJECTS: "/pm/projects",
  // Renewal Specialist (role-based — formerly Renewals > By PRS)
  RENEWAL_SPECIALIST: "/renewal-specialist",
  // Field Engineers (role-based — coming soon)
  FIELD_ENGINEERS: "/field-engineers",
  // Customer persona
  CUSTOMER_SUPPORT: "/customer/support",
  CUSTOMER_USAGE: "/customer/usage",
  CUSTOMER_RENEWALS: "/customer/renewals",
  // Product persona
  PRODUCT_SUPPORT: "/product/support",
  PRODUCT_USAGE: "/product/usage",
  PRODUCT_RENEWALS_UPCOMING: "/product/renewals/upcoming",
  PRODUCT_RENEWALS_MONTHLY: "/product/renewals/monthly",
  PRODUCT_RENEWALS_QUARTERLY: "/product/renewals/quarterly",
  PRODUCT_RENEWALS_CLOSED_WON: "/product/renewals/closed-won",
  PRODUCT_RENEWALS_CLOSED_LOST: "/product/renewals/closed-lost",
  // Process Audit (admin-only)
  PROCESS_AUDIT: "/process-audit",
} as const;

// Dashboard with routing
function Dashboard() {
  const { isAdmin } = useAuth();
  const location = useLocation();

  // Determine active main tab based on current path
  const getActiveMainTab = () => {
    if (location.pathname.startsWith("/home")) return "home";
    if (location.pathname.startsWith("/csm")) return "csm";
    if (location.pathname.startsWith("/pm")) return "pm";
    if (location.pathname.startsWith("/renewal-specialist")) return "renewal-specialist";
    if (location.pathname.startsWith("/field-engineers")) return "field-engineers";
    if (location.pathname.startsWith("/customer")) return "customer";
    if (location.pathname.startsWith("/product")) return "product";
    if (location.pathname.startsWith("/process-audit")) return "process-audit";
    return "customer";
  };

  const activeMainTab = getActiveMainTab();
  const isProductRenewals = location.pathname.startsWith("/product/renewals");

  // Get hint text based on current route
  const getHintText = () => {
    switch (location.pathname) {
      case ROUTES.CUSTOMER_SUPPORT:
        return null; // Handled in SupportCustomersView
      case ROUTES.CUSTOMER_USAGE:
        return "View product usage metrics by customer organization";
      case ROUTES.CUSTOMER_RENEWALS:
        return "View renewal opportunities grouped by customer account";
      case ROUTES.CSM_SUPPORT:
        return "View tickets grouped by CSM and their customer portfolio";
      case ROUTES.CSM_USAGE:
        return "View product usage metrics grouped by CSM portfolio";
      case ROUTES.CSM_RENEWALS:
        return "View renewal opportunities grouped by Customer Success Manager";
      case ROUTES.CSM_PROJECTS:
        return "Active projects grouped by CSM (coming soon)";
      case ROUTES.PM_SUPPORT:
        return "View tickets and analytics grouped by Project Manager for report compilation";
      case ROUTES.PM_USAGE:
        return "PM usage analytics (coming soon)";
      case ROUTES.PM_PROJECTS:
        return "Active projects grouped by PM (coming soon)";
      case ROUTES.RENEWAL_SPECIALIST:
        return "View renewal opportunities grouped by Product Renewal Specialist";
      case ROUTES.FIELD_ENGINEERS:
        return "Field Engineer portfolio views (coming soon)";
      case ROUTES.PRODUCT_SUPPORT:
        return "View tickets grouped by product, request type, and issue subtype";
      case ROUTES.PRODUCT_USAGE:
        return "Product usage analytics (coming soon)";
      case ROUTES.PRODUCT_RENEWALS_UPCOMING:
        return "View all upcoming renewal opportunities across accounts";
      case ROUTES.PRODUCT_RENEWALS_MONTHLY:
        return "View renewal opportunities grouped by calendar month";
      case ROUTES.PRODUCT_RENEWALS_QUARTERLY:
        return "View renewal opportunities grouped by fiscal quarter";
      case ROUTES.PRODUCT_RENEWALS_CLOSED_WON:
        return "View renewals with Closed Won status";
      case ROUTES.PRODUCT_RENEWALS_CLOSED_LOST:
        return "View renewals with Closed Lost status";
      case ROUTES.PROCESS_AUDIT:
        return "Stale R-6 actions (>5 months overdue) for process review";
      default:
        return null;
    }
  };

  const hintText = getHintText();

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div>
            <h1>Post-sales Customer Team Portal</h1>
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
            to={ROUTES.CSM_SUPPORT}
            className={activeMainTab === "csm" ? "active" : ""}
            aria-current={activeMainTab === "csm" ? "page" : undefined}
          >
            CSM
          </NavLink>
          <NavLink
            to={ROUTES.PM_SUPPORT}
            className={activeMainTab === "pm" ? "active" : ""}
            aria-current={activeMainTab === "pm" ? "page" : undefined}
          >
            PM
          </NavLink>
          <NavLink
            to={ROUTES.RENEWAL_SPECIALIST}
            className={activeMainTab === "renewal-specialist" ? "active" : ""}
            aria-current={activeMainTab === "renewal-specialist" ? "page" : undefined}
          >
            Renewal Specialist
          </NavLink>
          <NavLink
            to={ROUTES.FIELD_ENGINEERS}
            className={`coming-soon-tab${activeMainTab === "field-engineers" ? " active" : ""}`}
            aria-current={activeMainTab === "field-engineers" ? "page" : undefined}
          >
            Field Engineers <span className="tab-badge-soon">Soon</span>
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
          {isAdmin && (
            <NavLink
              to={ROUTES.PROCESS_AUDIT}
              className={activeMainTab === "process-audit" ? "active" : ""}
              aria-current={activeMainTab === "process-audit" ? "page" : undefined}
            >
              Process Audit
            </NavLink>
          )}
        </nav>

        {/* CSM Sub-tabs */}
        {activeMainTab === "csm" && (
          <nav className="sub-tabs" aria-label="CSM views">
            <NavLink to={ROUTES.CSM_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.CSM_USAGE}>
              Usage Data
            </NavLink>
            <NavLink to={ROUTES.CSM_RENEWALS}>
              Renewals
            </NavLink>
            <NavLink to={ROUTES.CSM_PROJECTS} className="coming-soon-tab">
              Active Projects <span className="tab-badge-soon">Soon</span>
            </NavLink>
          </nav>
        )}

        {/* PM Sub-tabs */}
        {activeMainTab === "pm" && (
          <nav className="sub-tabs" aria-label="PM views">
            <NavLink to={ROUTES.PM_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.PM_USAGE} className="coming-soon-tab">
              Usage Data <span className="tab-badge-soon">Soon</span>
            </NavLink>
            <NavLink to={ROUTES.PM_PROJECTS} className="coming-soon-tab">
              Active Projects <span className="tab-badge-soon">Soon</span>
            </NavLink>
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
          </nav>
        )}

        {/* Product Sub-tabs */}
        {activeMainTab === "product" && (
          <nav className="sub-tabs" aria-label="Product views">
            <NavLink to={ROUTES.PRODUCT_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_USAGE} className="coming-soon-tab">
              Usage Data <span className="tab-badge-soon">Soon</span>
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS_UPCOMING}>
              Renewals
            </NavLink>
          </nav>
        )}

        {/* Product → Renewals third-level sub-tabs */}
        {activeMainTab === "product" && isProductRenewals && (
          <nav className="sub-sub-tabs" aria-label="Product Renewals views">
            <NavLink to={ROUTES.PRODUCT_RENEWALS_UPCOMING} end>
              Upcoming (All)
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS_MONTHLY}>
              By Month
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS_QUARTERLY}>
              By Quarter
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS_CLOSED_WON}>
              Closed Won
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS_CLOSED_LOST}>
              Closed Lost
            </NavLink>
          </nav>
        )}

        {hintText && <p className="hint">{hintText}</p>}
      </header>

      {/* Route-based content */}
      <main>
        <Routes>
          {/* Home */}
          <Route path="/home" element={<HomePage />} />

          {/* CSM Routes */}
          <Route path="/csm/support" element={<CSMPortfolioView />} />
          <Route path="/csm/usage" element={<CSMUsageView />} />
          <Route path="/csm/renewals" element={<CSMRenewalView />} />
          <Route path="/csm/projects" element={<ComingSoonPlaceholder title="CSM Active Projects" description="View active product implementations and service projects grouped by CSM. Data will be sourced from Salesforce." />} />

          {/* PM Routes */}
          <Route path="/pm/support" element={<PMPortfolioView />} />
          <Route path="/pm/usage" element={<ComingSoonPlaceholder title="PM Usage Analytics" description="View product usage metrics grouped by Project Manager portfolio." />} />
          <Route path="/pm/projects" element={<ComingSoonPlaceholder title="PM Active Projects" description="View active product implementations and service projects grouped by PM. Data will be sourced from Salesforce." />} />

          {/* Renewal Specialist Route */}
          <Route path="/renewal-specialist" element={<PRSRenewalView />} />

          {/* Field Engineers Route */}
          <Route path="/field-engineers" element={<ComingSoonPlaceholder title="Field Engineers" description="Field Engineer portfolio views coming soon." />} />

          {/* Customer Routes */}
          <Route path="/customer/support" element={<SupportCustomersView />} />
          <Route path="/customer/usage" element={<CustomerUsageView />} />
          <Route path="/customer/renewals" element={<CustomerRenewalView />} />

          {/* Product Routes */}
          <Route path="/product/support" element={<ProductView />} />
          <Route path="/product/usage" element={<ComingSoonPlaceholder title="Product Usage Analytics" description="View product usage metrics aggregated by product." />} />
          <Route path="/product/renewals/upcoming" element={<RenewalAgent />} />
          <Route path="/product/renewals/monthly" element={<MonthlyRenewalView />} />
          <Route path="/product/renewals/quarterly" element={<QuarterlyRenewalView />} />
          <Route path="/product/renewals/closed-won" element={<ClosedWonView />} />
          <Route path="/product/renewals/closed-lost" element={<ClosedLostView />} />

          {/* Process Audit Route (admin-only) */}
          <Route path="/process-audit" element={<ProcessAuditView />} />

          {/* Default redirects */}
          <Route path="/" element={<Navigate to={ROUTES.HOME} replace />} />
          <Route path="/csm" element={<Navigate to={ROUTES.CSM_SUPPORT} replace />} />
          <Route path="/pm" element={<Navigate to={ROUTES.PM_SUPPORT} replace />} />
          <Route path="/customer" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />
          <Route path="/product/renewals" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_UPCOMING} replace />} />

          {/* Legacy URL redirects for bookmarks */}
          <Route path="/support/customers" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/support/csm" element={<Navigate to={ROUTES.CSM_SUPPORT} replace />} />
          <Route path="/support/pm" element={<Navigate to={ROUTES.PM_SUPPORT} replace />} />
          <Route path="/support/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />
          <Route path="/usage/customers" element={<Navigate to={ROUTES.CUSTOMER_USAGE} replace />} />
          <Route path="/usage/csm" element={<Navigate to={ROUTES.CSM_USAGE} replace />} />
          <Route path="/renewals/csm" element={<Navigate to={ROUTES.CSM_RENEWALS} replace />} />
          <Route path="/renewals/upcoming" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_UPCOMING} replace />} />
          <Route path="/renewals/monthly" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_MONTHLY} replace />} />
          <Route path="/renewals/quarterly" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_QUARTERLY} replace />} />
          <Route path="/renewals/closed-won" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_CLOSED_WON} replace />} />
          <Route path="/renewals/closed-lost" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_CLOSED_LOST} replace />} />
          <Route path="/renewals/prs" element={<Navigate to={ROUTES.RENEWAL_SPECIALIST} replace />} />
          <Route path="/renewals/audit" element={<Navigate to={ROUTES.PROCESS_AUDIT} replace />} />
          <Route path="/renewals" element={<Navigate to={ROUTES.PRODUCT_RENEWALS_UPCOMING} replace />} />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
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
