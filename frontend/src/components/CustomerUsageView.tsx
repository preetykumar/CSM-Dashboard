import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchOrganizations,
  fetchAmplitudeProducts,
  fetchEnterpriseSubscriptionsByName,
  fetchAccountsWithSubscriptions,
  fetchQuarterlyLoginsByOrg,
  fetchAccountPortalMetricsByOrg,
  fetchAxeMonitorMetricsByOrg,
  fetchAxeDevToolsMobileMetricsByOrg,
  fetchAxeAssistantMetricsByOrg,
  fetchDeveloperHubMetricsByOrg,
  // fetchAxeReportsMetricsByOrg, // Commented out - no Amplitude data
  fetchDequeUniversityMetricsByOrg,
  fetchGenericQuarterlyMetricsByOrg,
  AmplitudeProduct,
  EnterpriseSubscription,
  QuarterlyLoginsResponse,
  AccountPortalMetricsResponse,
  AxeMonitorMetricsResponse,
  AxeDevToolsMobileMetricsResponse,
  AxeAssistantMetricsResponse,
  DeveloperHubMetricsResponse,
  AxeReportsMetricsResponse,
  DequeUniversityMetricsResponse,
  GenericMetricsResponse,
} from "../services/api";
import { Pagination, usePagination } from "./Pagination";
import { LicenseBanner } from "./LicenseBanner";
import type { Organization } from "../types";

// Amplitude product slugs
const DEVTOOLS_PRO_SLUG = "axe-devtools-(browser-extension)";
const DEVELOPER_HUB_SLUG = "developer-hub";
// const AXE_MCP_SERVER_SLUG = "axe-mcp-server"; // Commented out
const AXE_MONITOR_SLUG = "axe-monitor";
// const AXE_AUDITOR_SLUG = "axe-auditor"; // Commented out - no org tracking
const DEQUE_UNIVERSITY_SLUG = "deque-university";
// const AXE_REPORTS_SLUG = "axe-reports"; // Commented out - no Amplitude data
const AXE_DEVTOOLS_MOBILE_SLUG = "axe-devtools-mobile";
const AXE_ACCOUNT_PORTAL_SLUG = "axe-account-portal";
const AXE_ASSISTANT_SLUG = "axe-assistant";

// Product definitions with subscription types
interface ProductDefinition {
  id: string;
  displayName: string;
  subscriptionTypes: string[];
  amplitudeSlug?: string;
  isAdditional?: boolean; // Available with any paid subscription
  subProducts?: SubProductDefinition[];
  // For generic quarterly metrics
  primaryEvent?: string;
  primaryEventLabel?: string;
  orgProperty?: string; // Which property to use for org filtering (default: gp:organization)
}

interface SubProductDefinition {
  id: string;
  displayName: string;
  subscriptionTypes?: string[]; // If empty, shown for all parent subscribers
  amplitudeSlug?: string;
  hasQuarterlyMetrics?: boolean;
  hasCustomMetrics?: boolean; // Uses custom endpoint instead of generic
  primaryEvent?: string;
  primaryEventLabel?: string;
}

