import { DatabaseService } from "./src/services/database.js";
import { ZendeskService } from "./src/services/zendesk.js";
import { SalesforceService } from "./src/services/salesforce.js";
import { GitHubService } from "./src/services/github.js";
import { SyncService } from "./src/services/sync.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

async function main() {
  console.log("Initializing services...");
  
  const db = new DatabaseService();
  
  const zendeskConfig = {
    subdomain: process.env.ZENDESK_SUBDOMAIN!,
    email: process.env.ZENDESK_EMAIL!,
    apiToken: process.env.ZENDESK_API_TOKEN!,
  };
  const zendesk = new ZendeskService(zendeskConfig);
  
  const salesforce = process.env.SF_CLIENT_ID ? new SalesforceService() : null;
  const github = process.env.GITHUB_TOKEN ? new GitHubService() : null;
  
  const sync = new SyncService(db, zendesk, salesforce, github);
  
  console.log("Triggering tickets sync...");
  try {
    const count = await sync.syncTickets();
    console.log(`✓ Synced ${count} tickets`);
  } catch (error: any) {
    console.error("Sync failed:", error.message || error);
  }
  
  process.exit(0);
}

main();
