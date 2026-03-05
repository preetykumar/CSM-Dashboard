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
import { ClosedLostView } from "./components/ClosedLostView";
import { ProcessAuditView } from "./components/ProcessAuditView";
import { ComingSoonPlaceholder } from "./components/ComingSoonPlaceholder";
import { useAuth } from "./contexts/AuthContext";
import { ChatProvider } from "./contexts/ChatContext";
import { ToastProvider } from "./components/renewal/ToastProvider";

// Route configuration for easy reference
const ROUTES = {
  // Customer persona
  CUSTOMER_SUPPORT: "/customer/support",
  CUSTOMER_USAGE: "/customer/usage",
  CUSTOMER_RENEWALS: "/customer/renewals",
  // CSM persona
  CSM_SUPPORT: "/csm/support",
  CSM_USAGE: "/csm/usage",
  CSM_RENEWALS: "/csm/renewals",
  CSM_PROJECTS: "/csm/projects",
  // PM persona
  PM_SUPPORT: "/pm/support",
  PM_USAGE: "/pm/usage",
  PM_PROJECTS: "/pm/projects",
  // Product persona
  PRODUCT_SUPPORT: "/product/support",
  PRODUCT_USAGE: "/product/usage",
  PRODUCT_RENEWALS: "/product/renewals",
  // Renewals top-level
  RENEWALS_UPCOMING: "/renewals/upcoming",
  RENEWALS_MONTHLY: "/renewals/monthly",
  RENEWALS_PRS: "/renewals/prs",
  RENEWALS_QUARTERLY: "/renewals/quarterly",
  RENEWALS_CLOSED_LOST: "/renewals/closed-lost",
  RENEWALS_AUDIT: "/renewals/audit",
} as const;

