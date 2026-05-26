// Shared portfolio rendering: single list (non-admin) or admin-grouped sections.
// Used by both PortfolioView (standalone /portfolio page) and HomeView (merged /home).
//
// Owns just the card rendering — no greeting, no wireframe banner, no role
// switcher controls. Parents pass in the resolved role + portfolio data.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  groupPortfolioByOwner,
  countAccounts,
  type Role,
  type MockPortfolioAccount,
  type OwnerDimension,
} from "../../data/portfolioMocks";
import { CustomerCard } from "./CustomerCard";

interface Props {
  // Which role we're rendering for. Non-admin → single filtered list.
  // Admin previewing as "admin" → multi-section overview.
  // Admin previewing as a specific role → single grouped section.
  role: Role;
  isAdmin: boolean;
  portfolio: MockPortfolioAccount[];
  userEmail: string;
}

export function PortfolioContent({ role, isAdmin, portfolio, userEmail }: Props) {
  if (!isAdmin) {
    return <SingleListView portfolio={portfolio} userEmail={userEmail} />;
  }
  return <AdminPreviewView role={role} portfolio={portfolio} />;
}

function SingleListView({ portfolio, userEmail }: { portfolio: MockPortfolioAccount[]; userEmail: string }) {
  if (portfolio.length === 0) {
    return <p className="portfolio-empty">No accounts assigned to {userEmail} in Salesforce.</p>;
  }
  return (
    <div className="portfolio-cards">
      {portfolio.map((acc) => <CustomerCard key={acc.id} account={acc} />)}
    </div>
  );
}

function AdminPreviewView({ role, portfolio }: { role: Role; portfolio: MockPortfolioAccount[] }) {
  if (role === "admin") {
    return (
      <>
        <GroupedSection title="By CSM" portfolio={portfolio} dim="csm" />
        <GroupedSection title="By Technical Solution Architect" portfolio={portfolio} dim="tsa" />
      </>
    );
  }
  const dim: OwnerDimension = role as OwnerDimension;
  const title =
    role === "csm" ? "All CSM portfolios" :
    role === "prs" ? "All Renewal Specialist portfolios" :
    role === "tsa" ? "All TSA portfolios" :
    "All Implementation Engineer portfolios";
  return <GroupedSection title={title} portfolio={portfolio} dim={dim} />;
}

function GroupedSection({
  title,
  portfolio,
  dim,
}: {
  title: string;
  portfolio: MockPortfolioAccount[];
  dim: OwnerDimension;
}) {
  const groups = useMemo(() => groupPortfolioByOwner(portfolio, dim), [portfolio, dim]);
  return (
    <section className="portfolio-admin-section">
      <h2 className="portfolio-admin-section-title">
        {title}
        <span className="portfolio-admin-section-count">
          {groups.length} {groups.length === 1 ? "owner" : "owners"}
        </span>
      </h2>
      {groups.length === 0 ? (
        <p className="portfolio-empty">No accounts have a {dim.toUpperCase()} assignment.</p>
      ) : (
        <div className="portfolio-admin-groups">
          {groups.map((g) => (
            <AdminGroup key={`${dim}:${g.ownerEmail}`} group={g} />
          ))}
        </div>
      )}
    </section>
  );
}

function AdminGroup({ group }: { group: { ownerEmail: string | null; ownerName: string; accounts: MockPortfolioAccount[] } }) {
  const [open, setOpen] = useState(true);
  const total = countAccounts(group.accounts);
  return (
    <div className="portfolio-admin-group">
      <button
        type="button"
        className="portfolio-admin-group-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="portfolio-admin-group-name">{group.ownerName}</span>
        {group.ownerEmail && <span className="portfolio-admin-group-email">{group.ownerEmail}</span>}
        <span className="portfolio-admin-group-count">{total} accounts</span>
      </button>
      {open && (
        <div className="portfolio-cards portfolio-admin-group-body">
          {group.accounts.map((acc) => <CustomerCard key={acc.id} account={acc} />)}
        </div>
      )}
    </div>
  );
}
