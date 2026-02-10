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

  // Sync tickets only (supports delta mode via query param)
  router.post("/tickets", async (req: Request, res: Response) => {
    try {
      // Support ?delta=true for delta sync (only tickets updated since last sync)
      const deltaOnly = req.query.delta === "true";
      const count = await sync.syncTickets(deltaOnly);
      res.json({ message: `Tickets synced (${deltaOnly ? "delta" : "full"})`, count });
    } catch (error) {
      console.error("Error syncing tickets:", error);
      res.status(500).json({ error: "Failed to sync tickets" });
    }
  });

  // Delta sync - quick sync for updated tickets only
  router.post("/delta", async (_req: Request, res: Response) => {
    try {
      if (sync.isSyncInProgress()) {
        res.status(409).json({ error: "Sync already in progress" });
        return;
      }

      // Return immediately, run sync in background
      res.json({ message: "Delta sync started", status: "in_progress" });

      // Run delta sync asynchronously (tickets only, then CSM/GitHub)
      (async () => {
        try {
          await sync.syncTickets(true); // Delta mode
          await sync.syncCSMAssignments();
          await sync.syncGitHubLinks();
          console.log("Delta sync complete");
        } catch (error) {
          console.error("Delta sync failed:", error);
        }
      })();
    } catch (error) {
      console.error("Error starting delta sync:", error);
      res.status(500).json({ error: "Failed to start delta sync" });
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