// Define all products with their structure
const productDefinitions: ProductDefinition[] = [
  {
    id: "axe-devtools-web",
    displayName: "Axe DevTools for Web",
    subscriptionTypes: ["axe-devtools-pro", "axe-devtools-html", "axe-devtools-watcher", "axe-devtools-cli", "axe-devtools-reporter"],
    subProducts: [
      { id: "pro", displayName: "Pro (Browser Extension)", subscriptionTypes: ["axe-devtools-pro", "axe-devtools-html"], amplitudeSlug: DEVTOOLS_PRO_SLUG, hasQuarterlyMetrics: true },
      // { id: "watcher", displayName: "Watcher", subscriptionTypes: ["axe-devtools-watcher"] }, // Commented out - no Amplitude tracking
      { id: "developer-hub", displayName: "Developer Hub", amplitudeSlug: DEVELOPER_HUB_SLUG, hasCustomMetrics: true },
      // { id: "axe-mcp-server", displayName: "axe MCP Server", amplitudeSlug: AXE_MCP_SERVER_SLUG, primaryEvent: "scan:complete", primaryEventLabel: "Scans completed" },
    ],
  },
  {
    id: "axe-monitor",
    displayName: "axe Monitor",
    subscriptionTypes: ["axe-monitor", "axe-monitor-pro"],
    amplitudeSlug: AXE_MONITOR_SLUG,
    // Uses custom metrics via initial_domain matching (not generic primaryEvent)
  },
  // Axe Auditor commented out - no organization tracking available in Amplitude
  // {
  //   id: "axe-auditor",
  //   displayName: "axe Auditor",
  //   subscriptionTypes: ["axe-auditor"],
  //   amplitudeSlug: AXE_AUDITOR_SLUG,
  //   primaryEvent: "page_view",
  //   primaryEventLabel: "Page views",
  // },
  {
    id: "deque-university",
    displayName: "Deque University",
    subscriptionTypes: ["deque-university", "dequeu"],
    amplitudeSlug: DEQUE_UNIVERSITY_SLUG,
    // Uses custom metrics via email substring matching
  },
  {
    id: "axe-devtools-mobile",
    displayName: "axe DevTools Mobile",
    subscriptionTypes: ["axe-devtools-mobile"],
    amplitudeSlug: AXE_DEVTOOLS_MOBILE_SLUG,
    // Uses custom metrics (not generic primaryEvent)
  },
  {
    id: "axe-accounts",
    displayName: "Axe Accounts",
    subscriptionTypes: [], // Available with any subscription
    isAdditional: true,
    amplitudeSlug: AXE_ACCOUNT_PORTAL_SLUG,
  },
  // {
  //   id: "axe-reports",
  //   displayName: "axe Reports",
  //   subscriptionTypes: [], // Available with any subscription
  //   isAdditional: true,
  //   amplitudeSlug: AXE_REPORTS_SLUG,
  //   // Uses custom metrics via orgName matching
  // }, // Commented out - no Amplitude data
  {
    id: "axe-assistant",
    displayName: "Axe Assistant",
    subscriptionTypes: [], // Available with any subscription
    isAdditional: true,
    amplitudeSlug: AXE_ASSISTANT_SLUG,
    orgProperty: "org_name", // Axe Assistant uses org_name instead of gp:organization
  },
];

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedAccount {
  accountName: string;
  organizations: Organization[];
}

interface CustomerUsageData {
  accountName: string;
  subscriptions: EnterpriseSubscription[];
  loading: boolean;
  loadingSubscriptions: boolean;
  error?: string;
}

// Product-specific data that's loaded on expand
interface ProductData {
  devToolsLogins?: QuarterlyLoginsResponse;
  accountPortalMetrics?: AccountPortalMetricsResponse;
  axeMonitorMetrics?: AxeMonitorMetricsResponse;
  axeDevToolsMobileMetrics?: AxeDevToolsMobileMetricsResponse;
  axeAssistantMetrics?: AxeAssistantMetricsResponse;
  developerHubMetrics?: DeveloperHubMetricsResponse;
  axeReportsMetrics?: AxeReportsMetricsResponse;
  dequeUniversityMetrics?: DequeUniversityMetricsResponse;
  genericMetrics?: GenericMetricsResponse;
  loading: boolean;
  error?: string;
}

