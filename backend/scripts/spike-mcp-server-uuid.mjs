#!/usr/bin/env node
// Re-probe Axe MCP Server — the user says the Axe-Account-UUID code has shipped
// there. The first probe only looked at `gp:organization`; this script tries
// several candidate property names (gp:* and up:*) to find where the UUID is
// actually landing.
//
// Usage: node backend/scripts/spike-mcp-server-uuid.mjs

import 'dotenv/config';

const apiKey = process.env.AMPLITUDE_AXE_MCP_SERVER_API_KEY;
const secretKey = process.env.AMPLITUDE_AXE_MCP_SERVER_SECRET_KEY;
if (!apiKey || !secretKey) {
  console.error("Missing AMPLITUDE_AXE_MCP_SERVER_API_KEY / SECRET_KEY");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

const event = "axe-mcp-server:analyze";

// Try multiple lookback windows so we can see if a recent deploy is just
// starting to appear.
const windows = [
  { name: "last 2 days",  days: 2 },
  { name: "last 7 days",  days: 7 },
  { name: "last 30 days", days: 30 },
];

// Candidate group-by properties. Group props (gp:*) live on the group/account;
// user props (up:*) live on the user. UUID code could plausibly land in any.
const candidates = [
  // Group properties
  { type: "user", value: "gp:organization" },
  { type: "user", value: "gp:axe_account_uuid" },
  { type: "user", value: "gp:account_uuid" },
  { type: "user", value: "gp:enterprise_uuid" },
  { type: "user", value: "gp:org_uuid" },
  { type: "user", value: "gp:axe_account_id" },
  // User properties
  { type: "user", value: "up:axe_account_uuid" },
  { type: "user", value: "up:account_uuid" },
  { type: "user", value: "up:enterprise_uuid" },
  { type: "user", value: "up:org_uuid" },
  { type: "user", value: "up:account_id" },
  { type: "user", value: "up:axe_account_id" },
  { type: "user", value: "up:organization" },
];

function fmt(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function classify(v) {
  if (v == null || v === "" || v === "(none)" || v === "undefined") return "empty";
  if (UUID_RE.test(v)) return "UUID";
  if (/^[0-9a-f]{16,}$/i.test(v)) return "hex";
  if (v.includes(".") && /\.[a-z]{2,}$/i.test(v)) return "domain";
  return "name/other";
}
function stripPrefix(label) {
  if (typeof label !== "string") return String(label ?? "");
  return label.startsWith("0,") ? label.slice(2) : label;
}

async function fetchSeg(groupBy, startStr, endStr) {
  const params = new URLSearchParams();
  params.append("e", JSON.stringify({ event_type: event, group_by: [groupBy] }));
  params.append("start", startStr);
  params.append("end", endStr);
  params.append("m", "uniques");
  params.append("i", "30");
  const res = await fetch(`https://amplitude.com/api/2/events/segmentation?${params}`, {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  if (!res.ok) return { error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
  return { data };
}

for (const win of windows) {
  const end = new Date();
  const start = new Date(end.getTime() - win.days * 86400 * 1000);
  const startStr = fmt(start);
  const endStr = fmt(end);

  console.log(`\n========== ${win.name} (${startStr}–${endStr}) ==========`);

  for (const c of candidates) {
    const { error, data } = await fetchSeg(c, startStr, endStr);
    process.stdout.write(`  ${c.value.padEnd(30)} `);
    if (error) {
      console.log(`ERROR: ${error.slice(0, 90)}`);
      continue;
    }
    const labels = data?.data?.seriesLabels || [];
    const series = data?.data?.series || [];
    if (labels.length === 0) {
      console.log("(no segments)");
      continue;
    }
    const summary = labels.map((rawLabel, i) => {
      const arr = series[i] || [];
      const total = arr.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
      const v = stripPrefix(rawLabel);
      return { v, total, cls: classify(v) };
    });
    const byCls = {};
    for (const s of summary) byCls[s.cls] = (byCls[s.cls] || 0) + 1;
    const totalUsers = summary.reduce((a, s) => a + s.total, 0);
    const summaryStr = Object.entries(byCls).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`segments=${String(summary.length).padStart(3)} users=${String(totalUsers).padStart(5)}  [${summaryStr}]`);

    // Highlight if any UUID found
    const uuids = summary.filter((s) => s.cls === "UUID").slice(0, 5);
    if (uuids.length > 0) {
      console.log(`    UUIDs (top 5): ${uuids.map((u) => `${u.v}(${u.total}u)`).join("  ")}`);
    }
  }
}
