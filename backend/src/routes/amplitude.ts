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

  return router;
}