// Dashboard with routing
function Dashboard() {
  useAuth();
  const location = useLocation();

  // Determine active main tab based on current path
  const getActiveMainTab = () => {
    if (location.pathname.startsWith("/customer")) return "customer";
    if (location.pathname.startsWith("/csm")) return "csm";
    if (location.pathname.startsWith("/pm")) return "pm";
    if (location.pathname.startsWith("/product")) return "product";
    if (location.pathname.startsWith("/renewals")) return "renewals";
    return "customer";
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
      case ROUTES.PRODUCT_SUPPORT:
        return "View tickets grouped by product, request type, and issue subtype";
      case ROUTES.PRODUCT_USAGE:
        return "Product usage analytics (coming soon)";
      case ROUTES.PRODUCT_RENEWALS:
        return "Renewals grouped by product (coming soon)";
      case ROUTES.RENEWALS_UPCOMING:
        return "View all upcoming renewal opportunities across accounts";
      case ROUTES.RENEWALS_MONTHLY:
        return "View renewal opportunities grouped by calendar month";
      case ROUTES.RENEWALS_PRS:
        return "View renewal opportunities grouped by Product Renewal Specialist";
      case ROUTES.RENEWALS_QUARTERLY:
        return "View renewal opportunities grouped by fiscal quarter";
      case ROUTES.RENEWALS_CLOSED_LOST:
        return "View renewals with Closed Lost status";
      case ROUTES.RENEWALS_AUDIT:
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
            <h1>Customer Success Manager Dashboard</h1>
          </div>
          <div className="header-actions">
            <SyncButton />
            <UserMenu />
          </div>
        </div>

        {/* Main Tab Navigation */}
        <nav className="main-tabs" aria-label="Main navigation">
          <NavLink
            to={ROUTES.CUSTOMER_SUPPORT}
            className={activeMainTab === "customer" ? "active" : ""}
          >
            Customer
          </NavLink>
          <NavLink
            to={ROUTES.CSM_SUPPORT}
            className={activeMainTab === "csm" ? "active" : ""}
          >
            CSM
          </NavLink>
          <NavLink
            to={ROUTES.PM_SUPPORT}
            className={activeMainTab === "pm" ? "active" : ""}
          >
            PM
          </NavLink>
          <NavLink
            to={ROUTES.PRODUCT_SUPPORT}
            className={activeMainTab === "product" ? "active" : ""}
          >
            Product
          </NavLink>
          <NavLink
            to={ROUTES.RENEWALS_UPCOMING}
            className={activeMainTab === "renewals" ? "active" : ""}
          >
            Renewals
          </NavLink>
        </nav>

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

        {/* Product Sub-tabs */}
        {activeMainTab === "product" && (
          <nav className="sub-tabs" aria-label="Product views">
            <NavLink to={ROUTES.PRODUCT_SUPPORT} end>
              Support Tickets
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_USAGE} className="coming-soon-tab">
              Usage Data <span className="tab-badge-soon">Soon</span>
            </NavLink>
            <NavLink to={ROUTES.PRODUCT_RENEWALS} className="coming-soon-tab">
              Renewals <span className="tab-badge-soon">Soon</span>
            </NavLink>
          </nav>
        )}

        {/* Renewals Sub-tabs */}
        {activeMainTab === "renewals" && (
          <nav className="sub-tabs" aria-label="Renewals views">
            <NavLink to={ROUTES.RENEWALS_UPCOMING} end>
              Upcoming (All)
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_MONTHLY}>
              By Month
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_PRS}>
              By PRS (QBR View)
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_QUARTERLY}>
              By Quarter
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_CLOSED_LOST}>
              Closed Lost
            </NavLink>
            <NavLink to={ROUTES.RENEWALS_AUDIT}>
              Process Audit
            </NavLink>
          </nav>
        )}

        {hintText && <p className="hint">{hintText}</p>}
      </header>

      {/* Route-based content */}
      <main>
        <Routes>
          {/* Customer Routes */}
          <Route path="/customer/support" element={<SupportCustomersView />} />
          <Route path="/customer/usage" element={<CustomerUsageView />} />
          <Route path="/customer/renewals" element={<CustomerRenewalView />} />

          {/* CSM Routes */}
          <Route path="/csm/support" element={<CSMPortfolioView />} />
          <Route path="/csm/usage" element={<CSMUsageView />} />
          <Route path="/csm/renewals" element={<CSMRenewalView />} />
          <Route path="/csm/projects" element={<ComingSoonPlaceholder title="CSM Active Projects" description="View active product implementations and service projects grouped by CSM. Data will be sourced from Salesforce." />} />

          {/* PM Routes */}
          <Route path="/pm/support" element={<PMPortfolioView />} />
          <Route path="/pm/usage" element={<ComingSoonPlaceholder title="PM Usage Analytics" description="View product usage metrics grouped by Project Manager portfolio." />} />
          <Route path="/pm/projects" element={<ComingSoonPlaceholder title="PM Active Projects" description="View active product implementations and service projects grouped by PM. Data will be sourced from Salesforce." />} />

          {/* Product Routes */}
          <Route path="/product/support" element={<ProductView />} />
          <Route path="/product/usage" element={<ComingSoonPlaceholder title="Product Usage Analytics" description="View product usage metrics aggregated by product." />} />
          <Route path="/product/renewals" element={<ComingSoonPlaceholder title="Product Renewals" description="View renewal opportunities grouped by product." />} />

          {/* Renewals Routes */}
          <Route path="/renewals/upcoming" element={<RenewalAgent />} />
          <Route path="/renewals/monthly" element={<MonthlyRenewalView />} />
          <Route path="/renewals/prs" element={<PRSRenewalView />} />
          <Route path="/renewals/quarterly" element={<QuarterlyRenewalView />} />
          <Route path="/renewals/closed-lost" element={<ClosedLostView />} />
          <Route path="/renewals/audit" element={<ProcessAuditView />} />

          {/* Default redirects */}
          <Route path="/" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/customer" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/csm" element={<Navigate to={ROUTES.CSM_SUPPORT} replace />} />
          <Route path="/pm" element={<Navigate to={ROUTES.PM_SUPPORT} replace />} />
          <Route path="/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />
          <Route path="/renewals" element={<Navigate to={ROUTES.RENEWALS_UPCOMING} replace />} />

          {/* Legacy URL redirects for bookmarks */}
          <Route path="/support/customers" element={<Navigate to={ROUTES.CUSTOMER_SUPPORT} replace />} />
          <Route path="/support/csm" element={<Navigate to={ROUTES.CSM_SUPPORT} replace />} />
          <Route path="/support/pm" element={<Navigate to={ROUTES.PM_SUPPORT} replace />} />
          <Route path="/support/product" element={<Navigate to={ROUTES.PRODUCT_SUPPORT} replace />} />
          <Route path="/usage/customers" element={<Navigate to={ROUTES.CUSTOMER_USAGE} replace />} />
          <Route path="/usage/csm" element={<Navigate to={ROUTES.CSM_USAGE} replace />} />
          <Route path="/renewals/csm" element={<Navigate to={ROUTES.CSM_RENEWALS} replace />} />

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