// Group organizations by salesforce_account_name to consolidate duplicates
function consolidateOrganizations(orgs: Organization[]): ConsolidatedAccount[] {
  const accountMap = new Map<string, Organization[]>();

  for (const org of orgs) {
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(org);
    accountMap.set(accountName, existing);
  }

  return Array.from(accountMap.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

// Check if customer has a specific product license
function hasProductLicense(subscriptions: EnterpriseSubscription[], productTypes: string[]): boolean {
  if (productTypes.length === 0) return true; // Additional products available to all
  return subscriptions.some((sub) => productTypes.includes(sub.productType.toLowerCase()));
}

// Get subscription summary for a product
function getSubscriptionSummary(subscriptions: EnterpriseSubscription[], productTypes: string[]): string {
  if (productTypes.length === 0) return "Included";
  const matching = subscriptions.filter((sub) => productTypes.includes(sub.productType.toLowerCase()));
  if (matching.length === 0) return "";
  const totalLicenses = matching.reduce((sum, sub) => sum + sub.licenseCount, 0);
  const totalAssigned = matching.reduce((sum, sub) => sum + sub.assignedSeats, 0);
  return `${totalAssigned}/${totalLicenses} licenses`;
}

// Render a generic quarterly metrics table
function renderGenericQuarterlyTable(
  metrics: GenericMetricsResponse,
  primaryLabel: string = "Event count"
) {
  return (
    <table className="devtools-metrics-table">
      <thead>
        <tr>
          <th className="metric-label-col">Metric</th>
          <th className="quarter-col">{metrics.twoQuartersAgo.label}</th>
          <th className="quarter-col">{metrics.previousQuarter.label}</th>
          <th className="quarter-col current">{metrics.currentQuarter.label}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="metric-label-col">{primaryLabel}</td>
          <td className="quarter-col">{metrics.twoQuartersAgo.eventCount.toLocaleString()}</td>
          <td className="quarter-col">{metrics.previousQuarter.eventCount.toLocaleString()}</td>
          <td className="quarter-col current">{metrics.currentQuarter.eventCount.toLocaleString()}</td>
        </tr>
        <tr>
          <td className="metric-label-col">Unique users</td>
          <td className="quarter-col">{metrics.twoQuartersAgo.uniqueUsers.toLocaleString()}</td>
          <td className="quarter-col">{metrics.previousQuarter.uniqueUsers.toLocaleString()}</td>
          <td className="quarter-col current">{metrics.currentQuarter.uniqueUsers.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Collapsible Product Section Component
interface ProductSectionProps {
  product: ProductDefinition;
  subscriptions: EnterpriseSubscription[];
  accountName: string;
  productData: Map<string, ProductData>;
  onLoadProductData: (productId: string, accountName: string) => void;
  expandedProducts: Set<string>;
  onToggleProduct: (productKey: string) => void;
  expandedSubProducts: Set<string>;
  onToggleSubProduct: (subProductKey: string) => void;
  onLoadSubProductData: (subProductKey: string, amplitudeSlug: string, accountName: string, event: string, customSubProductId?: string) => void;
}

function ProductSection({
  product,
  subscriptions,
  accountName,
  productData,
  onLoadProductData,
  expandedProducts,
  onToggleProduct,
  expandedSubProducts,
  onToggleSubProduct,
  onLoadSubProductData,
}: ProductSectionProps) {
  const productKey = `${accountName}:${product.id}`;
  const isExpanded = expandedProducts.has(productKey);
  const hasLicense = hasProductLicense(subscriptions, product.subscriptionTypes);
  const licenseSummary = getSubscriptionSummary(subscriptions, product.subscriptionTypes);

  // Don't render if no license (except for additional products)
  if (!hasLicense && !product.isAdditional) return null;
  if (product.isAdditional && subscriptions.length === 0) return null;

  const handleToggle = () => {
    onToggleProduct(productKey);
    if (!isExpanded) {
      onLoadProductData(product.id, accountName);
    }
  };

  const data = productData.get(productKey);

  // Render usage metrics based on product type
  const renderProductMetrics = () => {
    if (data?.loading) {
      return (
        <div className="loading-spinner-inline">
          <div className="spinner-small" />
          <span>Loading usage data...</span>
        </div>
      );
    }

    // Special handling for Axe Accounts with quarterly metrics
    if (product.id === "axe-accounts" && data?.accountPortalMetrics) {
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{data.accountPortalMetrics.twoQuartersAgo.label}</th>
              <th className="quarter-col">{data.accountPortalMetrics.previousQuarter.label}</th>
              <th className="quarter-col current">{data.accountPortalMetrics.currentQuarter.label}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Unique logins</td>
              <td className="quarter-col">{data.accountPortalMetrics.twoQuartersAgo.uniqueLogins.toLocaleString()}</td>
              <td className="quarter-col">{data.accountPortalMetrics.previousQuarter.uniqueLogins.toLocaleString()}</td>
              <td className="quarter-col current">{data.accountPortalMetrics.currentQuarter.uniqueLogins.toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">JIRA tests or issues sent</td>
              <td className="quarter-col">{data.accountPortalMetrics.twoQuartersAgo.jiraTestSuccess.toLocaleString()}</td>
              <td className="quarter-col">{data.accountPortalMetrics.previousQuarter.jiraTestSuccess.toLocaleString()}</td>
              <td className="quarter-col current">{data.accountPortalMetrics.currentQuarter.jiraTestSuccess.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Special handling for Axe Monitor with custom metrics
    if (product.id === "axe-monitor" && data?.axeMonitorMetrics) {
      const m = data.axeMonitorMetrics;
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{m.twoQuartersAgo?.label ?? ''}</th>
              <th className="quarter-col">{m.previousQuarter?.label ?? ''}</th>
              <th className="quarter-col current">{m.currentQuarter?.label ?? ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Number of times scan started</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.scansStarted ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.scansStarted ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.scansStarted ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Scan Overview Page viewed</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.scanOverviewViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.scanOverviewViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.scanOverviewViews ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Number of times Issues Page Loaded</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.issuesPageLoads ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.issuesPageLoads ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.issuesPageLoads ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Project Summary Dashboard Views</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.projectSummaryViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.projectSummaryViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.projectSummaryViews ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Special handling for Axe DevTools Mobile with custom metrics
    if (product.id === "axe-devtools-mobile" && data?.axeDevToolsMobileMetrics) {
      const m = data.axeDevToolsMobileMetrics;
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{m.twoQuartersAgo?.label ?? ''}</th>
              <th className="quarter-col">{m.previousQuarter?.label ?? ''}</th>
              <th className="quarter-col current">{m.currentQuarter?.label ?? ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Total number of scans created</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.scansCreated ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.scansCreated ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.scansCreated ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Dashboard Views</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.dashboardViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.dashboardViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.dashboardViews ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Results shared</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.resultsShared ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.resultsShared ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.resultsShared ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Total number of Issues found</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.totalIssuesFound ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.totalIssuesFound ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.totalIssuesFound ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Number of Users getting results locally</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.usersGettingResultsLocally ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.usersGettingResultsLocally ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.usersGettingResultsLocally ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Special handling for Axe Assistant
    if (product.id === "axe-assistant" && data?.axeAssistantMetrics) {
      const m = data.axeAssistantMetrics;
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{m.twoQuartersAgo?.label ?? ''}</th>
              <th className="quarter-col">{m.previousQuarter?.label ?? ''}</th>
              <th className="quarter-col current">{m.currentQuarter?.label ?? ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Messages sent</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.messagesSent ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.messagesSent ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.messagesSent ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Special handling for axe Reports with custom metrics
    if (product.id === "axe-reports" && data?.axeReportsMetrics) {
      const m = data.axeReportsMetrics;
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{m.twoQuartersAgo?.label ?? ''}</th>
              <th className="quarter-col">{m.previousQuarter?.label ?? ''}</th>
              <th className="quarter-col current">{m.currentQuarter?.label ?? ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Usage Chart Views</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.usageChartViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.usageChartViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.usageChartViews ?? 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="metric-label-col">Outcomes Chart Views</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.outcomesChartViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.outcomesChartViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.outcomesChartViews ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Special handling for Deque University with email-based matching
    if (product.id === "deque-university" && data?.dequeUniversityMetrics) {
      const m = data.dequeUniversityMetrics;
      return (
        <table className="devtools-metrics-table">
          <thead>
            <tr>
              <th className="metric-label-col">Metric</th>
              <th className="quarter-col">{m.twoQuartersAgo?.label ?? ''}</th>
              <th className="quarter-col">{m.previousQuarter?.label ?? ''}</th>
              <th className="quarter-col current">{m.currentQuarter?.label ?? ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label-col">Page Views</td>
              <td className="quarter-col">{(m.twoQuartersAgo?.pageViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col">{(m.previousQuarter?.pageViews ?? 0).toLocaleString()}</td>
              <td className="quarter-col current">{(m.currentQuarter?.pageViews ?? 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    // Generic quarterly metrics for products without sub-products
    if (!product.subProducts && data?.genericMetrics) {
      return renderGenericQuarterlyTable(data.genericMetrics, product.primaryEventLabel || "Event count");
    }

    // No data available
    if (!product.subProducts && !data?.loading) {
      return <span className="no-data-text">No usage data available</span>;
    }

    return null;
  };

  // Render sub-products if this product has them
  const renderSubProducts = () => {
    if (!product.subProducts) return null;

    return (
      <div className="sub-products-list">
        {product.subProducts.map((subProduct) => {
          // Check if sub-product should be shown based on license
          if (subProduct.subscriptionTypes && subProduct.subscriptionTypes.length > 0) {
            if (!hasProductLicense(subscriptions, subProduct.subscriptionTypes)) {
              return null;
            }
          }

          const subKey = `${productKey}:${subProduct.id}`;
          const isSubExpanded = expandedSubProducts.has(subKey);
          const subData = productData.get(subKey);

          const handleSubToggle = () => {
            onToggleSubProduct(subKey);
            if (!isSubExpanded && subProduct.amplitudeSlug) {
              if (subProduct.hasCustomMetrics) {
                // Load custom sub-product metrics (e.g., Developer Hub)
                onLoadSubProductData(subKey, subProduct.amplitudeSlug, accountName, "", subProduct.id);
              } else if (subProduct.primaryEvent) {
                // Load generic metrics
                onLoadSubProductData(subKey, subProduct.amplitudeSlug, accountName, subProduct.primaryEvent);
              }
            }
          };

          // Render sub-product content
          const renderSubContent = () => {
            // Pro has quarterly metrics from devToolsLogins (loaded at product level)
            if (subProduct.hasQuarterlyMetrics && data?.devToolsLogins) {
              return (
                <table className="devtools-metrics-table">
                  <thead>
                    <tr>
                      <th className="metric-label-col">Metric</th>
                      <th className="quarter-col">{data.devToolsLogins.twoQuartersAgo.label}</th>
                      <th className="quarter-col">{data.devToolsLogins.previousQuarter.label}</th>
                      <th className="quarter-col current">{data.devToolsLogins.currentQuarter.label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="metric-label-col">Unique User Logins</td>
                      <td className="quarter-col">{data.devToolsLogins.twoQuartersAgo.uniqueLogins.toLocaleString()}</td>
                      <td className="quarter-col">{data.devToolsLogins.previousQuarter.uniqueLogins.toLocaleString()}</td>
                      <td className="quarter-col current">{data.devToolsLogins.currentQuarter.uniqueLogins.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="metric-label-col">Total User Logins</td>
                      <td className="quarter-col">{data.devToolsLogins.twoQuartersAgo.totalLogins.toLocaleString()}</td>
                      <td className="quarter-col">{data.devToolsLogins.previousQuarter.totalLogins.toLocaleString()}</td>
                      <td className="quarter-col current">{data.devToolsLogins.currentQuarter.totalLogins.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="metric-label-col">Users Using Paid Features</td>
                      <td className="quarter-col">{data.devToolsLogins.twoQuartersAgo.paidFeatureUsers.toLocaleString()}</td>
                      <td className="quarter-col">{data.devToolsLogins.previousQuarter.paidFeatureUsers.toLocaleString()}</td>
                      <td className="quarter-col current">{data.devToolsLogins.currentQuarter.paidFeatureUsers.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              );
            }

            // Loading state for sub-product
            if (subData?.loading) {
              return (
                <div className="loading-spinner-inline">
                  <div className="spinner-small" />
                  <span>Loading...</span>
                </div>
              );
            }

            // Developer Hub custom metrics
            if (subProduct.id === "developer-hub" && subData?.developerHubMetrics) {
              return (
                <table className="devtools-metrics-table">
                  <thead>
                    <tr>
                      <th className="metric-label-col">Metric</th>
                      <th className="quarter-col">{subData.developerHubMetrics.twoQuartersAgo.label}</th>
                      <th className="quarter-col">{subData.developerHubMetrics.previousQuarter.label}</th>
                      <th className="quarter-col current">{subData.developerHubMetrics.currentQuarter.label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="metric-label-col">Number of Commits</td>
                      <td className="quarter-col">{subData.developerHubMetrics.twoQuartersAgo.commits.toLocaleString()}</td>
                      <td className="quarter-col">{subData.developerHubMetrics.previousQuarter.commits.toLocaleString()}</td>
                      <td className="quarter-col current">{subData.developerHubMetrics.currentQuarter.commits.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="metric-label-col">Number of Scans</td>
                      <td className="quarter-col">{subData.developerHubMetrics.twoQuartersAgo.scans.toLocaleString()}</td>
                      <td className="quarter-col">{subData.developerHubMetrics.previousQuarter.scans.toLocaleString()}</td>
                      <td className="quarter-col current">{subData.developerHubMetrics.currentQuarter.scans.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="metric-label-col">Unique API Keys Run</td>
                      <td className="quarter-col">{subData.developerHubMetrics.twoQuartersAgo.uniqueApiKeysRun.toLocaleString()}</td>
                      <td className="quarter-col">{subData.developerHubMetrics.previousQuarter.uniqueApiKeysRun.toLocaleString()}</td>
                      <td className="quarter-col current">{subData.developerHubMetrics.currentQuarter.uniqueApiKeysRun.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              );
            }

            // Generic quarterly metrics for sub-products
            if (subData?.genericMetrics) {
              return renderGenericQuarterlyTable(subData.genericMetrics, subProduct.primaryEventLabel || "Event count");
            }

            // No metrics available
            if (!subProduct.amplitudeSlug) {
              return <span className="no-data-text">Usage tracking not available</span>;
            }

            return <span className="no-data-text">No usage data</span>;
          };

          return (
            <div key={subProduct.id} className={`sub-product-section ${isSubExpanded ? "expanded" : ""}`}>
              <button
                className="sub-product-header"
                onClick={handleSubToggle}
                aria-expanded={isSubExpanded}
              >
                <span className="expand-icon">{isSubExpanded ? "▼" : "▶"}</span>
                <span className="sub-product-name">{subProduct.displayName}</span>
              </button>
              {isSubExpanded && (
                <div className="sub-product-content">
                  {renderSubContent()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`product-section ${isExpanded ? "expanded" : ""} ${product.isAdditional ? "additional" : ""}`}>
      <button
        className="product-section-header"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
        <span className="product-name">{product.displayName}</span>
        {licenseSummary && (
          <span className="license-summary">{licenseSummary}</span>
        )}
      </button>
      {isExpanded && (
        <div className="product-section-content">
          {product.subProducts ? renderSubProducts() : renderProductMetrics()}
        </div>
      )}
    </div>
  );
}

export function CustomerUsageView() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [accountsWithSubscriptions, setAccountsWithSubscriptions] = useState<Set<string>>(new Set());
  const [customerUsage, setCustomerUsage] = useState<Map<string, CustomerUsageData>>(new Map());
  const [productData, setProductData] = useState<Map<string, ProductData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedSubProducts, setExpandedSubProducts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [orgs, prods, accountsWithSubs] = await Promise.all([
          fetchOrganizations(),
          fetchAmplitudeProducts(),
          fetchAccountsWithSubscriptions(),
        ]);
        setOrganizations(orgs);
        setProducts(prods);
        setAccountsWithSubscriptions(new Set(accountsWithSubs.accountNames));
      } catch (err) {
        console.error("Failed to load data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Consolidate organizations by SF account name, filtered to only those with subscriptions
  const consolidatedAccounts = useMemo(() => {
    const allAccounts = consolidateOrganizations(organizations);
    if (accountsWithSubscriptions.size === 0) return [];
    return allAccounts.filter((account) => accountsWithSubscriptions.has(account.accountName));
  }, [organizations, accountsWithSubscriptions]);

  // Filter consolidated accounts by search
  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return consolidatedAccounts;
    const query = searchQuery.toLowerCase();
    return consolidatedAccounts.filter((account) =>
      account.accountName.toLowerCase().includes(query) ||
      account.organizations.some((org) => org.name.toLowerCase().includes(query))
    );
  }, [consolidatedAccounts, searchQuery]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Apply pagination to filtered accounts
  const paginatedAccounts = usePagination(filteredAccounts, pageSize, currentPage);

  // Load account data (subscriptions)
  const loadAccountUsage = useCallback(async (account: ConsolidatedAccount) => {
    if (customerUsage.has(account.accountName) && !customerUsage.get(account.accountName)?.error) {
      return;
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(account.accountName, {
        accountName: account.accountName,
        subscriptions: [],
        loading: true,
        loadingSubscriptions: true,
      });
      return newMap;
    });

    try {
      const subscriptionResult = await fetchEnterpriseSubscriptionsByName(account.accountName);
      const subscriptions = subscriptionResult.subscriptions;

      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(account.accountName, {
          accountName: account.accountName,
          subscriptions,
          loading: false,
          loadingSubscriptions: false,
        });
        return newMap;
      });
    } catch (err) {
      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(account.accountName, {
          accountName: account.accountName,
          subscriptions: [],
          loading: false,
          loadingSubscriptions: false,
          error: err instanceof Error ? err.message : "Failed to load subscriptions",
        });
        return newMap;
      });
    }
  }, [customerUsage]);

  // Load product-specific data when a product is expanded
  const loadProductData = useCallback(async (productId: string, accountName: string) => {
    const productKey = `${accountName}:${productId}`;

    if (productData.has(productKey)) {
      return;
    }

    setProductData((prev) => {
      const newMap = new Map(prev);
      newMap.set(productKey, { loading: true });
      return newMap;
    });

    try {
      let devToolsLogins: QuarterlyLoginsResponse | undefined;
      let accountPortalMetrics: AccountPortalMetricsResponse | undefined;
      let axeMonitorMetrics: AxeMonitorMetricsResponse | undefined;
      let axeDevToolsMobileMetrics: AxeDevToolsMobileMetricsResponse | undefined;
      let axeAssistantMetrics: AxeAssistantMetricsResponse | undefined;
      let axeReportsMetrics: AxeReportsMetricsResponse | undefined;
      let dequeUniversityMetrics: DequeUniversityMetricsResponse | undefined;
      let genericMetrics: GenericMetricsResponse | undefined;

      // Find the product definition
      const productDef = productDefinitions.find(p => p.id === productId);

      // Load data based on product type
      if (productId === "axe-devtools-web") {
        devToolsLogins = await fetchQuarterlyLoginsByOrg(DEVTOOLS_PRO_SLUG, accountName);
      } else if (productId === "axe-accounts") {
        accountPortalMetrics = await fetchAccountPortalMetricsByOrg(AXE_ACCOUNT_PORTAL_SLUG, accountName);
      } else if (productId === "axe-monitor") {
        axeMonitorMetrics = await fetchAxeMonitorMetricsByOrg(AXE_MONITOR_SLUG, accountName);
      } else if (productId === "axe-devtools-mobile") {
        axeDevToolsMobileMetrics = await fetchAxeDevToolsMobileMetricsByOrg(AXE_DEVTOOLS_MOBILE_SLUG, accountName);
      } else if (productId === "axe-assistant") {
        axeAssistantMetrics = await fetchAxeAssistantMetricsByOrg(AXE_ASSISTANT_SLUG, accountName);
      // } else if (productId === "axe-reports") {
      //   axeReportsMetrics = await fetchAxeReportsMetricsByOrg(AXE_REPORTS_SLUG, accountName);
      } else if (productId === "deque-university") {
        dequeUniversityMetrics = await fetchDequeUniversityMetricsByOrg(DEQUE_UNIVERSITY_SLUG, accountName);
      } else if (productDef?.amplitudeSlug && productDef?.primaryEvent) {
        // Use generic quarterly metrics for other products
        genericMetrics = await fetchGenericQuarterlyMetricsByOrg(
          productDef.amplitudeSlug,
          accountName,
          productDef.primaryEvent,
          productDef.orgProperty
        );
      }

      setProductData((prev) => {
        const newMap = new Map(prev);
        newMap.set(productKey, {
          devToolsLogins,
          accountPortalMetrics,
          axeMonitorMetrics,
          axeDevToolsMobileMetrics,
          axeAssistantMetrics,
          axeReportsMetrics,
          dequeUniversityMetrics,
          genericMetrics,
          loading: false,
        });
        return newMap;
      });
    } catch (err) {
      setProductData((prev) => {
        const newMap = new Map(prev);
        newMap.set(productKey, {
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load data",
        });
        return newMap;
      });
    }
  }, [productData]);

  // Load sub-product data when a sub-product is expanded
  const loadSubProductData = useCallback(async (subProductKey: string, amplitudeSlug: string, accountName: string, event: string, customSubProductId?: string) => {
    if (productData.has(subProductKey)) {
      return;
    }

    setProductData((prev) => {
      const newMap = new Map(prev);
      newMap.set(subProductKey, { loading: true });
      return newMap;
    });

    try {
      let developerHubMetrics: DeveloperHubMetricsResponse | undefined;
      let genericMetrics: GenericMetricsResponse | undefined;

      // Handle custom sub-product metrics
      if (customSubProductId === "developer-hub") {
        developerHubMetrics = await fetchDeveloperHubMetricsByOrg(amplitudeSlug, accountName);
      } else if (event) {
        // Generic metrics for other sub-products
        genericMetrics = await fetchGenericQuarterlyMetricsByOrg(amplitudeSlug, accountName, event);
      }

      setProductData((prev) => {
        const newMap = new Map(prev);
        newMap.set(subProductKey, {
          developerHubMetrics,
          genericMetrics,
          loading: false,
        });
        return newMap;
      });
    } catch (err) {
      setProductData((prev) => {
        const newMap = new Map(prev);
        newMap.set(subProductKey, {
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load data",
        });
        return newMap;
      });
    }
  }, [productData]);

  const toggleAccount = useCallback((account: ConsolidatedAccount) => {
    setExpandedAccounts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(account.accountName)) {
        newSet.delete(account.accountName);
      } else {
        newSet.add(account.accountName);
        loadAccountUsage(account);
      }
      return newSet;
    });
  }, [loadAccountUsage]);

  const toggleProduct = useCallback((productKey: string) => {
    setExpandedProducts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(productKey)) {
        newSet.delete(productKey);
      } else {
        newSet.add(productKey);
      }
      return newSet;
    });
  }, []);

  const toggleSubProduct = useCallback((subProductKey: string) => {
    setExpandedSubProducts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(subProductKey)) {
        newSet.delete(subProductKey);
      } else {
        newSet.add(subProductKey);
      }
      return newSet;
    });
  }, []);

  if (loading) {
    return (
      <div className="usage-view">
        <div className="usage-loading-spinner">
          <div className="spinner" />
          <span className="spinner-text">Loading usage data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="usage-view">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="usage-view">
        <div className="usage-empty">
          <p>No products configured for usage tracking.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="usage-view">
      {/* Customer List Section */}
      <div className="customer-usage-section">
        <div className="usage-header">
          <h2>Usage by Customer</h2>
          <span className="section-count">{filteredAccounts.length} customers with active subscriptions</span>
        </div>

        <div className="usage-customer-controls">
          <div className="usage-search">
            <input
              id="customer-usage-search"
              name="customer-usage-search"
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="usage-search-input"
            />
            {searchQuery && (
              <button
                className="usage-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <Pagination
          totalItems={filteredAccounts.length}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <div className="usage-customer-list">
        {filteredAccounts.length === 0 ? (
          <p className="no-results">
            {searchQuery ? "No customers match your search." : "No customers with active subscriptions found."}
          </p>
        ) : (
          paginatedAccounts.map((account) => {
            const isExpanded = expandedAccounts.has(account.accountName);
            const usageData = customerUsage.get(account.accountName);
            const subscriptions = usageData?.subscriptions || [];

            return (
              <div key={account.accountName} className={`usage-customer-card ${isExpanded ? "expanded" : ""}`}>
                <button
                  className="usage-customer-header"
                  onClick={() => toggleAccount(account)}
                  aria-expanded={isExpanded}
                >
                  <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
                  <span className="customer-name">{account.accountName}</span>
                  {account.organizations.length > 1 && (
                    <span className="org-count">({account.organizations.length} orgs)</span>
                  )}
                  <span className="expand-hint">
                    {isExpanded ? "Click to collapse" : "Click to view usage"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="usage-customer-content">
                    {usageData?.loading ? (
                      <div className="usage-loading">Loading subscription data...</div>
                    ) : usageData?.error ? (
                      <div className="usage-error">{usageData.error}</div>
                    ) : (
                      <>
                        <LicenseBanner
                          subscriptions={subscriptions}
                          loading={false}
                          accountName={account.accountName}
                          compact
                        />
                        {subscriptions.length > 0 && (
                          <div className="products-list">
                            {productDefinitions.map((product) => (
                              <ProductSection
                                key={product.id}
                                product={product}
                                subscriptions={subscriptions}
                                accountName={account.accountName}
                                productData={productData}
                                onLoadProductData={loadProductData}
                                expandedProducts={expandedProducts}
                                onToggleProduct={toggleProduct}
                                expandedSubProducts={expandedSubProducts}
                                onToggleSubProduct={toggleSubProduct}
                                onLoadSubProductData={loadSubProductData}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
