import { EnterpriseSubscription } from "../services/api";

// Map raw product types to user-friendly names
const productDisplayNames: Record<string, string> = {
  "axe-devtools-html": "axe DevTools HTML",
  "axe-devtools-pro": "axe DevTools Pro",
  "axe-devtools-linter": "axe DevTools Linter",
  "axe-devtools-mobile": "axe DevTools Mobile",
  "axe-devtools-watcher": "axe DevTools Watcher",
  "axe-devtools-reporter": "axe DevTools Reporter",
  "axe-devtools-cli": "axe DevTools CLI",
  "axe-monitor": "axe Monitor",
  "axe-monitor-pro": "axe Monitor Pro",
  "axe-auditor": "axe Auditor",
  "jira-cloud": "JIRA Cloud",
  "jira-server": "JIRA Server",
  "jira-data-center": "JIRA Data Center",
  "github": "GitHub Integration",
  "azure-devops": "Azure DevOps",
  "gitlab": "GitLab",
  "deque-university": "Deque University",
  "dequeu": "Deque University",
  "axe-reports": "axe Reports",
  "axe-assistant": "axe Assistant",
};

function getProductDisplayName(productType: string): string {
  const mapping = productDisplayNames[productType.toLowerCase()];
  if (mapping) return mapping;

  // Fallback: convert kebab-case to Title Case
  return productType
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

interface SubscriptionSummaryProps {
  subscriptions: EnterpriseSubscription[];
  loading?: boolean;
  accountName?: string;
}

export function SubscriptionSummary({ subscriptions, loading, accountName }: SubscriptionSummaryProps) {
  if (loading) {
    return <div className="subscription-summary-loading">Loading subscriptions...</div>;
  }

  if (!subscriptions || subscriptions.length === 0) {
    if (accountName) {
      return (
        <div className="subscription-summary-empty">
          No active subscriptions found for "{accountName}"
        </div>
      );
    }
    return null;
  }

  // Sort subscriptions by end date (soonest first), then by product name
  const sortedSubscriptions = [...subscriptions].sort((a, b) => {
    const dateA = new Date(a.endDate).getTime();
    const dateB = new Date(b.endDate).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return a.productType.localeCompare(b.productType);
  });

  return (
    <div className="subscription-summary">
      <h5 className="subscription-summary-title">Subscriptions</h5>
      <table className="subscription-summary-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Start Date</th>
            <th>End Date</th>
          </tr>
        </thead>
        <tbody>
          {sortedSubscriptions.map((sub) => {
            const expired = isExpired(sub.endDate);
            const expiringSoon = isExpiringSoon(sub.endDate);
            const rowClass = expired ? "expired" : expiringSoon ? "expiring-soon" : "";

            return (
              <tr key={sub.id} className={rowClass}>
                <td className="product-name">{getProductDisplayName(sub.productType)}</td>
                <td className="quantity">{sub.licenseCount.toLocaleString()}</td>
                <td className="start-date">{formatDate(sub.startDate)}</td>
                <td className={`end-date ${rowClass}`}>
                  {formatDate(sub.endDate)}
                  {expiringSoon && <span className="expiring-badge">Soon</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
