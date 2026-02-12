import { EnterpriseSubscription } from "../services/api";

// Map raw product types to user-friendly names and their group
const productMapping: Record<string, { displayName: string; group: string }> = {
  // Axe DevTools
  "axe-devtools-html": { displayName: "HTML", group: "Axe DevTools" },
  "axe-devtools-pro": { displayName: "Pro", group: "Axe DevTools" },
  "axe-devtools-linter": { displayName: "Linter", group: "Axe DevTools" },
  "axe-devtools-mobile": { displayName: "Mobile", group: "Axe DevTools" },
  "axe-devtools-watcher": { displayName: "Watcher", group: "Axe DevTools" },
  "axe-devtools-reporter": { displayName: "Reporter", group: "Axe DevTools" },
  "axe-devtools-cli": { displayName: "CLI", group: "Axe DevTools" },

  // Axe Monitor
  "axe-monitor": { displayName: "axe Monitor", group: "Axe Monitor" },
  "axe-monitor-pro": { displayName: "Pro", group: "Axe Monitor" },

  // Axe Auditor
  "axe-auditor": { displayName: "axe Auditor", group: "Axe Auditor" },

  // JIRA Integrations
  "jira-cloud": { displayName: "Cloud", group: "JIRA Integrations" },
  "jira-server": { displayName: "Server", group: "JIRA Integrations" },
  "jira-data-center": { displayName: "Data Center", group: "JIRA Integrations" },

  // Other Integrations
  "github": { displayName: "GitHub", group: "Integrations" },
  "azure-devops": { displayName: "Azure DevOps", group: "Integrations" },
  "gitlab": { displayName: "GitLab", group: "Integrations" },

  // Deque University
  "deque-university": { displayName: "Deque University", group: "Deque University" },
  "dequeu": { displayName: "Deque University", group: "Deque University" },

  // Other products (no license tracking)
  "axe-reports": { displayName: "axe Reports", group: "Other" },
  "axe-assistant": { displayName: "axe Assistant", group: "Other" },
};

// Define group display order
const groupOrder: Record<string, number> = {
  "Axe DevTools": 1,
  "Axe Monitor": 2,
  "Axe Auditor": 3,
  "Deque University": 4,
  "JIRA Integrations": 5,
  "Integrations": 6,
  "Other": 99,
};

// Groups that don't have license/assignment tracking (show simplified view)
const simplifiedGroups = new Set(["Other"]);

// Format date for display
function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Check if subscription is expiring soon (within 90 days)
function isExpiringSoon(endDate: string): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  const now = new Date();
  const daysUntilExpiry = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry <= 90 && daysUntilExpiry > 0;
}

// Check if subscription is expired
function isExpired(endDate: string): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  return end < new Date();
}

// Get user-friendly product name
function getProductDisplayName(productType: string): string {
  const mapping = productMapping[productType.toLowerCase()];
  if (mapping) return mapping.displayName;

  // Fallback: convert kebab-case to Title Case
  return productType
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Get product group
function getProductGroup(productType: string): string {
  const mapping = productMapping[productType.toLowerCase()];
  if (mapping) return mapping.group;

  // Fallback grouping based on prefix
  const lowerType = productType.toLowerCase();
  if (lowerType.startsWith("axe-devtools")) return "Axe DevTools";
  if (lowerType.startsWith("axe-monitor")) return "Axe Monitor";
  if (lowerType.startsWith("axe-auditor")) return "Axe Auditor";
  if (lowerType.startsWith("jira")) return "JIRA Integrations";
  if (lowerType.includes("deque") && lowerType.includes("university")) return "Deque University";
  if (lowerType.includes("dequeu")) return "Deque University";

  return "Other";
}

// Group subscriptions by product category
interface GroupedSubscription {
  groupName: string;
  subscriptions: EnterpriseSubscription[];
}

function groupSubscriptions(subscriptions: EnterpriseSubscription[]): GroupedSubscription[] {
  const groups = new Map<string, EnterpriseSubscription[]>();

  for (const sub of subscriptions) {
    const groupName = getProductGroup(sub.productType);
    const existing = groups.get(groupName) || [];
    existing.push(sub);
    groups.set(groupName, existing);
  }

  // Convert to array and sort by group order
  return Array.from(groups.entries())
    .map(([groupName, subs]) => ({ groupName, subscriptions: subs }))
    .sort((a, b) => (groupOrder[a.groupName] || 99) - (groupOrder[b.groupName] || 99));
}

interface LicenseBannerProps {
  subscriptions: EnterpriseSubscription[];
  loading?: boolean;
  accountName?: string;
  compact?: boolean;
}

export function LicenseBanner({ subscriptions, loading, accountName, compact }: LicenseBannerProps) {
  if (loading) {
    return <div className="usage-loading">Loading subscription data...</div>;
  }

  if (!subscriptions || subscriptions.length === 0) {
    if (accountName) {
      return (
        <div className="usage-hint" style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
          No active paid subscriptions found for "{accountName}" in Salesforce.
        </div>
      );
    }
    return null;
  }

  const groupedSubs = groupSubscriptions(subscriptions);

  return (
    <div className={`license-banner ${compact ? 'compact' : ''}`}>
      <h5 className="license-banner-title">Active Subscriptions</h5>
      <div className="license-groups">
        {groupedSubs.map((group) => {
          const isSimplified = simplifiedGroups.has(group.groupName);

          return (
            <div key={group.groupName} className="license-group">
              <h6 className="license-group-title">{group.groupName}</h6>
              <div className="license-table-container">
                <table className="license-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      {!isSimplified && (
                        <>
                          <th>Licenses</th>
                          <th>Assigned</th>
                          <th>% Assigned</th>
                        </>
                      )}
                      <th>Environment</th>
                      <th>Start Date</th>
                      <th>End Date</th>
                      {group.groupName === "Axe Monitor" && (
                        <>
                          <th>Pages</th>
                          <th>Projects</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {group.subscriptions.map((sub) => {
                      const expired = isExpired(sub.endDate);
                      const expiringSoon = isExpiringSoon(sub.endDate);
                      const rowClass = expired
                        ? "expired"
                        : expiringSoon
                        ? "expiring-soon"
                        : !isSimplified && sub.percentageAssigned < 50
                        ? "low-usage"
                        : !isSimplified && sub.percentageAssigned >= 90
                        ? "high-usage"
                        : "";

                      return (
                        <tr key={sub.id} className={rowClass}>
                          <td className="product-name">{getProductDisplayName(sub.productType)}</td>
                          {!isSimplified && (
                            <>
                              <td className="license-count">{sub.licenseCount.toLocaleString()}</td>
                              <td className="assigned-seats">{sub.assignedSeats.toLocaleString()}</td>
                              <td className={`percentage ${sub.percentageAssigned < 50 ? "low" : sub.percentageAssigned >= 90 ? "high" : ""}`}>
                                {sub.percentageAssigned.toFixed(1)}%
                              </td>
                            </>
                          )}
                          <td className="environment">{sub.environment}</td>
                          <td className="start-date">{formatDate(sub.startDate)}</td>
                          <td className={`end-date ${expired ? "expired" : expiringSoon ? "expiring-soon" : ""}`}>
                            {formatDate(sub.endDate)}
                            {expiringSoon && <span className="expiring-badge">Expiring Soon</span>}
                          </td>
                          {group.groupName === "Axe Monitor" && (
                            <>
                              <td className="monitor-pages">{sub.monitorPageCount?.toLocaleString() || "-"}</td>
                              <td className="monitor-projects">{sub.monitorProjectCount?.toLocaleString() || "-"}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
