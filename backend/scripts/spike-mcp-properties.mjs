#!/usr/bin/env node
// Definitive enumeration of every property Amplitude has indexed on the
// Axe MCP Server project. Hits the cohorts/users propertyValues endpoint to
// list user/group properties, then dumps a sample of recent values for each.
//
// Usage: node backend/scripts/spike-mcp-properties.mjs

import 'dotenv/config';

const apiKey = process.env.AMPLITUDE_AXE_MCP_SERVER_API_KEY;
const secretKey = process.env.AMPLITUDE_AXE_MCP_SERVER_SECRET_KEY;
const auth = "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

// 1) List all user properties for this Amplitude project
console.log("=== ALL USER PROPERTIES ON MCP SERVER ===");
try {
  const res = await fetch("https://amplitude.com/api/2/taxonomy/user-property", {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  if (!res.ok) {
    console.log("  Failed:", JSON.stringify(data).slice(0, 200));
  } else {
    const props = data?.data || [];
    console.log(`  found ${props.length} user properties`);
    for (const p of props.slice(0, 50)) {
      console.log(`    ${(p.user_property || "").padEnd(40)} type=${p.value_type || ""}`);
    }
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}

// 2) List all group/event properties via /event-property
console.log("\n=== ALL EVENT PROPERTIES ON MCP SERVER ===");
try {
  const res = await fetch("https://amplitude.com/api/2/taxonomy/event-property", {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  if (!res.ok) {
    console.log("  Failed:", JSON.stringify(data).slice(0, 200));
  } else {
    const props = data?.data || [];
    console.log(`  found ${props.length} event properties`);
    for (const p of props.slice(0, 100)) {
      console.log(`    ${(p.event_type || "*").padEnd(35)} ${p.event_property || ""}`);
    }
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}

// 3) List group types (groups are the Amplitude "Accounts" feature)
console.log("\n=== GROUP TYPES ===");
try {
  const res = await fetch("https://amplitude.com/api/2/taxonomy/group", {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  if (!res.ok) {
    console.log("  Failed:", JSON.stringify(data).slice(0, 200));
  } else {
    const groups = data?.data || [];
    console.log(`  found ${groups.length} group types: ${groups.map((g) => g.group_type).join(", ")}`);
    for (const g of groups) console.log(`    ${g.group_type}`);
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}

// 4) List group properties per group type
console.log("\n=== GROUP PROPERTIES (per group type) ===");
try {
  const res = await fetch("https://amplitude.com/api/2/taxonomy/group", {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  const groups = data?.data || [];
  for (const g of groups) {
    const r = await fetch(`https://amplitude.com/api/2/taxonomy/group-property?group_type=${g.group_type}`, {
      headers: { Authorization: auth },
    });
    const d = await r.json();
    const props = d?.data || [];
    console.log(`  ${g.group_type}: ${props.length} properties`);
    for (const p of props.slice(0, 30)) {
      console.log(`    ${(p.group_property || "").padEnd(40)} type=${p.value_type || ""}`);
    }
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}
