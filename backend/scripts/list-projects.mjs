#!/usr/bin/env node
/**
 * Script to list all GitHub Projects in the dequelabs organization
 * Usage: node scripts/list-projects.mjs
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from parent directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { GitHubService } from "../dist/services/github.js";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG || "dequelabs";

  if (!token) {
    console.error("Error: GITHUB_TOKEN not configured in .env");
    process.exit(1);
  }

  console.log(`Listing GitHub Projects for: ${org}`);
  console.log("=".repeat(50));

  const github = new GitHubService({ token, org, projectNumbers: [] });

  try {
    console.log("Calling listProjects()...");
    const projects = await github.listProjects();
    console.log("Raw result:", JSON.stringify(projects.slice(0, 3), null, 2));

    // Filter out null entries and sort by project number
    const validProjects = projects.filter(p => p && p.number != null);
    validProjects.sort((a, b) => a.number - b.number);

    console.log(`\nFound ${validProjects.length} valid projects (${projects.length} total):\n`);

    // Group by open/closed
    const openProjects = validProjects.filter(p => !p.closed);
    const closedProjects = validProjects.filter(p => p.closed);

    console.log(`Open Projects (${openProjects.length}):`);
    console.log("-".repeat(50));
    for (const p of openProjects) {
      console.log(`  #${p.number.toString().padStart(3)} - ${p.title}`);
    }

    if (closedProjects.length > 0) {
      console.log(`\nClosed Projects (${closedProjects.length}):`);
      console.log("-".repeat(50));
      for (const p of closedProjects) {
        console.log(`  #${p.number.toString().padStart(3)} - ${p.title}`);
      }
    }

    // Output project numbers for easy copy-paste
    console.log("\n" + "=".repeat(50));
    console.log("Open project numbers (comma-separated):");
    console.log(openProjects.map(p => p.number).join(","));

  } catch (error) {
    console.error("Failed to list projects:", error);
    process.exit(1);
  }
}

main();
