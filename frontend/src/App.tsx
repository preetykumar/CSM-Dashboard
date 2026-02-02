import { useEffect, useState } from "react";
import { fetchOrganizations, fetchCustomerSummary } from "./services/api";
import { CustomerSummaryCard } from "./components/CustomerSummaryCard";
import { OrganizationDrilldown } from "./components/OrganizationDrilldown";
import { CSMPortfolioView } from "./components/CSMPortfolioView";
import { TicketListModal } from "./components/TicketListModal";
import { LoginPage } from "./components/LoginPage";
import { UserMenu } from "./components/UserMenu";
import { ChatWidget } from "./components/chat";
import { useAuth } from "./contexts/AuthContext";
import { ChatProvider } from "./contexts/ChatContext";
import type { CustomerSummary, Organization } from "./types";

type ViewMode = "customers" | "csm";

interface TicketFilter {
  orgId: number;
  orgName: string;
  filterType: "status" | "priority";
  filterValue: string;
}

function Dashboard() {
  const [viewMode, setViewMode] = useState<ViewMode>("customers");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [summaries, setSummaries] = useState<Map<number, CustomerSummary>>(new Map());
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<{ id: number; name: string } | null>(null);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);

  // Load organizations first (fast)
  useEffect(() => {
    async function loadOrganizations() {
      try {
        const orgs = await fetchOrganizations();
        setOrganizations(orgs);
        setLoadingProgress({ loaded: 0, total: orgs.length });

        // Then load summaries incrementally
        for (const org of orgs) {
          try {
            const summary = await fetchCustomerSummary(org.id);
            setSummaries(prev => new Map(prev).set(org.id, summary));
            setLoadingProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
          } catch (err) {
            console.error(`Failed to load summary for ${org.name}:`, err);
            setLoadingProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoadingOrgs(false);
      }
    }

    loadOrganizations();
  }, []);

  const sortedOrgs = [...organizations].sort((a, b) => {
    const summaryA = summaries.get(a.id);
    const summaryB = summaries.get(b.id);
    const totalA = summaryA?.ticketStats.total ?? 0;
    const totalB = summaryB?.ticketStats.total ?? 0;
    return totalB - totalA;
  });

  const handleOrgClick = (org: Organization) => {
    setSelectedOrg({ id: org.id, name: org.name });
  };

  const handleStatusClick = (org: Organization, status: string) => {
    setTicketFilter({ orgId: org.id, orgName: org.name, filterType: "status", filterValue: status });
  };

  const handlePriorityClick = (org: Organization, priority: string) => {
    setTicketFilter({ orgId: org.id, orgName: org.name, filterType: "priority", filterValue: priority });
  };

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div>
            <h1>Customer Success Manager Dashboard</h1>
            <p>dequehelp.zendesk.com</p>
          </div>
          <UserMenu />
        </div>

        <div className="view-toggle">
          <button
            className={viewMode === "customers" ? "active" : ""}
            onClick={() => setViewMode("customers")}
          >
            By Customer
          </button>
          <button
            className={viewMode === "csm" ? "active" : ""}
            onClick={() => setViewMode("csm")}
          >
            By CSM (QBR View)
          </button>
        </div>

        {viewMode === "customers" && (
          <p className="hint">Click on status/priority counts to filter tickets, or click the card for full details</p>
        )}
        {viewMode === "csm" && (
          <p className="hint">View tickets grouped by CSM and their customer portfolio</p>
        )}

        {viewMode === "customers" && loadingProgress.total > 0 && loadingProgress.loaded < loadingProgress.total && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
            />
            <span className="progress-text">
              Loading {loadingProgress.loaded} of {loadingProgress.total} customers...
            </span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {viewMode === "customers" ? (
        <>
          {loadingOrgs ? (
            <div className="loading">Loading organizations...</div>
          ) : (
            <div className="summaries-grid">
              {sortedOrgs.map((org) => {
                const summary = summaries.get(org.id);
                if (summary) {
                  return (
                    <CustomerSummaryCard
                      key={org.id}
                      summary={summary}
                      onClick={() => handleOrgClick(org)}
                      onStatusClick={(status) => handleStatusClick(org, status)}
                      onPriorityClick={(priority) => handlePriorityClick(org, priority)}
                    />
                  );
                }
                return (
                  <div key={org.id} className="summary-card loading-card">
                    <div className="summary-card-header">
                      <h2>{org.name}</h2>
                      <div className="total-tickets">Loading...</div>
                    </div>
                  </div>
                );
              })}
              {organizations.length === 0 && !error && (
                <p>No customer data found. Make sure your Zendesk credentials are configured.</p>
              )}
            </div>
          )}

          {selectedOrg && (
            <OrganizationDrilldown
              orgId={selectedOrg.id}
              orgName={selectedOrg.name}
              onClose={() => setSelectedOrg(null)}
            />
          )}

          {ticketFilter && (
            <TicketListModal
              orgId={ticketFilter.orgId}
              orgName={ticketFilter.orgName}
              filterType={ticketFilter.filterType}
              filterValue={ticketFilter.filterValue}
              onClose={() => setTicketFilter(null)}
            />
          )}
        </>
      ) : (
        <CSMPortfolioView />
      )}

      {/* AI Chat Assistant */}
      <ChatWidget />
    </div>
  );
}

function App() {
  const { authenticated, authEnabled, loading } = useAuth();

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // If auth is enabled and user is not authenticated, show login
  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  // Otherwise show the dashboard with chat
  return (
    <ChatProvider>
      <Dashboard />
    </ChatProvider>
  );
}

export default App;
