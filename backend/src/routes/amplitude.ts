import { Router, Request, Response } from "express";
import { AmplitudeService } from "../services/amplitude.js";
import { amplitudeCache } from "../services/cache.js";

// Helper: wrap an async handler with caching (30 min TTL) and HTTP cache headers
function cachedHandler(keyFn: (req: Request) => string, handler: (req: Request) => Promise<any>, ttlMinutes: number = 30) {
  return async (req: Request, res: Response) => {
    try {
      const cacheKey = keyFn(req);
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) {
        res.set("Cache-Control", "public, max-age=600");
        return res.json(cached);
      }

      const result = await handler(req);
      amplitudeCache.set(cacheKey, result, ttlMinutes);
      res.set("Cache-Control", "public, max-age=600");
      res.json(result);
    } catch (error) {
      console.error("Amplitude API error:", error);
      res.status(500).json({
        error: "Failed to fetch data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}

// Product configurations with their Amplitude project IDs
interface ProductConfig {
  name: string;
  projectId: string;
  apiKey: string;
  secretKey: string;
  orgId: string;
}

export function createAmplitudeRoutes(products: ProductConfig[]): Router {
  const router = Router();

  // Create service instances for each product
  const services = new Map<string, { service: AmplitudeService; config: ProductConfig }>();
  for (const config of products) {
    const service = new AmplitudeService({
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      projectId: config.projectId,
      orgId: config.orgId,
    });
    const slug = config.name.toLowerCase().replace(/\s+/g, "-");
    services.set(slug, { service, config });
  }

  // GET /api/amplitude/products - List available products (cached)
  router.get("/products", (_req: Request, res: Response) => {
    const cacheKey = "amp:products";
    const cached = amplitudeCache.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const productList = products.map((p) => ({
      name: p.name,
      slug: p.name.toLowerCase().replace(/\s+/g, "-"),
      projectId: p.projectId,
    }));
    const result = { products: productList };
    amplitudeCache.set(cacheKey, result, 3600); // 1 hour - product list doesn't change
    res.json(result);
  });

  // GET /api/amplitude/events/:product/list - List available events for a product
  router.get("/events/:product/list", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const events = await entry.service.getEventList();
      res.json({
        product: entry.config.name,
        events: events.data?.map((e) => e.name) || [],
      });
    } catch (error) {
      console.error("Error fetching event list:", error);
      res.status(500).json({
        error: "Failed to fetch event list",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/properties/:product - List available user properties for a product
  router.get("/properties/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const properties = await entry.service.getUserPropertyList();
      res.json({
        product: entry.config.name,
        properties: properties.data?.map((p) => p.user_property) || [],
      });
    } catch (error) {
      console.error("Error fetching user properties:", error);
      res.status(500).json({
        error: "Failed to fetch user properties",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/usage/:product - Get usage data for a product (cached 15 min)
  router.get("/usage/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const days = parseInt(req.query.days as string) || 30;
      const cacheKey = `amp:usage:${product}:${days}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const usage = await entry.service.getProductUsage(entry.config.name, days);
      amplitudeCache.set(cacheKey, usage);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching usage data:", error);
      res.status(500).json({
        error: "Failed to fetch usage data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/summary/:product - Get usage summary for a product (cached 15 min)
  router.get("/summary/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const cacheKey = `amp:summary:${product}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const summary = await entry.service.getUsageSummary(entry.config.name);
      amplitudeCache.set(cacheKey, summary);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching usage summary:", error);
      res.status(500).json({
        error: "Failed to fetch usage summary",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/summary - Get usage summary for all products (cached 15 min)
  router.get("/summary", async (_req: Request, res: Response) => {
    try {
      const cacheKey = "amp:summary:all";
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const summaries = await Promise.all(
        Array.from(services.entries()).map(async ([slug, entry]) => {
          try {
            const summary = await entry.service.getUsageSummary(entry.config.name);
            return { slug, ...summary };
          } catch (error) {
            console.error(`Error fetching summary for ${slug}:`, error);
            return {
              slug,
              product: entry.config.name,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );
      const result = { summaries };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching all summaries:", error);
      res.status(500).json({
        error: "Failed to fetch usage summaries",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/org/:organization - Get usage summary for all products for a specific organization (cached 15 min)
  router.get("/org/:organization", async (req: Request, res: Response) => {
    try {
      const { organization } = req.params;
      const cacheKey = `amp:org:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const summaries = await Promise.all(
        Array.from(services.entries()).map(async ([slug, entry]) => {
          try {
            const summary = await entry.service.getUsageSummaryByOrg(
              entry.config.name,
              organization
            );
            return { slug, ...summary };
          } catch (error) {
            console.error(`Error fetching summary for ${slug} / ${organization}:`, error);
            return {
              slug,
              product: entry.config.name,
              organization,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );
      const result = { organization, summaries };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching org summaries:", error);
      res.status(500).json({
        error: "Failed to fetch organization usage summaries",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/usage/:product/org/:organization - Get usage data for a product filtered by organization (cached 15 min)
  router.get("/usage/:product/org/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const days = parseInt(req.query.days as string) || 30;
      const cacheKey = `amp:usage:${product}:org:${organization.toLowerCase()}:${days}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const usage = await entry.service.getProductUsageByOrg(
        entry.config.name,
        organization,
        days
      );
      const result = { ...usage, organization };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching org usage data:", error);
      res.status(500).json({
        error: "Failed to fetch organization usage data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Products that store human-readable organization names in gp:organization
  // Other products store UUIDs, so we use gp:initial_referring_domain for those
  const PRODUCTS_WITH_ORG_NAMES = new Set(["axe-account-portal"]);

  // GET /api/amplitude/events/:product/groups - Query available group property values
  router.get("/events/:product/groups", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const eventType = (req.query.event as string) || "login";
      // Use gp:organization for products with human-readable names, otherwise use gp:initial_referring_domain
      const defaultGroupBy = PRODUCTS_WITH_ORG_NAMES.has(product) ? "gp:organization" : "gp:initial_referring_domain";
      const groupBy = (req.query.groupBy as string) || defaultGroupBy;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      // Query last 30 days to get a sample of group values
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const data = await entry.service.getEventSegmentation(eventType, groupBy, startDate, endDate);

      res.json({
        product: entry.config.name,
        eventType,
        groupBy,
        values: data.map(d => ({ value: d.domain, count: d.eventCount })),
      });
    } catch (error) {
      console.error("Error fetching group values:", error);
      res.status(500).json({
        error: "Failed to fetch group values",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/events/:product/quarterly - Get event usage by domain for current and previous quarter (cached 15 min)
  router.get("/events/:product/quarterly", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const eventType = (req.query.event as string) || "analysis:complete";
      const defaultGroupBy = PRODUCTS_WITH_ORG_NAMES.has(product) ? "gp:organization" : "gp:initial_referring_domain";
      const groupBy = (req.query.groupBy as string) || defaultGroupBy;
      const cacheKey = `amp:events:quarterly:${product}:${eventType}:${groupBy}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const usage = await entry.service.getEventUsageByDomainQuarterly(eventType, groupBy);

      const result = {
        product: entry.config.name,
        eventType,
        groupBy,
        currentQuarter: usage.currentQuarter,
        previousQuarter: usage.previousQuarter,
        twoQuartersAgo: usage.twoQuartersAgo,
      };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly event usage:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly event usage",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/devtools/:product/metrics - Get DevTools-specific metrics by organization (cached 15 min)
  router.get("/devtools/:product/metrics", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const days = parseInt(req.query.days as string) || 30;
      const defaultGroupBy = PRODUCTS_WITH_ORG_NAMES.has(product) ? "gp:organization" : "gp:initial_referring_domain";
      const groupBy = (req.query.groupBy as string) || defaultGroupBy;
      const cacheKey = `amp:devtools:${product}:${groupBy}:${days}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getDevToolsMetricsByDomain(groupBy, days);

      const result = { product: entry.config.name, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching DevTools metrics:", error);
      res.status(500).json({
        error: "Failed to fetch DevTools metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Page view event names by product
  const PAGE_VIEW_EVENTS: Record<string, string> = {
    "axe-assistant": "pageview",
    "axe-account-portal": "page_view",
    "axe-devtools-(browser-extension)": "analysis:complete",
  };

  // GET /api/amplitude/quarterly/:product - Get quarterly product metrics (cached 15 min)
  router.get("/quarterly/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const cacheKey = `amp:quarterly:${product}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const pageViewEvent = PAGE_VIEW_EVENTS[product] || "page_view";
      const metrics = await entry.service.getQuarterlyProductMetrics(pageViewEvent);

      const result = { product: entry.config.name, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly product metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly product metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/org/:organization - Get quarterly metrics for specific org (cached 15 min)
  router.get("/quarterly/:product/org/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:org:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const pageViewEvent = PAGE_VIEW_EVENTS[product] || "page_view";
      const metrics = await entry.service.getQuarterlyMetricsByOrg(organization, pageViewEvent);

      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly org metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly organization metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Login event names by product
  const LOGIN_EVENTS: Record<string, string> = {
    "axe-devtools-(browser-extension)": "user:login",
    "axe-assistant": "user:login",
    "axe-account-portal": "login",
  };

  // GET /api/amplitude/quarterly/:product/logins/:organization - Get quarterly unique logins for specific org (cached 15 min)
  router.get("/quarterly/:product/logins/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:logins:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const loginEvent = LOGIN_EVENTS[product] || "user:login";
      const metrics = await entry.service.getQuarterlyLoginsByOrg(organization, loginEvent);

      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly login metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly login metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/account-portal/:organization (cached 15 min)
  router.get("/quarterly/:product/account-portal/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:account-portal:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAccountPortalMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly account portal metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly account portal metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-monitor/:organization (cached 15 min)
  router.get("/quarterly/:product/axe-monitor/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:axe-monitor:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeMonitorMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly axe monitor metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe monitor metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-devtools-mobile/:organization (cached 15 min)
  router.get("/quarterly/:product/axe-devtools-mobile/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:axe-devtools-mobile:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeDevToolsMobileMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly axe devtools mobile metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe devtools mobile metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-assistant/:organization (cached 15 min)
  router.get("/quarterly/:product/axe-assistant/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:axe-assistant:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeAssistantMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly axe assistant metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe assistant metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/developer-hub/:organization (cached 15 min)
  router.get("/quarterly/:product/developer-hub/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:developer-hub:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyDeveloperHubMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly developer hub metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly developer hub metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-reports/:organization (cached 15 min)
  router.get("/quarterly/:product/axe-reports/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:axe-reports:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeReportsMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly axe reports metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe reports metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/deque-university/:organization (cached 15 min)
  router.get("/quarterly/:product/deque-university/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const cacheKey = `amp:quarterly:${product}:deque-university:${organization.toLowerCase()}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyDequeUniversityMetricsByOrg(organization);
      const result = { product: entry.config.name, organization, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly deque university metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly deque university metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/generic/:organization (cached 15 min)
  router.get("/quarterly/:product/generic/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const eventType = (req.query.event as string) || "page_view";
      const orgProperty = (req.query.orgProperty as string) || "gp:organization";
      const cacheKey = `amp:quarterly:${product}:generic:${organization.toLowerCase()}:${eventType}:${orgProperty}`;
      const cached = amplitudeCache.get<any>(cacheKey);
      if (cached) return res.json(cached);

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getGenericQuarterlyMetricsByOrg(organization, eventType, orgProperty);

      const result = { product: entry.config.name, organization, eventType, ...metrics };
      amplitudeCache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching quarterly generic metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly generic metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/debug/:product/org-properties - Test different org property names to find which ones have data
  router.get("/debug/:product/org-properties", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const testOrg = (req.query.org as string) || "Deque"; // Test with a known org
      const testEvent = (req.query.event as string); // Optional event to test

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      // Get first available event if not specified
      let eventToTest = testEvent;
      if (!eventToTest) {
        try {
          const eventList = await entry.service.getEventList();
          eventToTest = eventList.data?.[0]?.name || "page_view";
        } catch {
          eventToTest = "page_view";
        }
      }

      // List of common organization property names to test (for both user and event properties)
      const propertiesToTest = [
        "gp:organization",
        "organization",
        "org_name",
        "company",
        "company_name",
        "account_name",
        "customer",
        "client",
        "tenant",
        "account",
      ];

      const userPropertyResults: Record<string, { hasData: boolean; eventCount: number }> = {};
      const eventPropertyResults: Record<string, { hasData: boolean; eventCount: number }> = {};

      // Test user properties
      for (const prop of propertiesToTest) {
        const count = await entry.service.testPropertyForOrg(testOrg, eventToTest, prop, "user");
        userPropertyResults[prop] = { hasData: count > 0, eventCount: count };
      }

      // Test event properties
      for (const prop of propertiesToTest) {
        const count = await entry.service.testPropertyForOrg(testOrg, eventToTest, prop, "event");
        eventPropertyResults[prop] = { hasData: count > 0, eventCount: count };
      }

      res.json({
        product: entry.config.name,
        testOrganization: testOrg,
        testEvent: eventToTest,
        userPropertyResults,
        eventPropertyResults,
      });
    } catch (error) {
      console.error("Error testing org properties:", error);
      res.status(500).json({
        error: "Failed to test org properties",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================
  // Unified usage endpoint — fetches all product metrics in one call
  // ============================================================

  // Product → event definitions with user-friendly display names
  const PRODUCT_EVENTS: Record<string, { events: Array<{ event: string; label: string; metric: "uniques" | "totals" }>; orgProperty?: string }> = {
    "axe-account-portal": {
      events: [
        { event: "login", label: "User Logins", metric: "uniques" },
        { event: "integration:issue:send:success", label: "Jira Issues Sent", metric: "totals" },
      ],
    },
    "axe-devtools-(browser-extension)": {
      events: [
        { event: "analysis:analyze", label: "Scans Started", metric: "totals" },
        { event: "analysis:complete", label: "Scans Completed", metric: "totals" },
        { event: "analysis:save", label: "Scans Saved", metric: "totals" },
        { event: "analysis:startGuide", label: "Guided Tests Started", metric: "totals" },
        { event: "analysis:igtElementScope", label: "IGT Elements Scoped", metric: "totals" },
        { event: "issue:share", label: "Issues Shared", metric: "totals" },
        { event: "issue:viewSharedIssue", label: "Shared Issues Viewed", metric: "totals" },
        { event: "issues:export", label: "Issues Exported", metric: "totals" },
        { event: "ml:suggestedInteractiveElement", label: "ML Suggestions", metric: "totals" },
        { event: "record:save", label: "Recordings Saved", metric: "totals" },
        { event: "performance:scanDuration", label: "Scan Duration", metric: "totals" },
        { event: "performance:loadSavedTest", label: "Saved Test Loaded", metric: "totals" },
        { event: "performance:loadSavedTests", label: "Saved Tests Listed", metric: "totals" },
        { event: "performance:interactiveElementsAnalysis", label: "Interactive Elements Analyzed", metric: "totals" },
        { event: "performance:interactiveElementsML", label: "Interactive Elements ML", metric: "totals" },
        { event: "performance:formsML", label: "Forms ML", metric: "totals" },
        { event: "performance:formsTimeoutML", label: "Forms Timeout ML", metric: "totals" },
        { event: "performance:tableML", label: "Tables ML", metric: "totals" },
        { event: "performance:keyboardAutoTabDuration", label: "Keyboard Auto-Tab", metric: "totals" },
        { event: "performance:keyboardFocusedScreenshotting", label: "Keyboard Focused Screenshots", metric: "totals" },
        { event: "performance:keyboardUnfocusedScreenshotting", label: "Keyboard Unfocused Screenshots", metric: "totals" },
        { event: "performance:saveIGT", label: "IGT Saved", metric: "totals" },
      ],
    },
    "developer-hub": {
      events: [
        { event: "project:create", label: "Projects Created", metric: "totals" },
        { event: "share", label: "Shares", metric: "totals" },
      ],
    },
    "axe-devtools-mobile": {
      events: [
        { event: "scan:create", label: "Scans Created", metric: "totals" },
        { event: "scan:save", label: "Scans Saved", metric: "totals" },
        { event: "scan:send", label: "Scans Sent", metric: "totals" },
        { event: "dashboard_view", label: "Dashboard Views", metric: "totals" },
      ],
    },
    "axe-assistant": {
      events: [
        { event: "user:message_sent", label: "Messages Sent", metric: "totals" },
        { event: "user:response_received", label: "Responses Received", metric: "totals" },
      ],
    },
    "deque-university": {
      events: [
        { event: "session_start", label: "Sessions Started", metric: "uniques" },
        { event: "[Amplitude] File Downloaded", label: "Files Downloaded", metric: "totals" },
      ],
    },
    "axe-monitor": {
      events: [
        { event: "Scan started", label: "Scans Started", metric: "totals" },
        { event: "Schedule Spiderjob", label: "Spiderjobs Scheduled", metric: "totals" },
      ],
    },
  };

  const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
    "axe-account-portal": "Axe Accounts",
    "axe-devtools-(browser-extension)": "Axe DevTools (Browser Extension)",
    "developer-hub": "Developer Hub",
    "axe-devtools-mobile": "Axe DevTools Mobile",
    "axe-assistant": "Axe Assistant",
    "deque-university": "Deque University",
    "axe-monitor": "Axe Monitor",
  };

  // GET /api/amplitude/unified/:orgIdentifier — all product metrics in one call
  // Optional query param: ?monitorDomain=oracle (domain prefix for axe-monitor matching)
  router.get("/unified/:orgIdentifier", cachedHandler(
    (req) => `amp:unified:${req.params.orgIdentifier.toLowerCase()}:${(req.query.monitorDomain as string || "").toLowerCase()}`,
    async (req) => {
      const { orgIdentifier } = req.params;
      const monitorDomain = (req.query.monitorDomain as string) || "";

      // Fetch all products in parallel
      const productResults = await Promise.allSettled(
        Object.entries(PRODUCT_EVENTS).map(async ([slug, config]) => {
          const entry = services.get(slug);
          if (!entry) return { slug, error: "Product not configured" };

          // Monitor workaround: use initial_referring_domain with contains
          let orgValue = orgIdentifier;
          let orgProp = config.orgProperty || "gp:organization";
          let matchOp: "is" | "contains" = "is";

          if (slug === "axe-monitor" && monitorDomain) {
            orgValue = monitorDomain;
            orgProp = "gp:initial_referring_domain";
            matchOp = "contains";
          }

          // Fetch all events for this product in parallel
          const eventResults = await Promise.allSettled(
            config.events.map(async ({ event, label, metric }) => {
              const data = await entry.service.getQuarterlyEventMetric(
                orgValue,
                event,
                metric,
                orgProp,
                matchOp
              );
              return { event, label, metric, ...data };
            })
          );

          return {
            slug,
            displayName: PRODUCT_DISPLAY_NAMES[slug] || slug,
            events: eventResults.map((r, i) => {
              if (r.status === "fulfilled") return r.value;
              return {
                event: config.events[i].event,
                label: config.events[i].label,
                metric: config.events[i].metric,
                current: 0, previous: 0, twoAgo: 0,
                labels: ["", "", ""],
                error: r.reason?.message || "Failed",
              };
            }),
          };
        })
      );

      const results: Record<string, any> = {};
      for (const r of productResults) {
        if (r.status === "fulfilled" && r.value && "slug" in r.value) {
          results[r.value.slug] = r.value;
        }
      }

      return { orgIdentifier, products: results };
    }
  ));

  return router;
}
