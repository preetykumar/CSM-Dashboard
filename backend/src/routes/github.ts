/**
 * GitHub API Routes
 *
 * Provides endpoints for fetching GitHub development status
 * linked to Zendesk tickets.
 */

import { Router, Request, Response } from "express";
import { DatabaseService, CachedGitHubLink } from "../services/database.js";
import type { GitHubDevelopmentStatus } from "../types/index.js";

export function createGitHubRoutes(db: DatabaseService): Router {
  const router = Router();

  /**
   * Transform cached database link to API response format
   */
  function toGitHubDevelopmentStatus(link: CachedGitHubLink): GitHubDevelopmentStatus {
    return {
      projectTitle: link.github_project_title || undefined,
      projectStatus: link.project_status || undefined,
      sprint: link.sprint || undefined,
      milestone: link.milestone || undefined,
      releaseVersion: link.release_version || undefined,
      githubUrl: link.github_url || "",
      repoName: link.github_repo,
      issueNumber: link.github_issue_number,
      updatedAt: link.github_updated_at || undefined,
    };
  }

  /**
   * GET /api/github/ticket/:ticketId/status
   * Get GitHub development status for a single Zendesk ticket
   */
  router.get("/ticket/:ticketId/status", async (req: Request, res: Response) => {
    try {
      const ticketId = parseInt(req.params.ticketId, 10);

      if (isNaN(ticketId)) {
        return res.status(400).json({ error: "Invalid ticket ID" });
      }

      const links = db.getGitHubLinksByTicketId(ticketId);
      const githubStatuses = links.map(toGitHubDevelopmentStatus);

      res.json({
        ticketId,
        githubStatuses,
      });
    } catch (error) {
      console.error("Error fetching GitHub status:", error);
      res.status(500).json({ error: "Failed to fetch GitHub status" });
    }
  });

  /**
   * POST /api/github/tickets/status
   * Batch fetch GitHub development status for multiple tickets
   * Body: { ticketIds: number[] }
   */
  router.post("/tickets/status", async (req: Request, res: Response) => {
    try {
      const { ticketIds } = req.body;

      if (!Array.isArray(ticketIds)) {
        return res.status(400).json({ error: "ticketIds must be an array" });
      }

      // Validate and parse ticket IDs
      const validTicketIds = ticketIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !isNaN(id) && id > 0);

      if (validTicketIds.length === 0) {
        return res.json({ links: {} });
      }

      const linksMap = db.getGitHubLinksByTicketIds(validTicketIds);

      // Transform to response format
      const response: Record<number, GitHubDevelopmentStatus[]> = {};
      for (const [ticketId, links] of linksMap.entries()) {
        response[ticketId] = links.map(toGitHubDevelopmentStatus);
      }

      res.json({ links: response });
    } catch (error) {
      console.error("Error fetching GitHub statuses:", error);
      res.status(500).json({ error: "Failed to fetch GitHub statuses" });
    }
  });

  /**
   * GET /api/github/projects
   * List all GitHub projects (for configuration/debugging)
   */
  router.get("/projects", async (req: Request, res: Response) => {
    res.json({
      message: "GitHub projects listing requires direct GitHub service access. Use the sync endpoint to fetch project data.",
    });
  });

  return router;
}
