import { Router, Request, Response } from "express";
import { AmplitudeService } from "../services/amplitude.js";

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

  // GET /api/amplitude/products - List available products
  router.get("/products", (_req: Request, res: Response) => {
    const productList = products.map((p) => ({
      name: p.name,
      slug: p.name.toLowerCase().replace(/\s+/g, "-"),
      projectId: p.projectId,
    }));
    res.json({ products: productList });
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

  // GET /api/amplitude/usage/:product - Get usage data for a product
  router.get("/usage/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const days = parseInt(req.query.days as string) || 30;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const usage = await entry.service.getProductUsage(entry.config.name, days);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching usage data:", error);
      res.status(500).json({
        error: "Failed to fetch usage data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/summary/:product - Get usage summary for a product
  router.get("/summary/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const summary = await entry.service.getUsageSummary(entry.config.name);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching usage summary:", error);
      res.status(500).json({
        error: "Failed to fetch usage summary",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/summary - Get usage summary for all products
  router.get("/summary", async (_req: Request, res: Response) => {
    try {
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
      res.json({ summaries });
    } catch (error) {
      console.error("Error fetching all summaries:", error);
      res.status(500).json({
        error: "Failed to fetch usage summaries",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/org/:organization - Get usage summary for all products for a specific organization
  router.get("/org/:organization", async (req: Request, res: Response) => {
    try {
      const { organization } = req.params;

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
      res.json({ organization, summaries });
    } catch (error) {
      console.error("Error fetching org summaries:", error);
      res.status(500).json({
        error: "Failed to fetch organization usage summaries",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/usage/:product/org/:organization - Get usage data for a product filtered by organization
  router.get("/usage/:product/org/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const days = parseInt(req.query.days as string) || 30;

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
      res.json({ ...usage, organization });
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

  // GET /api/amplitude/events/:product/quarterly - Get event usage by domain for current and previous quarter
  router.get("/events/:product/quarterly", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const eventType = (req.query.event as string) || "analysis:complete";
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

      const usage = await entry.service.getEventUsageByDomainQuarterly(eventType, groupBy);

      res.json({
        product: entry.config.name,
        eventType,
        groupBy,
        currentQuarter: usage.currentQuarter,
        previousQuarter: usage.previousQuarter,
        twoQuartersAgo: usage.twoQuartersAgo,
      });
    } catch (error) {
      console.error("Error fetching quarterly event usage:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly event usage",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/devtools/:product/metrics - Get DevTools-specific metrics by organization
  router.get("/devtools/:product/metrics", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;
      const days = parseInt(req.query.days as string) || 30;
      const defaultGroupBy = PRODUCTS_WITH_ORG_NAMES.has(product) ? "gp:organization" : "gp:initial_referring_domain";
      const groupBy = (req.query.groupBy as string) || defaultGroupBy;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getDevToolsMetricsByDomain(groupBy, days);

      res.json({
        product: entry.config.name,
        ...metrics,
      });
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

  // GET /api/amplitude/quarterly/:product - Get quarterly product metrics (page views, time spent)
  router.get("/quarterly/:product", async (req: Request, res: Response) => {
    try {
      const { product } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const pageViewEvent = PAGE_VIEW_EVENTS[product] || "page_view";
      const metrics = await entry.service.getQuarterlyProductMetrics(pageViewEvent);

      res.json({
        product: entry.config.name,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly product metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly product metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/org/:organization - Get quarterly metrics for specific org
  router.get("/quarterly/:product/org/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const pageViewEvent = PAGE_VIEW_EVENTS[product] || "page_view";
      const metrics = await entry.service.getQuarterlyMetricsByOrg(organization, pageViewEvent);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
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

  // GET /api/amplitude/quarterly/:product/logins/:organization - Get quarterly unique logins for specific org
  router.get("/quarterly/:product/logins/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const loginEvent = LOGIN_EVENTS[product] || "user:login";
      const metrics = await entry.service.getQuarterlyLoginsByOrg(organization, loginEvent);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly login metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly login metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/account-portal/:organization - Get Account Portal quarterly metrics for specific org
  router.get("/quarterly/:product/account-portal/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAccountPortalMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly account portal metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly account portal metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-monitor/:organization - Get Axe Monitor quarterly metrics for specific org
  router.get("/quarterly/:product/axe-monitor/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeMonitorMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly axe monitor metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe monitor metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-devtools-mobile/:organization - Get Axe DevTools Mobile quarterly metrics for specific org
  router.get("/quarterly/:product/axe-devtools-mobile/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeDevToolsMobileMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly axe devtools mobile metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe devtools mobile metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-assistant/:organization - Get Axe Assistant quarterly metrics for specific org
  router.get("/quarterly/:product/axe-assistant/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeAssistantMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly axe assistant metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe assistant metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/developer-hub/:organization - Get Developer Hub quarterly metrics for specific org
  router.get("/quarterly/:product/developer-hub/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyDeveloperHubMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly developer hub metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly developer hub metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/axe-reports/:organization - Get axe Reports quarterly metrics for specific org
  router.get("/quarterly/:product/axe-reports/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyAxeReportsMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly axe reports metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly axe reports metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/deque-university/:organization - Get Deque University quarterly metrics for specific org
  router.get("/quarterly/:product/deque-university/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getQuarterlyDequeUniversityMetricsByOrg(organization);

      res.json({
        product: entry.config.name,
        organization,
        ...metrics,
      });
    } catch (error) {
      console.error("Error fetching quarterly deque university metrics:", error);
      res.status(500).json({
        error: "Failed to fetch quarterly deque university metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/amplitude/quarterly/:product/generic/:organization - Get generic quarterly metrics for specific org
  router.get("/quarterly/:product/generic/:organization", async (req: Request, res: Response) => {
    try {
      const { product, organization } = req.params;
      const eventType = (req.query.event as string) || "page_view";
      const orgProperty = (req.query.orgProperty as string) || "gp:organization";

      const entry = services.get(product);
      if (!entry) {
        return res.status(404).json({
          error: "Product not found",
          available: Array.from(services.keys()),
        });
      }

      const metrics = await entry.service.getGenericQuarterlyMetricsByOrg(organization, eventType, orgProperty);

      res.json({
        product: entry.config.name,
        organization,
        eventType,
        ...metrics,
      });
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

  return router;
}
