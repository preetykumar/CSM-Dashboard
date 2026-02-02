#!/usr/bin/env node
/**
 * Debug script to check GitHub Projects API access
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const token = process.env.GITHUB_TOKEN;
const org = process.env.GITHUB_ORG || "dequelabs";

if (!token) {
  console.error("Error: GITHUB_TOKEN not configured");
  process.exit(1);
}

// Direct GraphQL query
const query = `
  query ListProjects($org: String!) {
    organization(login: $org) {
      projectsV2(first: 20) {
        totalCount
        nodes {
          number
          title
          closed
        }
      }
    }
  }
`;

async function main() {
  console.log(`Testing GitHub API for org: ${org}`);
  console.log(`Token prefix: ${token.substring(0, 15)}...`);
  console.log();

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables: { org } }),
    });

    console.log(`Response status: ${response.status}`);

    const json = await response.json();

    if (json.errors) {
      console.log("\nGraphQL Errors:");
      console.log(JSON.stringify(json.errors, null, 2));
    }

    if (json.data) {
      console.log("\nData received:");
      console.log(JSON.stringify(json.data, null, 2));
    }

    // Also check token scopes
    const scopeHeader = response.headers.get("x-oauth-scopes");
    console.log(`\nToken scopes: ${scopeHeader || "not available"}`);

  } catch (error) {
    console.error("Error:", error);
  }
}

main();
