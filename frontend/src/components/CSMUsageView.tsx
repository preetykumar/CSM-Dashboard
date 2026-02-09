import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchCSMPortfolios,
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
import type { CSMPortfolio, Organization } from "../types";

// Amplitude product slugs
const DEVTOOLS_PRO_SLUG = "axe-devtools-(browser-extension)";
const DEVELOPER_HUB_SLUG = "developer-hub";
const AXE_MONITOR_SLUG = "axe-monitor";
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
  isAdditional?: boolean;
  subProducts?: SubProductDefinition[];
  primaryEvent?: string;
  primaryEventLabel?: string;
  orgProperty?: string;
}

interface SubProductDefinition {
  id: string;
  displayName: string;
  subscriptionTypes?: string[];
  amplitudeSlug?: string;
  hasQuarterlyMetrics?: boolean;
  hasCustomMetrics?: boolean;
  primaryEvent?: string;
  primaryEventLabel?: string;
}

// Same product definitions as CustomerUsageView
const productDefinitions: ProductDefinition[] = [
  {
    id: "axe-devtools-web",
    displayName: "Axe DevTools for Web",
    subscriptionTypes: ["axe-devtools-pro", "axe-devtools-html", "axe-devtools-watcher", "axe-devtools-cli", "axe-devtools-reporter"],
    subProducts: [
      { id: "pro", displayName: "Pro (Browser Extension)", subscriptionTypes: ["axe-devtools-pro", "axe-devtools-html"], amplitudeSlug: DEVTOOLS_PRO_SLUG, hasQuarterlyMetrics: true },
      // { id: "watcher", displayName: "Watcher", subscriptionTypes: ["axe-devtools-watcher"] }, // Commented out - no Amplitude tracking
      { id: "developer-hub", displayName: "Developer Hub", amplitudeSlug: DEVELOPER_HUB_SLUG, hasCustomMetrics: true },
    ],
  },
  {
    id: "axe-monitor",
    displayName: "axe Monitor",
    subscriptionTypes: ["axe-monitor", "axe-monitor-pro"],
    amplitudeSlug: AXE_MONITOR_SLUG,
  },
  {
    id: "deque-university",
    displayName: "Deque University",
    subscriptionTypes: ["deque-university", "dequeu"],
    amplitudeSlug: DEQUE_UNIVERSITY_SLUG,
  },
  {
    id: "axe-devtools-mobile",
    displayName: "axe DevTools Mobile",
    subscriptionTypes: ["axe-devtools-mobile"],
    amplitudeSlug: AXE_DEVTOOLS_MOBILE_SLUG,
  },
  {
    id: "axe-accounts",
    displayName: "Axe Accounts",
    subscriptionTypes: [],
    isAdditional: true,
    amplitudeSlug: AXE_ACCOUNT_PORTAL_SLUG,
  },
  // {
  //   id: "axe-reports",
  //   displayName: "axe Reports",
  //   subscriptionTypes: [],
  //   isAdditional: true,
  //   amplitudeSlug: AXE_REPORTS_SLUG,
  // }, // Commented out - no Amplitude data
  {
    id: "axe-assistant",
    displayName: "Axe Assistant",
    subscriptionTypes: [],
    isAdditional: true,
    amplitudeSlug: AXE_ASSISTANT_SLUG,
    orgProperty: "org_name",
  },
];

