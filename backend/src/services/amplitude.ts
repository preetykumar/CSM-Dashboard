/**
 * Amplitude API Service
 * Fetches product usage data from Amplitude Dashboard REST API
 * Includes in-memory caching to reduce API calls
 */

interface AmplitudeConfig {
  apiKey: string;
  secretKey: string;
  projectId: string;
  orgId: string;
}

// Simple in-memory cache with TTL
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL: number;

  constructor(defaultTTLMinutes: number = 15) {
    this.defaultTTL = defaultTTLMinutes * 60 * 1000;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMinutes?: number): void {
    const ttl = ttlMinutes ? ttlMinutes * 60 * 1000 : this.defaultTTL;
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache for Amplitude data (15 minute TTL)
const amplitudeCache = new SimpleCache(15);

interface UsageData {
  date: string;
  activeUsers: number;
  newUsers: number;
}

interface EventData {
  eventType: string;
  count: number;
}

// Event segmentation response from Amplitude
interface EventSegmentationResponse {
  data: {
    series: number[][];
    seriesLabels: string[]; // Array of labels (e.g., domain names)
    seriesCollapsed: Array<Array<{ setId: string; value: string | number }>>;
    xValues: string[];
  };
}

// Processed domain usage data
export interface DomainUsageData {
  domain: string;
  uniqueUsers: number;
  eventCount: number;
}

// Quarterly usage summary
export interface QuarterlyUsage {
  quarter: string; // e.g., "Q1 2026"
  startDate: string;
  endDate: string;
  domains: DomainUsageData[];
  totalUniqueUsers: number;
  totalEventCount: number;
}

interface UsageResponse {
  product: string;
  projectId: string;
  period: string;
  startDate: string;
  endDate: string;
  dailyUsage: UsageData[];
  totalActiveUsers: number;
  totalNewUsers: number;
  topEvents: EventData[];
}

export class AmplitudeService {
  private apiKey: string;
  private secretKey: string;
  private projectId: string;
  private orgId: string;
  private baseUrl = "https://amplitude.com/api/2";

  constructor(config: AmplitudeConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.projectId = config.projectId;
    this.orgId = config.orgId;
  }

  /**
   * Get authorization header for Amplitude API
   * Uses HTTP Basic Auth with base64 encoded {api-key}:{secret-key}
   */
  private getAuthHeader(): string {
    const credentials = `${this.apiKey}:${this.secretKey}`;
    const encoded = Buffer.from(credentials).toString("base64");
    return `Basic ${encoded}`;
  }

  /**
   * Format date as YYYYMMDD for Amplitude API
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make authenticated request to Amplitude API with retry logic for rate limiting
   * @param endpoint API endpoint
   * @param params Query parameters
   * @param maxRetries Maximum number of retries (default 3)
   * @param baseDelayMs Base delay for exponential backoff (default 1000ms)
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {},
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: this.getAuthHeader(),
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          return response.json() as Promise<T>;
        }

        // Handle rate limiting (429)
        if (response.status === 429) {
          const errorText = await response.text();
          console.warn(
            `[Amplitude] Rate limited (attempt ${attempt + 1}/${maxRetries + 1}): ${endpoint}`
          );

          if (attempt < maxRetries) {
            // Exponential backoff: 1s, 2s, 4s, etc.
            const delayMs = baseDelayMs * Math.pow(2, attempt);
            console.log(`[Amplitude] Retrying in ${delayMs}ms...`);
            await this.sleep(delayMs);
            continue;
          }

          lastError = new Error(`Amplitude API rate limited after ${maxRetries + 1} attempts: ${errorText}`);
        } else {
          // Other errors - don't retry
          const errorText = await response.text();
          throw new Error(`Amplitude API error: ${response.status} - ${errorText}`);
        }
      } catch (error) {
        // Network errors - retry with backoff
        if (attempt < maxRetries && error instanceof TypeError) {
          console.warn(
            `[Amplitude] Network error (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`
          );
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          await this.sleep(delayMs);
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("Unexpected error in Amplitude request");
  }

  /**
   * Get active users data for a date range
   * @param startDate Start date
   * @param endDate End date
   * @param interval 1=daily, 7=weekly, 30=monthly
   */
  async getActiveUsers(
    startDate: Date,
    endDate: Date,
    interval: 1 | 7 | 30 = 1
  ): Promise<{ series: number[][]; xValues: string[] }> {
    const params = {
      m: "active",
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      i: String(interval),
    };

    return this.request("/users", params);
  }

  /**
   * Get new users data for a date range
   */
  async getNewUsers(
    startDate: Date,
    endDate: Date,
    interval: 1 | 7 | 30 = 1
  ): Promise<{ series: number[][]; xValues: string[] }> {
    const params = {
      m: "new",
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      i: String(interval),
    };

    return this.request("/users", params);
  }

  /**
   * Get list of events in the project
   */
  async getEventList(): Promise<{ data: Array<{ name: string }> }> {
    return this.request("/events/list");
  }

  /**
   * Get list of user properties in the project
   */
  async getUserPropertyList(): Promise<{ data: Array<{ user_property: string }> }> {
    return this.request("/userproperty/list");
  }

  /**
   * Get comprehensive usage data for a product
   * @param productName Display name for the product
   * @param days Number of days to look back (default 30)
   */
  async getProductUsage(productName: string, days: number = 30): Promise<UsageResponse> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // Fetch active and new users in parallel
      const [activeUsersData, newUsersData] = await Promise.all([
        this.getActiveUsers(startDate, endDate),
        this.getNewUsers(startDate, endDate),
      ]);

      // Build daily usage data
      const dailyUsage: UsageData[] = [];
      const xValues = activeUsersData.xValues || [];
      const activeSeries = activeUsersData.series?.[0] || [];
      const newSeries = newUsersData.series?.[0] || [];

      let totalActiveUsers = 0;
      let totalNewUsers = 0;

      for (let i = 0; i < xValues.length; i++) {
        const active = activeSeries[i] || 0;
        const newU = newSeries[i] || 0;
        totalActiveUsers += active;
        totalNewUsers += newU;

        dailyUsage.push({
          date: xValues[i],
          activeUsers: active,
          newUsers: newU,
        });
      }

      // Try to get top events (may fail if no events configured)
      let topEvents: EventData[] = [];
      try {
        const eventsData = await this.getEventList();
        topEvents = (eventsData.data || []).slice(0, 10).map((e) => ({
          eventType: e.name,
          count: 0, // Event list doesn't include counts
        }));
      } catch {
        // Events endpoint may not be available
        console.log("Could not fetch event list");
      }

      return {
        product: productName,
        projectId: this.projectId,
        period: `${days} days`,
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
        dailyUsage,
        totalActiveUsers,
        totalNewUsers,
        topEvents,
      };
    } catch (error) {
      console.error("Error fetching Amplitude data:", error);
      throw error;
    }
  }

  /**
   * Get usage summary (lighter weight than full product usage)
   * Uses weekly/monthly intervals to get unique users over the period
   * (not summing daily values which would double-count users)
   * Results are cached for 15 minutes
   */
  async getUsageSummary(productName: string): Promise<{
    product: string;
    last7Days: { activeUsers: number; newUsers: number };
    last30Days: { activeUsers: number; newUsers: number };
  }> {
    // Check cache first
    const cacheKey = `summary:${this.projectId}`;
    const cached = amplitudeCache.get<{
      product: string;
      last7Days: { activeUsers: number; newUsers: number };
      last30Days: { activeUsers: number; newUsers: number };
    }>(cacheKey);
    if (cached) {
      console.log(`[Amplitude] Cache hit for summary: ${productName}`);
      return cached;
    }

    console.log(`[Amplitude] Cache miss, fetching summary: ${productName}`);
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    try {
      // Use interval=7 for weekly aggregation (unique users over 7 days)
      // Use interval=30 for monthly aggregation (unique users over 30 days)
      const [active7, new7, active30, new30] = await Promise.all([
        this.getActiveUsers(sevenDaysAgo, now, 7),
        this.getNewUsers(sevenDaysAgo, now, 7),
        this.getActiveUsers(thirtyDaysAgo, now, 30),
        this.getNewUsers(thirtyDaysAgo, now, 30),
      ]);

      // With proper intervals, we should get a single value (or few values)
      // Take the first value which represents the aggregated period
      const getFirst = (arr: number[] | undefined) => arr?.[0] ?? 0;

      const result = {
        product: productName,
        last7Days: {
          activeUsers: getFirst(active7.series?.[0]),
          newUsers: getFirst(new7.series?.[0]),
        },
        last30Days: {
          activeUsers: getFirst(active30.series?.[0]),
          newUsers: getFirst(new30.series?.[0]),
        },
      };

      // Cache the result
      amplitudeCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Error fetching usage summary:", error);
      throw error;
    }
  }

  /**
   * Build segmentation filter for organization
   * Amplitude uses JSON-encoded segment filters
   */
  private buildOrgSegmentFilter(organization: string): string {
    const segment = [
      {
        prop: "gp:organization",
        op: "is",
        values: [organization],
      },
    ];
    return JSON.stringify(segment);
  }

  /**
   * Get active users filtered by organization
   */
  async getActiveUsersByOrg(
    startDate: Date,
    endDate: Date,
    organization: string,
    interval: 1 | 7 | 30 = 1
  ): Promise<{ series: number[][]; xValues: string[] }> {
    const params: Record<string, string> = {
      m: "active",
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      i: String(interval),
      s: this.buildOrgSegmentFilter(organization),
    };

    return this.request("/users", params);
  }

  /**
   * Get new users filtered by organization
   */
  async getNewUsersByOrg(
    startDate: Date,
    endDate: Date,
    organization: string,
    interval: 1 | 7 | 30 = 1
  ): Promise<{ series: number[][]; xValues: string[] }> {
    const params: Record<string, string> = {
      m: "new",
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      i: String(interval),
      s: this.buildOrgSegmentFilter(organization),
    };

    return this.request("/users", params);
  }

  /**
   * Get product usage filtered by organization
   */
  async getProductUsageByOrg(
    productName: string,
    organization: string,
    days: number = 30
  ): Promise<UsageResponse> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const [activeUsersData, newUsersData] = await Promise.all([
        this.getActiveUsersByOrg(startDate, endDate, organization),
        this.getNewUsersByOrg(startDate, endDate, organization),
      ]);

      const dailyUsage: UsageData[] = [];
      const xValues = activeUsersData.xValues || [];
      const activeSeries = activeUsersData.series?.[0] || [];
      const newSeries = newUsersData.series?.[0] || [];

      let totalActiveUsers = 0;
      let totalNewUsers = 0;

      for (let i = 0; i < xValues.length; i++) {
        const active = activeSeries[i] || 0;
        const newU = newSeries[i] || 0;
        totalActiveUsers += active;
        totalNewUsers += newU;

        dailyUsage.push({
          date: xValues[i],
          activeUsers: active,
          newUsers: newU,
        });
      }

      return {
        product: productName,
        projectId: this.projectId,
        period: `${days} days`,
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
        dailyUsage,
        totalActiveUsers,
        totalNewUsers,
        topEvents: [],
      };
    } catch (error) {
      console.error(`Error fetching Amplitude data for org ${organization}:`, error);
      throw error;
    }
  }

  /**
   * Get usage summary filtered by organization
   * Uses weekly/monthly intervals to get unique users over the period
   * Results are cached for 15 minutes
   */
  async getUsageSummaryByOrg(
    productName: string,
    organization: string
  ): Promise<{
    product: string;
    organization: string;
    last7Days: { activeUsers: number; newUsers: number };
    last30Days: { activeUsers: number; newUsers: number };
  }> {
    // Check cache first
    const cacheKey = `summary:${this.projectId}:org:${organization}`;
    const cached = amplitudeCache.get<{
      product: string;
      organization: string;
      last7Days: { activeUsers: number; newUsers: number };
      last30Days: { activeUsers: number; newUsers: number };
    }>(cacheKey);
    if (cached) {
      console.log(`[Amplitude] Cache hit for org summary: ${organization}`);
      return cached;
    }

    console.log(`[Amplitude] Cache miss, fetching org summary: ${organization}`);
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    try {
      // Use interval=7 for weekly, interval=30 for monthly to get unique users
      const [active7, new7, active30, new30] = await Promise.all([
        this.getActiveUsersByOrg(sevenDaysAgo, now, organization, 7),
        this.getNewUsersByOrg(sevenDaysAgo, now, organization, 7),
        this.getActiveUsersByOrg(thirtyDaysAgo, now, organization, 30),
        this.getNewUsersByOrg(thirtyDaysAgo, now, organization, 30),
      ]);

      const getFirst = (arr: number[] | undefined) => arr?.[0] ?? 0;

      const result = {
        product: productName,
        organization,
        last7Days: {
          activeUsers: getFirst(active7.series?.[0]),
          newUsers: getFirst(new7.series?.[0]),
        },
        last30Days: {
          activeUsers: getFirst(active30.series?.[0]),
          newUsers: getFirst(new30.series?.[0]),
        },
      };

      // Cache the result
      amplitudeCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error fetching usage summary for org ${organization}:`, error);
      throw error;
    }
  }

  /**
   * Get quarter date range
   * @param quarterOffset 0 = current quarter, -1 = previous quarter
   */
  private getQuarterDateRange(quarterOffset: number = 0): { start: Date; end: Date; label: string } {
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = currentQuarter + quarterOffset;

    let year = now.getFullYear();
    let quarter = targetQuarter;

    // Handle quarter wrapping
    while (quarter < 0) {
      quarter += 4;
      year--;
    }
    while (quarter > 3) {
      quarter -= 4;
      year++;
    }

    const startMonth = quarter * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0); // Last day of quarter

    // If current quarter, end at today
    if (quarterOffset === 0 && end > now) {
      end.setTime(now.getTime());
    }

    return {
      start,
      end,
      label: `Q${quarter + 1} ${year}`,
    };
  }

  /**
   * Query event segmentation API grouped by a property
   * @param eventType The event to query (e.g., "analysis:complete")
   * @param groupByProperty Property to group by (e.g., "gp:organization" or "up:referring_domain")
   * @param startDate Start date
   * @param endDate End date
   */
  async getEventSegmentation(
    eventType: string,
    groupByProperty: string,
    startDate: Date,
    endDate: Date
  ): Promise<DomainUsageData[]> {
    // Build the event segmentation request
    // Amplitude Event Segmentation API uses JSON-encoded parameters
    const e = JSON.stringify({
      event_type: eventType,
    });

    const params: Record<string, string> = {
      e,
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      m: "uniques", // Unique users
      g: groupByProperty, // Group by property (must include prefix: gp:, up:, or ep:)
      limit: "100", // Top 100 results
    };

    try {
      const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);

      const results: DomainUsageData[] = [];
      const seriesLabels = response.data?.seriesLabels || [];
      const series = response.data?.series || [];

      // seriesLabels contains the actual domain/org names as strings
      // series contains the counts for each group
      for (let i = 0; i < seriesLabels.length; i++) {
        const domain = seriesLabels[i] || "unknown";
        const counts = series[i] || [];
        const totalCount = counts.reduce((sum, val) => sum + (val || 0), 0);

        if (domain && domain !== "(none)" && totalCount > 0) {
          results.push({
            domain,
            uniqueUsers: totalCount, // For uniques metric, this is unique users
            eventCount: totalCount,
          });
        }
      }

      // Sort by unique users descending
      results.sort((a, b) => b.uniqueUsers - a.uniqueUsers);

      return results;
    } catch (error) {
      console.error(`Error fetching event segmentation for ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Get event usage by organization for current and previous quarter
   * @param eventType The event to query (e.g., "analysis:complete")
   * @param groupBy Property to group by (default: "gp:organization")
   */
  async getEventUsageByDomainQuarterly(
    eventType: string,
    groupBy: string = "gp:organization"
  ): Promise<{
    currentQuarter: QuarterlyUsage;
    previousQuarter: QuarterlyUsage;
    twoQuartersAgo: QuarterlyUsage;
  }> {
    const cacheKey = `event:${this.projectId}:${eventType}:${groupBy}:quarterly:v2`;
    const cached = amplitudeCache.get<{
      currentQuarter: QuarterlyUsage;
      previousQuarter: QuarterlyUsage;
      twoQuartersAgo: QuarterlyUsage;
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly event data: ${eventType}`);
      return cached;
    }

    console.log(`[Amplitude] Fetching quarterly event data: ${eventType} grouped by ${groupBy}`);

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    try {
      // Fetch sequentially to avoid rate limiting (429 errors)
      // Each event segmentation query has a cost, and parallel queries can exceed concurrent limits
      const currentData = await this.getEventSegmentation(eventType, groupBy, currentQ.start, currentQ.end);
      const previousData = await this.getEventSegmentation(eventType, groupBy, previousQ.start, previousQ.end);
      const twoQuartersAgoData = await this.getEventSegmentation(eventType, groupBy, twoQuartersAgoQ.start, twoQuartersAgoQ.end);

      const result = {
        currentQuarter: {
          quarter: `${currentQ.label} (to date)`,
          startDate: this.formatDate(currentQ.start),
          endDate: this.formatDate(currentQ.end),
          domains: currentData,
          totalUniqueUsers: currentData.reduce((sum, d) => sum + d.uniqueUsers, 0),
          totalEventCount: currentData.reduce((sum, d) => sum + d.eventCount, 0),
        },
        previousQuarter: {
          quarter: previousQ.label,
          startDate: this.formatDate(previousQ.start),
          endDate: this.formatDate(previousQ.end),
          domains: previousData,
          totalUniqueUsers: previousData.reduce((sum, d) => sum + d.uniqueUsers, 0),
          totalEventCount: previousData.reduce((sum, d) => sum + d.eventCount, 0),
        },
        twoQuartersAgo: {
          quarter: twoQuartersAgoQ.label,
          startDate: this.formatDate(twoQuartersAgoQ.start),
          endDate: this.formatDate(twoQuartersAgoQ.end),
          domains: twoQuartersAgoData,
          totalUniqueUsers: twoQuartersAgoData.reduce((sum, d) => sum + d.uniqueUsers, 0),
          totalEventCount: twoQuartersAgoData.reduce((sum, d) => sum + d.eventCount, 0),
        },
      };

      // Cache for 30 minutes (quarterly data changes less frequently)
      amplitudeCache.set(cacheKey, result, 30);
      return result;
    } catch (error) {
      console.error(`Error fetching quarterly event usage for ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Get event segmentation with custom metric (totals, uniques, avg, etc.)
   * @param eventType The event to query
   * @param groupByProperty Property to group by
   * @param startDate Start date
   * @param endDate End date
   * @param metric Metric type: "uniques", "totals", "avg", "propSum"
   */
  async getEventSegmentationWithMetric(
    eventType: string,
    groupByProperty: string,
    startDate: Date,
    endDate: Date,
    metric: "uniques" | "totals" | "avg" | "propSum" = "totals"
  ): Promise<DomainUsageData[]> {
    const e = JSON.stringify({
      event_type: eventType,
    });

    const params: Record<string, string> = {
      e,
      start: this.formatDate(startDate),
      end: this.formatDate(endDate),
      m: metric,
      g: groupByProperty,
      limit: "100",
    };

    try {
      const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);

      const results: DomainUsageData[] = [];
      const seriesLabels = response.data?.seriesLabels || [];
      const series = response.data?.series || [];

      for (let i = 0; i < seriesLabels.length; i++) {
        const domain = seriesLabels[i] || "unknown";
        const counts = series[i] || [];
        const totalCount = counts.reduce((sum, val) => sum + (val || 0), 0);

        if (domain && domain !== "(none)" && totalCount > 0) {
          results.push({
            domain,
            uniqueUsers: totalCount,
            eventCount: totalCount,
          });
        }
      }

      results.sort((a, b) => b.eventCount - a.eventCount);
      return results;
    } catch (error) {
      console.error(`Error fetching event segmentation (${metric}) for ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Get DevTools-specific metrics by domain for a time period
   * Returns visitors (unique users) and paid feature usage
   * @param groupBy Property to group by
   * @param days Number of days to look back
   */
  async getDevToolsMetricsByDomain(
    groupBy: string = "gp:initial_referring_domain",
    days: number = 30
  ): Promise<{
    period: string;
    domains: Array<{
      domain: string;
      visitors: number;
      paidFeatureEvents: number;
    }>;
  }> {
    const cacheKey = `devtools:metrics:${this.projectId}:${groupBy}:${days}`;
    const cached = amplitudeCache.get<{
      period: string;
      domains: Array<{
        domain: string;
        visitors: number;
        paidFeatureEvents: number;
      }>;
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for DevTools metrics`);
      return cached;
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // Fetch visitors (unique users for any active event) and paid feature events in sequence
      // Using "Any Active Event" for visitors and specific paid feature events
      const visitorsData = await this.getEventSegmentationWithMetric(
        "analysis:complete", // Primary engagement event for DevTools
        groupBy,
        startDate,
        endDate,
        "uniques"
      );

      // Get unique users who have used paid features
      let paidFeatureData: DomainUsageData[] = [];
      try {
        paidFeatureData = await this.getEventSegmentationWithMetric(
          "user_paid_feature",
          groupBy,
          startDate,
          endDate,
          "uniques"
        );
      } catch {
        // If user_paid_feature event doesn't exist, try alternative event names
        try {
          paidFeatureData = await this.getEventSegmentationWithMetric(
            "igt:scan:complete", // IGT scans as paid feature
            groupBy,
            startDate,
            endDate,
            "uniques"
          );
        } catch {
          console.log("[Amplitude] No paid feature events found");
        }
      }

      // Merge the data by domain
      const domainMap = new Map<string, { visitors: number; paidFeatureEvents: number }>();

      for (const v of visitorsData) {
        domainMap.set(v.domain, { visitors: v.uniqueUsers, paidFeatureEvents: 0 });
      }

      for (const p of paidFeatureData) {
        const existing = domainMap.get(p.domain);
        if (existing) {
          existing.paidFeatureEvents = p.uniqueUsers;
        } else {
          domainMap.set(p.domain, { visitors: 0, paidFeatureEvents: p.uniqueUsers });
        }
      }

      const domains = Array.from(domainMap.entries())
        .map(([domain, data]) => ({
          domain,
          visitors: data.visitors,
          paidFeatureEvents: data.paidFeatureEvents,
        }))
        .sort((a, b) => b.visitors - a.visitors);

      const result = {
        period: `Last ${days} days`,
        domains,
      };

      amplitudeCache.set(cacheKey, result, 15);
      return result;
    } catch (error) {
      console.error("Error fetching DevTools metrics:", error);
      throw error;
    }
  }

  /**
   * Get quarterly product metrics (page views, time spent) for a specific organization
   * @param organization The organization name to filter by
   * @param pageViewEvent The event name for page views (e.g., "page_view", "pageview")
   * @param timeSpentProperty The property for time spent (e.g., "session_duration", "time_on_page")
   */
  async getQuarterlyMetricsByOrg(
    organization: string,
    pageViewEvent: string = "page_view",
    timeSpentProperty: string = "session_duration"
  ): Promise<{
    currentQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
    previousQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
    twoQuartersAgo: { label: string; pageViews: number; timeSpentMinutes: number };
  }> {
    const cacheKey = `quarterly:metrics:${this.projectId}:${organization}:${pageViewEvent}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
      previousQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
      twoQuartersAgo: { label: string; pageViews: number; timeSpentMinutes: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch metrics for a quarter
    const fetchQuarterMetrics = async (
      start: Date,
      end: Date
    ): Promise<{ pageViews: number; timeSpentMinutes: number }> => {
      try {
        // Use event segmentation with organization filter
        const e = JSON.stringify({
          event_type: pageViewEvent,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "gp:organization",
              subprop_op: "is",
              subprop_value: [organization],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: "totals",
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        const pageViews = series.reduce((sum, val) => sum + (val || 0), 0);

        // For time spent, try to get session duration totals
        // This is a simplified approach - actual implementation depends on how time is tracked
        let timeSpentMinutes = 0;
        try {
          const timeParams: Record<string, string> = {
            e: JSON.stringify({
              event_type: "session_end",
              filters: [
                {
                  subprop_type: "user",
                  subprop_key: "gp:organization",
                  subprop_op: "is",
                  subprop_value: [organization],
                },
              ],
            }),
            start: this.formatDate(start),
            end: this.formatDate(end),
            m: "propSum",
            p: timeSpentProperty,
          };
          const timeResponse = await this.request<EventSegmentationResponse>("/events/segmentation", timeParams);
          const timeSeries = timeResponse.data?.series?.[0] || [];
          const totalSeconds = timeSeries.reduce((sum, val) => sum + (val || 0), 0);
          timeSpentMinutes = Math.round(totalSeconds / 60);
        } catch {
          // Time spent not available, that's okay
        }

        return { pageViews, timeSpentMinutes };
      } catch (error) {
        console.error(`Error fetching quarter metrics for ${organization}:`, error);
        return { pageViews: 0, timeSpentMinutes: 0 };
      }
    };

    // Fetch sequentially to avoid rate limiting
    const currentMetrics = await fetchQuarterMetrics(currentQ.start, currentQ.end);
    const previousMetrics = await fetchQuarterMetrics(previousQ.start, previousQ.end);
    const twoQuartersAgoMetrics = await fetchQuarterMetrics(twoQuartersAgoQ.start, twoQuartersAgoQ.end);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        ...currentMetrics,
      },
      previousQuarter: {
        label: previousQ.label,
        ...previousMetrics,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        ...twoQuartersAgoMetrics,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get aggregate quarterly metrics for a product (all organizations)
   * Returns total page views and time spent across all users
   */
  async getQuarterlyProductMetrics(
    pageViewEvent: string = "page_view"
  ): Promise<{
    currentQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
    previousQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
    twoQuartersAgo: { label: string; pageViews: number; timeSpentMinutes: number };
  }> {
    const cacheKey = `quarterly:product:${this.projectId}:${pageViewEvent}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
      previousQuarter: { label: string; pageViews: number; timeSpentMinutes: number };
      twoQuartersAgo: { label: string; pageViews: number; timeSpentMinutes: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly product metrics`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    const fetchQuarterMetrics = async (
      start: Date,
      end: Date
    ): Promise<{ pageViews: number; timeSpentMinutes: number }> => {
      try {
        const e = JSON.stringify({ event_type: pageViewEvent });
        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: "totals",
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        const pageViews = series.reduce((sum, val) => sum + (val || 0), 0);

        // Time spent - try session_end with duration property
        let timeSpentMinutes = 0;
        try {
          const timeParams: Record<string, string> = {
            e: JSON.stringify({ event_type: "session_end" }),
            start: this.formatDate(start),
            end: this.formatDate(end),
            m: "propSum",
            p: "session_duration",
          };
          const timeResponse = await this.request<EventSegmentationResponse>("/events/segmentation", timeParams);
          const timeSeries = timeResponse.data?.series?.[0] || [];
          const totalSeconds = timeSeries.reduce((sum, val) => sum + (val || 0), 0);
          timeSpentMinutes = Math.round(totalSeconds / 60);
        } catch {
          // Time spent not available
        }

        return { pageViews, timeSpentMinutes };
      } catch (error) {
        console.error(`Error fetching quarterly product metrics:`, error);
        return { pageViews: 0, timeSpentMinutes: 0 };
      }
    };

    const currentMetrics = await fetchQuarterMetrics(currentQ.start, currentQ.end);
    const previousMetrics = await fetchQuarterMetrics(previousQ.start, previousQ.end);
    const twoQuartersAgoMetrics = await fetchQuarterMetrics(twoQuartersAgoQ.start, twoQuartersAgoQ.end);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        ...currentMetrics,
      },
      previousQuarter: {
        label: previousQ.label,
        ...previousMetrics,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        ...twoQuartersAgoMetrics,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly DevTools metrics for a specific organization
   * Returns unique logins, total logins, and paid feature users
   * @param organization The organization name to filter by
   * @param loginEvent The event name for logins (default: "user:login")
   */
  async getQuarterlyLoginsByOrg(
    organization: string,
    loginEvent: string = "user:login"
  ): Promise<{
    currentQuarter: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
    previousQuarter: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
    twoQuartersAgo: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
  }> {
    const cacheKey = `quarterly:logins:v6:${this.projectId}:${organization}:${loginEvent}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
      previousQuarter: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
      twoQuartersAgo: { label: string; uniqueLogins: number; totalLogins: number; paidFeatureUsers: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly logins: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "uniques" | "totals"
    ): Promise<number> => {
      try {
        // Use "contains" with multiple case variations to match all org name variations
        // e.g., "ADP" will also match "Adp", "adp", "ADP Enterprise", "adp canada.inc", etc.
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();
        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "gp:organization",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Helper to fetch a single paid feature event with optional additional filters
    const fetchPaidFeatureEvent = async (
      start: Date,
      end: Date,
      eventType: string,
      additionalFilters?: Array<{ subprop_type: string; subprop_key: string; subprop_op: string; subprop_value: unknown }>
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        // Base org filter
        const filters: Array<{ subprop_type: string; subprop_key: string; subprop_op: string; subprop_value: unknown }> = [
          {
            subprop_type: "user",
            subprop_key: "gp:organization",
            subprop_op: "contains",
            subprop_value: [organization, orgLower, orgUpper, orgTitle],
          },
        ];

        // Add any additional filters
        if (additionalFilters) {
          filters.push(...additionalFilters);
        }

        const e = JSON.stringify({
          event_type: eventType,
          filters,
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: "uniques",
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching paid feature ${eventType} for ${organization}:`, error);
        return 0;
      }
    };

    // Helper to fetch paid feature users across all paid feature events
    // These are the events that compose "user:any_paid_feature" in Amplitude
    const fetchPaidFeatureUsers = async (start: Date, end: Date): Promise<number> => {
      // Collect unique users across all paid feature events
      // We use a Set to track users (approximated by taking max since we can't get actual user IDs)
      const counts: number[] = [];

      // 1. issues:export
      counts.push(await fetchPaidFeatureEvent(start, end, "issues:export"));

      // 2. analysis:analyze where scoped = True
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:analyze", [
        { subprop_type: "event", subprop_key: "scoped", subprop_op: "is", subprop_value: [true, "true", "True"] }
      ]));

      // 3. analysis:startGuide
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:startGuide"));

      // 4. issue:share (singular)
      counts.push(await fetchPaidFeatureEvent(start, end, "issue:share"));

      // 5. analysis:autoColorContrast:start
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:autoColorContrast:start"));

      // 6. record:share
      counts.push(await fetchPaidFeatureEvent(start, end, "record:share"));

      // 7. analysis:analyze where gp:axeSettings.axeVersion ≠ latest, (none)
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:analyze", [
        { subprop_type: "event", subprop_key: "gp:axeSettings.axeVersion", subprop_op: "is not", subprop_value: ["latest", "(none)"] }
      ]));

      // 8. analysis:analyze where gp:axeSettings.ruleset ≠ (none), wcag21aa
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:analyze", [
        { subprop_type: "event", subprop_key: "gp:axeSettings.ruleset", subprop_op: "is not", subprop_value: ["(none)", "wcag21aa"] }
      ]));

      // 9. analysis:whatsleft
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:whatsleft"));

      // 10. analysis:startUFA
      counts.push(await fetchPaidFeatureEvent(start, end, "analysis:startUFA"));

      // Take the maximum unique users across all events as an approximation
      // (In reality, Amplitude would de-duplicate users across events, but we can't do that via API)
      const maxCount = Math.max(...counts, 0);
      console.log(`[Amplitude] Paid feature users for ${organization}: ${maxCount} (from ${counts.filter(c => c > 0).length} events with data)`);
      return maxCount;
    };

    // Fetch sequentially to avoid rate limiting
    // Current quarter
    const currentUnique = await fetchQuarterMetric(currentQ.start, currentQ.end, loginEvent, "uniques");
    const currentTotal = await fetchQuarterMetric(currentQ.start, currentQ.end, loginEvent, "totals");
    const currentPaidFeature = await fetchPaidFeatureUsers(currentQ.start, currentQ.end);
    // Previous quarter
    const previousUnique = await fetchQuarterMetric(previousQ.start, previousQ.end, loginEvent, "uniques");
    const previousTotal = await fetchQuarterMetric(previousQ.start, previousQ.end, loginEvent, "totals");
    const previousPaidFeature = await fetchPaidFeatureUsers(previousQ.start, previousQ.end);
    // Two quarters ago
    const twoQuartersAgoUnique = await fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, loginEvent, "uniques");
    const twoQuartersAgoTotal = await fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, loginEvent, "totals");
    const twoQuartersAgoPaidFeature = await fetchPaidFeatureUsers(twoQuartersAgoQ.start, twoQuartersAgoQ.end);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        uniqueLogins: currentUnique,
        totalLogins: currentTotal,
        paidFeatureUsers: currentPaidFeature,
      },
      previousQuarter: {
        label: previousQ.label,
        uniqueLogins: previousUnique,
        totalLogins: previousTotal,
        paidFeatureUsers: previousPaidFeature,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        uniqueLogins: twoQuartersAgoUnique,
        totalLogins: twoQuartersAgoTotal,
        paidFeatureUsers: twoQuartersAgoPaidFeature,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Account Portal metrics for a specific organization
   * Returns JIRA test/issue success counts and unique logins
   * @param organization The organization name to filter by
   */
  async getQuarterlyAccountPortalMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; jiraTestSuccess: number; uniqueLogins: number };
    previousQuarter: { label: string; jiraTestSuccess: number; uniqueLogins: number };
    twoQuartersAgo: { label: string; jiraTestSuccess: number; uniqueLogins: number };
  }> {
    const cacheKey = `quarterly:accountportal:v2:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; jiraTestSuccess: number; uniqueLogins: number };
      previousQuarter: { label: string; jiraTestSuccess: number; uniqueLogins: number };
      twoQuartersAgo: { label: string; jiraTestSuccess: number; uniqueLogins: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly account portal metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "uniques" | "totals"
    ): Promise<number> => {
      try {
        // Use "contains" with multiple case variations to match all org name variations
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();
        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "gp:organization",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch JIRA test and issue success events (totals) and unique logins for each quarter
    // Combines integration:test:send:success and integration:issue:send:success
    const [currentJiraTest, currentJiraIssue, currentLogins] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "integration:test:send:success", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "integration:issue:send:success", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "login", "uniques"),
    ]);
    const [previousJiraTest, previousJiraIssue, previousLogins] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "integration:test:send:success", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "integration:issue:send:success", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "login", "uniques"),
    ]);
    const [twoQuartersAgoJiraTest, twoQuartersAgoJiraIssue, twoQuartersAgoLogins] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "integration:test:send:success", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "integration:issue:send:success", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "login", "uniques"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        jiraTestSuccess: currentJiraTest + currentJiraIssue,
        uniqueLogins: currentLogins,
      },
      previousQuarter: {
        label: previousQ.label,
        jiraTestSuccess: previousJiraTest + previousJiraIssue,
        uniqueLogins: previousLogins,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        jiraTestSuccess: twoQuartersAgoJiraTest + twoQuartersAgoJiraIssue,
        uniqueLogins: twoQuartersAgoLogins,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Axe Monitor metrics for a specific organization
   * Uses initial_domain event property for filtering (prefix matching to SF accounts)
   * e.g., "pg-axemonitor.dequecloud.com" matches "Proctor & Gamble" (via "pg" prefix)
   * @param organization The organization name to filter by (matched against domain prefix)
   */
  async getQuarterlyAxeMonitorMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
    previousQuarter: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
    twoQuartersAgo: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
  }> {
    const cacheKey = `quarterly:axemonitor:v2:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
      previousQuarter: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
      twoQuartersAgo: { label: string; scansStarted: number; scanOverviewViews: number; issuesPageLoads: number; projectSummaryViews: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly axe monitor metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using initial_domain event property
    // Matches organization name against the domain prefix (e.g., "experian" in "experian-axemonitor.dequecloud.com")
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "uniques" | "totals" = "uniques"
    ): Promise<number> => {
      try {
        // Use "contains" with organization name and common variations
        // This matches domains like "experian-axemonitor.dequecloud.com" when org is "Experian"
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        // Also try matching without spaces and special chars for abbreviations
        // e.g., "Proctor & Gamble" → try matching "pg" as well
        const orgNoSpaces = organization.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "event",
              subprop_key: "initial_domain",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle, orgNoSpaces],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch all 4 metrics for each quarter
    // First 3 as uniques, Project Summary Dashboard as totals
    const [currentScans, currentOverview, currentIssues, currentProjectSummary] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "Scan Started", "uniques"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "Scans:listView:ScanOverview:click", "uniques"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "Issues Page Loaded", "uniques"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "Project Summary Dashboard Loaded", "totals"),
    ]);
    const [previousScans, previousOverview, previousIssues, previousProjectSummary] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "Scan Started", "uniques"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "Scans:listView:ScanOverview:click", "uniques"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "Issues Page Loaded", "uniques"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "Project Summary Dashboard Loaded", "totals"),
    ]);
    const [twoQuartersAgoScans, twoQuartersAgoOverview, twoQuartersAgoIssues, twoQuartersAgoProjectSummary] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Scan Started", "uniques"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Scans:listView:ScanOverview:click", "uniques"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Issues Page Loaded", "uniques"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Project Summary Dashboard Loaded", "totals"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        scansStarted: currentScans,
        scanOverviewViews: currentOverview,
        issuesPageLoads: currentIssues,
        projectSummaryViews: currentProjectSummary,
      },
      previousQuarter: {
        label: previousQ.label,
        scansStarted: previousScans,
        scanOverviewViews: previousOverview,
        issuesPageLoads: previousIssues,
        projectSummaryViews: previousProjectSummary,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        scansStarted: twoQuartersAgoScans,
        scanOverviewViews: twoQuartersAgoOverview,
        issuesPageLoads: twoQuartersAgoIssues,
        projectSummaryViews: twoQuartersAgoProjectSummary,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Axe DevTools Mobile metrics for a specific organization
   * Uses gp:organization user property for filtering
   * @param organization The organization name to filter by
   */
  async getQuarterlyAxeDevToolsMobileMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
    previousQuarter: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
    twoQuartersAgo: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
  }> {
    const cacheKey = `quarterly:axedevtoolsmobile:v2:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
      previousQuarter: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
      twoQuartersAgo: { label: string; scansCreated: number; dashboardViews: number; resultsShared: number; totalIssuesFound: number; usersGettingResultsLocally: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly axe devtools mobile metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using gp:organization user property
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "totals" | "uniques" = "totals"
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "gp:organization",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch all metrics for each quarter
    // - scansCreated, dashboardViews, resultsShared (share_copy + share_email), totalIssuesFound: all as totals
    // - usersGettingResultsLocally: as uniques
    const [currentScans, currentDashboard, currentShareCopy, currentShareEmail, currentIssues, currentLocalResults] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "Scan:create", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "dashboard_view", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "share_copy", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "share_email", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "scan:total_issues", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "get_results_locally", "uniques"),
    ]);
    const [previousScans, previousDashboard, previousShareCopy, previousShareEmail, previousIssues, previousLocalResults] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "Scan:create", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "dashboard_view", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "share_copy", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "share_email", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "scan:total_issues", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "get_results_locally", "uniques"),
    ]);
    const [twoQuartersAgoScans, twoQuartersAgoDashboard, twoQuartersAgoShareCopy, twoQuartersAgoShareEmail, twoQuartersAgoIssues, twoQuartersAgoLocalResults] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Scan:create", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "dashboard_view", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "share_copy", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "share_email", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "scan:total_issues", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "get_results_locally", "uniques"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        scansCreated: currentScans,
        dashboardViews: currentDashboard,
        resultsShared: currentShareCopy + currentShareEmail,
        totalIssuesFound: currentIssues,
        usersGettingResultsLocally: currentLocalResults,
      },
      previousQuarter: {
        label: previousQ.label,
        scansCreated: previousScans,
        dashboardViews: previousDashboard,
        resultsShared: previousShareCopy + previousShareEmail,
        totalIssuesFound: previousIssues,
        usersGettingResultsLocally: previousLocalResults,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        scansCreated: twoQuartersAgoScans,
        dashboardViews: twoQuartersAgoDashboard,
        resultsShared: twoQuartersAgoShareCopy + twoQuartersAgoShareEmail,
        totalIssuesFound: twoQuartersAgoIssues,
        usersGettingResultsLocally: twoQuartersAgoLocalResults,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Axe Assistant metrics for a specific organization
   * Returns message sent counts
   * Note: Uses org_name property (not gp:organization) for Axe Assistant
   * @param organization The organization name to filter by
   */
  async getQuarterlyAxeAssistantMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; messagesSent: number };
    previousQuarter: { label: string; messagesSent: number };
    twoQuartersAgo: { label: string; messagesSent: number };
  }> {
    const cacheKey = `quarterly:axeassistant:v1:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; messagesSent: number };
      previousQuarter: { label: string; messagesSent: number };
      twoQuartersAgo: { label: string; messagesSent: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly axe assistant metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using org_name property
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "uniques" | "totals"
    ): Promise<number> => {
      try {
        // Use "contains" with multiple case variations to match all org name variations
        // Axe Assistant uses org_name property instead of gp:organization
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();
        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "org_name",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch user:message_sent events (totals) for each quarter
    const [currentMessages, previousMessages, twoQuartersAgoMessages] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "user:message_sent", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "user:message_sent", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "user:message_sent", "totals"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        messagesSent: currentMessages,
      },
      previousQuarter: {
        label: previousQ.label,
        messagesSent: previousMessages,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        messagesSent: twoQuartersAgoMessages,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Axe Reports metrics for a specific organization
   * Uses orgName user property for filtering (similar to Axe Assistant)
   * @param organization The organization name to filter by
   */
  async getQuarterlyAxeReportsMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; usageChartViews: number; outcomesChartViews: number };
    previousQuarter: { label: string; usageChartViews: number; outcomesChartViews: number };
    twoQuartersAgo: { label: string; usageChartViews: number; outcomesChartViews: number };
  }> {
    const cacheKey = `quarterly:axereports:v1:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; usageChartViews: number; outcomesChartViews: number };
      previousQuarter: { label: string; usageChartViews: number; outcomesChartViews: number };
      twoQuartersAgo: { label: string; usageChartViews: number; outcomesChartViews: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly axe reports metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using orgName user property
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "orgName",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: "totals", // Both metrics measured as event totals
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch both metrics for each quarter (both as event totals)
    const [currentUsage, currentOutcomes] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "usage:chart:load"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "outcomes:chart:load"),
    ]);
    const [previousUsage, previousOutcomes] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "usage:chart:load"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "outcomes:chart:load"),
    ]);
    const [twoQuartersAgoUsage, twoQuartersAgoOutcomes] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "usage:chart:load"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "outcomes:chart:load"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        usageChartViews: currentUsage,
        outcomesChartViews: currentOutcomes,
      },
      previousQuarter: {
        label: previousQ.label,
        usageChartViews: previousUsage,
        outcomesChartViews: previousOutcomes,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        usageChartViews: twoQuartersAgoUsage,
        outcomesChartViews: twoQuartersAgoOutcomes,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Deque University metrics for a specific organization
   * Uses email user property for filtering (matches organization name as substring in email domain)
   * e.g., "Acme Corporation" matches emails like "user@acme.com"
   * @param organization The organization name to filter by (matched as substring in email)
   */
  async getQuarterlyDequeUniversityMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; pageViews: number };
    previousQuarter: { label: string; pageViews: number };
    twoQuartersAgo: { label: string; pageViews: number };
  }> {
    const cacheKey = `quarterly:dequeuniversity:v1:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; pageViews: number };
      previousQuarter: { label: string; pageViews: number };
      twoQuartersAgo: { label: string; pageViews: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly deque university metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using email user property
    // Matches organization name as substring in email (typically matching the domain)
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "email",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: "totals", // Page views measured as event totals
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch page views metric for each quarter
    const currentPageViews = await fetchQuarterMetric(currentQ.start, currentQ.end, "Page Viewed");
    const previousPageViews = await fetchQuarterMetric(previousQ.start, previousQ.end, "Page Viewed");
    const twoQuartersAgoPageViews = await fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Page Viewed");

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        pageViews: currentPageViews,
      },
      previousQuarter: {
        label: previousQ.label,
        pageViews: previousPageViews,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        pageViews: twoQuartersAgoPageViews,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get quarterly Developer Hub metrics for a specific organization
   * Uses gp:organization user property for filtering
   * @param organization The organization name to filter by
   */
  async getQuarterlyDeveloperHubMetricsByOrg(
    organization: string
  ): Promise<{
    currentQuarter: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
    previousQuarter: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
    twoQuartersAgo: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
  }> {
    const cacheKey = `quarterly:developerhub:v1:${this.projectId}:${organization}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
      previousQuarter: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
      twoQuartersAgo: { label: string; commits: number; scans: number; uniqueApiKeysRun: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly developer hub metrics: ${organization}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter using gp:organization user property
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      eventType: string,
      metric: "totals" | "uniques"
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: "gp:organization",
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch all 3 metrics for each quarter
    // commits and scans as totals, uniqueApiKeysRun as uniques
    const [currentCommits, currentScans, currentApiKeys] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "page.commit", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "Number of Scans", "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "Unique API Keys Run", "uniques"),
    ]);
    const [previousCommits, previousScans, previousApiKeys] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "page.commit", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "Number of Scans", "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "Unique API Keys Run", "uniques"),
    ]);
    const [twoQuartersAgoCommits, twoQuartersAgoScans, twoQuartersAgoApiKeys] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "page.commit", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Number of Scans", "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "Unique API Keys Run", "uniques"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        commits: currentCommits,
        scans: currentScans,
        uniqueApiKeysRun: currentApiKeys,
      },
      previousQuarter: {
        label: previousQ.label,
        commits: previousCommits,
        scans: previousScans,
        uniqueApiKeysRun: previousApiKeys,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        commits: twoQuartersAgoCommits,
        scans: twoQuartersAgoScans,
        uniqueApiKeysRun: twoQuartersAgoApiKeys,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get generic quarterly metrics for a specific organization
   * Returns event counts (totals and/or uniques) for a given event type
   * @param organization The organization name to filter by
   * @param eventType The event type to query
   * @param orgProperty The user property to filter by (default: gp:organization)
   */
  async getGenericQuarterlyMetricsByOrg(
    organization: string,
    eventType: string,
    orgProperty: string = "gp:organization"
  ): Promise<{
    currentQuarter: { label: string; eventCount: number; uniqueUsers: number };
    previousQuarter: { label: string; eventCount: number; uniqueUsers: number };
    twoQuartersAgo: { label: string; eventCount: number; uniqueUsers: number };
  }> {
    const cacheKey = `quarterly:generic:v1:${this.projectId}:${organization}:${eventType}:${orgProperty}`;
    const cached = amplitudeCache.get<{
      currentQuarter: { label: string; eventCount: number; uniqueUsers: number };
      previousQuarter: { label: string; eventCount: number; uniqueUsers: number };
      twoQuartersAgo: { label: string; eventCount: number; uniqueUsers: number };
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly generic metrics: ${organization}/${eventType}`);
      return cached;
    }

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);
    const twoQuartersAgoQ = this.getQuarterDateRange(-2);

    // Helper to fetch event metrics for a quarter
    const fetchQuarterMetric = async (
      start: Date,
      end: Date,
      metric: "uniques" | "totals"
    ): Promise<number> => {
      try {
        const orgLower = organization.toLowerCase();
        const orgUpper = organization.toUpperCase();
        const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();
        const e = JSON.stringify({
          event_type: eventType,
          filters: [
            {
              subprop_type: "user",
              subprop_key: orgProperty,
              subprop_op: "contains",
              subprop_value: [organization, orgLower, orgUpper, orgTitle],
            },
          ],
        });

        const params: Record<string, string> = {
          e,
          start: this.formatDate(start),
          end: this.formatDate(end),
          m: metric,
        };

        const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
        const series = response.data?.series?.[0] || [];
        return series.reduce((sum, val) => sum + (val || 0), 0);
      } catch (error) {
        console.error(`Error fetching quarterly ${eventType} (${metric}) for ${organization}:`, error);
        return 0;
      }
    };

    // Fetch both totals and uniques for each quarter
    const [currentTotals, currentUniques] = await Promise.all([
      fetchQuarterMetric(currentQ.start, currentQ.end, "totals"),
      fetchQuarterMetric(currentQ.start, currentQ.end, "uniques"),
    ]);
    const [previousTotals, previousUniques] = await Promise.all([
      fetchQuarterMetric(previousQ.start, previousQ.end, "totals"),
      fetchQuarterMetric(previousQ.start, previousQ.end, "uniques"),
    ]);
    const [twoQuartersAgoTotals, twoQuartersAgoUniques] = await Promise.all([
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "totals"),
      fetchQuarterMetric(twoQuartersAgoQ.start, twoQuartersAgoQ.end, "uniques"),
    ]);

    const result = {
      currentQuarter: {
        label: `${currentQ.label} (to date)`,
        eventCount: currentTotals,
        uniqueUsers: currentUniques,
      },
      previousQuarter: {
        label: previousQ.label,
        eventCount: previousTotals,
        uniqueUsers: previousUniques,
      },
      twoQuartersAgo: {
        label: twoQuartersAgoQ.label,
        eventCount: twoQuartersAgoTotals,
        uniqueUsers: twoQuartersAgoUniques,
      },
    };

    amplitudeCache.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Test if a specific property (user or event) returns data for a given organization
   * @param organization Organization name to test
   * @param eventType Event type to query
   * @param propertyKey Property name to test
   * @param propertyType Whether this is a "user" or "event" property
   * @returns Event count for the test, or 0 if no data
   */
  async testPropertyForOrg(
    organization: string,
    eventType: string,
    propertyKey: string,
    propertyType: "user" | "event" = "user"
  ): Promise<number> {
    try {
      const currentQ = this.getQuarterDateRange(0);
      const orgLower = organization.toLowerCase();
      const orgUpper = organization.toUpperCase();
      const orgTitle = organization.charAt(0).toUpperCase() + organization.slice(1).toLowerCase();

      const e = JSON.stringify({
        event_type: eventType,
        filters: [
          {
            subprop_type: propertyType,
            subprop_key: propertyKey,
            subprop_op: "contains",
            subprop_value: [organization, orgLower, orgUpper, orgTitle],
          },
        ],
      });

      const params: Record<string, string> = {
        e,
        start: this.formatDate(currentQ.start),
        end: this.formatDate(currentQ.end),
        m: "totals",
      };

      const response = await this.request<EventSegmentationResponse>("/events/segmentation", params);
      const series = response.data?.series?.[0] || [];
      return series.reduce((sum, val) => sum + (val || 0), 0);
    } catch {
      return 0;
    }
  }

  /**
   * Get list of user properties available in this Amplitude project
   * Uses the Taxonomy API to discover available properties
   * @returns Array of user property names
   */
  async getUserProperties(): Promise<string[]> {
    const cacheKey = `userprops:v1:${this.projectId}`;
    const cached = amplitudeCache.get<string[]>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for user properties: ${this.projectId}`);
      return cached;
    }

    try {
      // Amplitude Taxonomy API for user properties
      interface TaxonomyResponse {
        success: boolean;
        data: Array<{
          user_property: string;
          description?: string;
        }>;
      }

      const response = await this.request<TaxonomyResponse>("/taxonomy/user-property");
      const properties = response.data?.map(p => p.user_property) || [];

      console.log(`[Amplitude] Found ${properties.length} user properties in project ${this.projectId}`);
      amplitudeCache.set(cacheKey, properties, 60); // Cache for 1 hour
      return properties;
    } catch (error) {
      console.error(`Error fetching user properties for project ${this.projectId}:`, error);
      return [];
    }
  }

  /**
   * Get the project ID for this service instance
   */
  getProjectId(): string {
    return this.projectId;
  }
}
