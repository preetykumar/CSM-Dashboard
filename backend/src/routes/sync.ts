import { Router, Request, Response } from "express";
import { SyncService } from "../services/sync.js";

export function createSyncRoutes(sync: SyncService): Router {
  const router = Router();

  // Trigger a full sync
  router.post("/", async (_req: Request, res: Response) => {
    try {
      if (sync.isSyncInProgress()) {
        res.status(409).json({ error: "Sync already in progress" });
        return;
      }

      // Start sync in background and return immediately
      res.json({ message: "Sync started", status: "in_progress" });

      // Run sync asynchronously
      sync.syncAll().catch((error) => {
        console.error("Sync failed:", error);
      });
    } catch (error) {
      console.error("Error starting sync:", error);
      res.status(500).json({ error: "Failed to start sync" });
    }
  });

  // Sync organizations only
  router.post("/organizations", async (_req: Request, res: Response) => {
    try {
      const count = await sync.syncOrganizations();
      res.json({ message: "Organizations synced", count });
    } catch (error) {
      console.error("Error syncing organizations:", error);
      res.status(500).json({ error: "Failed to sync organizations" });
    }
  });

  // Sync tickets only
  router.post("/tickets", async (_req: Request, res: Response) => {
    try {
      const count = await sync.syncTickets();
      res.json({ message: "Tickets synced", count });
    } catch (error) {
      console.error("Error syncing tickets:", error);
      res.status(500).json({ error: "Failed to sync tickets" });
    }
  });

  // Sync CSM assignments only
  router.post("/csm", async (_req: Request, res: Response) => {
    try {
      const count = await sync.syncCSMAssignments();
      res.json({ message: "CSM assignments synced", count });
    } catch (error) {
      console.error("Error syncing CSM assignments:", error);
      res.status(500).json({ error: "Failed to sync CSM assignments" });
    }
  });

  // Sync GitHub links only
  router.post("/github", async (_req: Request, res: Response) => {
    try {
      const count = await sync.syncGitHubLinks();
      res.json({ message: "GitHub links synced", count });
    } catch (error) {
      console.error("Error syncing GitHub links:", error);
      res.status(500).json({ error: "Failed to sync GitHub links" });
    }
  });

  // Get sync status
  router.get("/status", (_req: Request, res: Response) => {
    try {
      const status = sync.getSyncStatus();
      const inProgress = sync.isSyncInProgress();
      res.json({ status, inProgress });
    } catch (error) {
      console.error("Error getting sync status:", error);
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  return router;
}