// Consolidated account that groups multiple Zendesk orgs by SF account name
interface ConsolidatedCustomer {
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

// Consolidate customers within a portfolio by SF account name, filtered to only those with subscriptions
function consolidateCustomers(
  customers: { organization: Organization }[],
  subscriptionFilter?: Set<string>
): ConsolidatedCustomer[] {
  const accountMap = new Map<string, Organization[]>();

  for (const customer of customers) {
    const org = customer.organization;
    const accountName = org.salesforce_account_name || org.name;
    const existing = accountMap.get(accountName) || [];
    existing.push(org);
    accountMap.set(accountName, existing);
  }

  let accounts = Array.from(accountMap.entries())
    .map(([accountName, organizations]) => ({ accountName, organizations }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));

  // Filter to only accounts with subscriptions if filter is provided
  if (subscriptionFilter && subscriptionFilter.size > 0) {
    accounts = accounts.filter((account) => subscriptionFilter.has(account.accountName));
  }

  return accounts;
}

// Check if customer has a specific product license
function hasProductLicense(subscriptions: EnterpriseSubscription[], productTypes: string[]): boolean {
  if (productTypes.length === 0) return true;
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

  if (!hasLicense && !product.isAdditional) return null;
  if (product.isAdditional && subscriptions.length === 0) return null;

  const handleToggle = () => {
    onToggleProduct(productKey);
    if (!isExpanded) {
      onLoadProductData(product.id, accountName);
    }
  };

  const data = productData.get(productKey);

  const renderProductMetrics = () => {
    // Show loading spinner if data is loading OR if data hasn't been set yet (just expanded)
    if (data?.loading || (!data && isExpanded)) {
      return (
        <div className="loading-spinner-inline">
          <div className="spinner-small" />
          <span>Loading usage data...</span>
        </div>
      );
    }

    // Axe Accounts
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

    // Axe Monitor
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

    // Axe DevTools Mobile
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

    // Axe Assistant
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

    // axe Reports
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

    // Deque University
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

    // Generic quarterly metrics
    if (!product.subProducts && data?.genericMetrics) {
      return renderGenericQuarterlyTable(data.genericMetrics, product.primaryEventLabel || "Event count");
    }

    if (!product.subProducts && !data?.loading) {
      return <span className="no-data-text">No usage data available</span>;
    }

    return null;
  };

  const renderSubProducts = () => {
    if (!product.subProducts) return null;

    return (
      <div className="sub-products-list">
        {product.subProducts.map((subProduct) => {
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
                onLoadSubProductData(subKey, subProduct.amplitudeSlug, accountName, "", subProduct.id);
              } else if (subProduct.primaryEvent) {
                onLoadSubProductData(subKey, subProduct.amplitudeSlug, accountName, subProduct.primaryEvent);
              }
            }
          };

          const renderSubContent = () => {
            // Show loading spinner if sub-product just expanded but data hasn't been set yet
            if (!subData && isSubExpanded && subProduct.amplitudeSlug) {
              return (
                <div className="loading-spinner-inline">
                  <div className="spinner-small" />
                  <span>Loading...</span>
                </div>
              );
            }

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

            if (subData?.loading) {
              return (
                <div className="loading-spinner-inline">
                  <div className="spinner-small" />
                  <span>Loading...</span>
                </div>
              );
            }

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

            if (subData?.genericMetrics) {
              return renderGenericQuarterlyTable(subData.genericMetrics, subProduct.primaryEventLabel || "Event count");
            }

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

export function CSMUsageView() {
  const [portfolios, setPortfolios] = useState<CSMPortfolio[]>([]);
  const [products, setProducts] = useState<AmplitudeProduct[]>([]);
  const [accountsWithSubscriptions, setAccountsWithSubscriptions] = useState<Set<string>>(new Set());
  const [customerUsage, setCustomerUsage] = useState<Map<string, CustomerUsageData>>(new Map());
  const [productData, setProductData] = useState<Map<string, ProductData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expandedCSM, setExpandedCSM] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedSubProducts, setExpandedSubProducts] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [portfolioData, prods, accountsWithSubs] = await Promise.all([
          fetchCSMPortfolios(),
          fetchAmplitudeProducts(),
          fetchAccountsWithSubscriptions(),
        ]);
        setPortfolios(portfolioData.portfolios);
        setIsAdmin(portfolioData.isAdmin);
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

  // Load account data (subscriptions)
  const loadAccountUsage = useCallback(async (key: string, accountName: string) => {
    if (customerUsage.has(key) && !customerUsage.get(key)?.error) {
      return;
    }

    setCustomerUsage((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, {
        accountName,
        subscriptions: [],
        loading: true,
        loadingSubscriptions: true,
      });
      return newMap;
    });

    try {
      const subscriptionResult = await fetchEnterpriseSubscriptionsByName(accountName);
      const subscriptions = subscriptionResult.subscriptions;

      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(key, {
          accountName,
          subscriptions,
          loading: false,
          loadingSubscriptions: false,
        });
        return newMap;
      });
    } catch (err) {
      setCustomerUsage((prev) => {
        const newMap = new Map(prev);
        newMap.set(key, {
          accountName,
          subscriptions: [],
          loading: false,
          loadingSubscriptions: false,
          error: err instanceof Error ? err.message : "Failed to load subscriptions",
        });
        return newMap;
      });
    }
  }, [customerUsage]);

  // Load product-specific data
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

      const productDef = productDefinitions.find(p => p.id === productId);

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

  // Load sub-product data
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

