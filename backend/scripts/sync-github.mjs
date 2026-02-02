#!/usr/bin/env node
/**
 * Script to sync GitHub issue links directly without authentication
 * Usage: node scripts/sync-github.mjs
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from parent directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { GitHubService } from "../dist/services/github.js";
import { DatabaseService } from "../dist/services/database.js";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG || "dequelabs";
  const projectNumbersStr = process.env.GITHUB_PROJECT_NUMBERS;

  if (!token) {
    console.error("Error: GITHUB_TOKEN not configured in .env");
    process.exit(1);
  }

  const projectNumbers = projectNumbersStr
    ? projectNumbersStr.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
    : [];

  console.log(`GitHub Sync Script`);
  console.log(`==================`);
  console.log(`Organization: ${org}`);
  console.log(`Projects: ${projectNumbers.join(", ") || "none"}`);
  console.log();

  const github = new GitHubService({ token, org, projectNumbers });
  const db = new DatabaseService();

  try {
    // Test connection first
    console.log("Testing GitHub connection...");
    const connected = await github.testConnection();
    if (!connected) {
      console.error("Failed to connect to GitHub API");
      process.exit(1);
    }

    // Fetch all linked issues
    console.log("\nFetching GitHub project items...");
    const links = await github.getLinkedIssues();
    console.log(`Found ${links.length} total links to Zendesk tickets`);

    // Filter to tickets that exist in our database
    const ticketIds = db.getAllTicketIds();
    const ticketIdSet = new Set(ticketIds);
    console.log(`Database has ${ticketIds.length} tickets`);

    const validLinks = links.filter((link) => ticketIdSet.has(link.zendeskTicketId));
    console.log(`${validLinks.length} links match existing tickets`);

    // Clear old links and insert new ones
    console.log("\nUpdating database...");
    db.clearGitHubLinks();

    const cachedLinks = validLinks.map((link) => ({
      zendesk_ticket_id: link.zendeskTicketId,
      github_issue_number: link.githubIssueNumber,
      github_repo: link.repoName,
      github_project_title: link.projectTitle,
      project_status: link.projectStatus,
      sprint: link.sprint || null,
      milestone: link.milestone || null,
      release_version: link.releaseVersion || null,
      github_url: link.githubUrl,
      github_updated_at: link.updatedAt,
    }));

    db.upsertGitHubLinks(cachedLinks);
    db.updateSyncStatus("github_links", "success", validLinks.length);

    console.log(`\n✓ Successfully synced ${validLinks.length} GitHub links`);

    // Show some sample links
    if (validLinks.length > 0) {
      console.log("\nSample links:");
      validLinks.slice(0, 5).forEach((link) => {
        console.log(`  - Zendesk #${link.zendeskTicketId} → GitHub ${link.repoName}#${link.githubIssueNumber} (${link.projectStatus || "no status"})`);
      });
      if (validLinks.length > 5) {
        console.log(`  ... and ${validLinks.length - 5} more`);
      }
    }
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
}

main();
