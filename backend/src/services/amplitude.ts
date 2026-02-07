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
   * Make authenticated request to Amplitude API
   */
  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Amplitude API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
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
  }> {
    const cacheKey = `event:${this.projectId}:${eventType}:${groupBy}:quarterly`;
    const cached = amplitudeCache.get<{
      currentQuarter: QuarterlyUsage;
      previousQuarter: QuarterlyUsage;
    }>(cacheKey);

    if (cached) {
      console.log(`[Amplitude] Cache hit for quarterly event data: ${eventType}`);
      return cached;
    }

    console.log(`[Amplitude] Fetching quarterly event data: ${eventType} grouped by ${groupBy}`);

    const currentQ = this.getQuarterDateRange(0);
    const previousQ = this.getQuarterDateRange(-1);

    try {
      const [currentData, previousData] = await Promise.all([
        this.getEventSegmentation(eventType, groupBy, currentQ.start, currentQ.end),
        this.getEventSegmentation(eventType, groupBy, previousQ.start, previousQ.end),
      ]);

      const result = {
        currentQuarter: {
          quarter: currentQ.label,
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
      };

      // Cache for 30 minutes (quarterly data changes less frequently)
      amplitudeCache.set(cacheKey, result, 30);
      return result;
    } catch (error) {
      console.error(`Error fetching quarterly event usage for ${eventType}:`, error);
      throw error;
    }
  }
}