      if (customSubProductId === "developer-hub") {
        developerHubMetrics = await fetchDeveloperHubMetricsByOrg(amplitudeSlug, accountName);
      } else if (event) {
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

  const sortedPortfolios = useMemo(() => {
    return [...portfolios].sort((a, b) => a.csm.name.localeCompare(b.csm.name));
  }, [portfolios]);

  const paginatedPortfolios = usePagination(sortedPortfolios, pageSize, currentPage);

  // Get list of products with usage analytics - must be before early returns
  const analyticsProductNames = useMemo(() => {
    return productDefinitions
      .filter(p => p.amplitudeSlug)
      .map(p => p.displayName);
  }, []);

  const toggleCSM = (csmEmail: string) => {
    setExpandedCSM(expandedCSM === csmEmail ? null : csmEmail);
  };

  const toggleCustomer = useCallback((key: string, accountName: string) => {
    if (expandedCustomer === key) {
      setExpandedCustomer(null);
    } else {
      setExpandedCustomer(key);
      loadAccountUsage(key, accountName);
    }
  }, [expandedCustomer, loadAccountUsage]);

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
          <span className="spinner-text">Loading CSM portfolios...</span>
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

  if (portfolios.length === 0) {
    return (
      <div className="usage-view">
        <div className="usage-empty">
          <p>No CSM portfolios found.</p>
        </div>
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
    <div className="usage-view csm-usage-view">
      {isAdmin && (
        <div className="admin-banner">
          <span className="admin-badge">Admin View</span>
          <span className="admin-info">Viewing all {portfolios.length} CSM portfolios</span>
        </div>
      )}
      <Pagination
        totalItems={portfolios.length}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />

      <div className="csm-list">
        {paginatedPortfolios.map((portfolio) => {
          const isCSMExpanded = expandedCSM === portfolio.csm.email;
          const consolidatedCustomers = consolidateCustomers(portfolio.customers, accountsWithSubscriptions);

          return (
            <div key={portfolio.csm.email} className={`csm-card ${isCSMExpanded ? "expanded" : ""}`}>
              <div
                className="csm-header"
                onClick={() => toggleCSM(portfolio.csm.email)}
                role="button"
                tabIndex={0}
                aria-expanded={isCSMExpanded}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCSM(portfolio.csm.email);
                  }
                }}
              >
                <div className="csm-info">
                  <h3>{portfolio.csm.name}</h3>
                  <span className="csm-email">{portfolio.csm.email}</span>
                </div>
                <div className="csm-stats">
                  <div className="csm-stat">
                    <span className="value">{consolidatedCustomers.length}</span>
                    <span className="label">Customers</span>
                  </div>
                  <div className="csm-stat">
                    <span className="value">{analyticsProductNames.length}</span>
                    <span className="label">Products Tracked</span>
                  </div>
                </div>
                <div className="csm-analytics-products">
                  <span className="analytics-label">Usage analytics for:</span>
                  <span className="analytics-list">{analyticsProductNames.join(', ')}</span>
                </div>
                <span className="expand-icon">{isCSMExpanded ? "▼" : "▶"}</span>
              </div>

              {isCSMExpanded && (
                <div className="csm-customers">
                  {consolidatedCustomers.length === 0 ? (
                    <p className="no-customers">No customers with active subscriptions in this portfolio</p>
                  ) : (
                    consolidatedCustomers.map((customer) => {
                        const customerKey = `${portfolio.csm.email}:${customer.accountName}`;
                        const isCustomerExpanded = expandedCustomer === customerKey;
                        const usageData = customerUsage.get(customerKey);
                        const subscriptions = usageData?.subscriptions || [];

                        return (
                          <div key={customerKey} className={`customer-card ${isCustomerExpanded ? "expanded" : ""}`}>
                            <div
                              className="customer-header"
                              onClick={() => toggleCustomer(customerKey, customer.accountName)}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isCustomerExpanded}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleCustomer(customerKey, customer.accountName);
                                }
                              }}
                            >
                              <span className="expand-icon">{isCustomerExpanded ? "▼" : "▶"}</span>
                              <span className="customer-name">{customer.accountName}</span>
                              {customer.organizations.length > 1 && (
                                <span className="org-count">({customer.organizations.length} orgs)</span>
                              )}
                            </div>

                            {isCustomerExpanded && (
                              <div className="customer-content">
                                {usageData?.loading ? (
                                  <div className="loading">Loading subscription data...</div>
                                ) : usageData?.error ? (
                                  <div className="error">{usageData.error}</div>
                                ) : (
                                  <>
                                    <LicenseBanner
                                      subscriptions={subscriptions}
                                      loading={false}
                                      accountName={customer.accountName}
                                      compact
                                    />
                                    {subscriptions.length > 0 && (
                                      <div className="products-list">
                                        {productDefinitions.map((product) => (
                                          <ProductSection
                                            key={product.id}
                                            product={product}
                                            subscriptions={subscriptions}
                                            accountName={customer.accountName}
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
