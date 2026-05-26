#!/usr/bin/env node
// Probe Amplitude `gp:organization` coverage per product. For each product,
// hit the events/segmentation endpoint with the product's headline event
// grouped by `gp:organization`, then look at the top values and classify:
//   - UUID-looking      (8-4-4-4-12 hex, the SF Enterprise_UUID__c shape)
//   - Domain-looking    (contains a dot, like "acme.com")
//   - Numeric-looking   (Slack team IDs or similar)
//   - Plain name        (free-form, human-readable)
//   - Empty / undefined (the workaround case)
//
// Use this to decide whether a product's UUID code has reached prod yet
// (i.e. whether we can flip its PRODUCT_EVENTS.usesOrgName off).
//
// Usage: node backend/scripts/spike-amplitude-uuid-coverage.mjs

import 'dotenv/config';

const PRODUCTS = [
  { slug: "axe-account-portal", label: "Axe Accounts", apiEnv: "AMPLITUDE_AXE_ACCOUNT_PORTAL_API_KEY", secretEnv: "AMPLITUDE_AXE_ACCOUNT_PORTAL_SECRET_KEY", event: "login" },
  { slug: "axe-devtools",       label: "Axe DevTools Extension", apiEnv: "AMPLITUDE_AXE_DEVTOOLS_API_KEY", secretEnv: "AMPLITUDE_AXE_DEVTOOLS_SECRET_KEY", event: "analysis:complete" },
  { slug: "developer-hub",      label: "Developer Hub", apiEnv: "AMPLITUDE_DEVELOPER_HUB_API_KEY", secretEnv: "AMPLITUDE_DEVELOPER_HUB_SECRET_KEY", event: "project:create" },
  { slug: "axe-devtools-mobile", label: "Axe DevTools Mobile", apiEnv: "AMPLITUDE_AXE_DEVTOOLS_MOBILE_API_KEY", secretEnv: "AMPLITUDE_AXE_DEVTOOLS_MOBILE_SECRET_KEY", event: "scan:create" },
  { slug: "axe-assistant",      label: "Axe Assistant", apiEnv: "AMPLITUDE_AXE_ASSISTANT_API_KEY", secretEnv: "AMPLITUDE_AXE_ASSISTANT_SECRET_KEY", event: "user:message_sent" },
  { slug: "deque-university",   label: "Deque University", apiEnv: "AMPLITUDE_DEQUE_UNIVERSITY_API_KEY", secretEnv: "AMPLITUDE_DEQUE_UNIVERSITY_SECRET_KEY", event: "session_start" },
  { slug: "axe-monitor",        label: "Axe Monitor", apiEnv: "AMPLITUDE_AXE_MONITOR_API_KEY", secretEnv: "AMPLITUDE_AXE_MONITOR_SECRET_KEY", event: "scan:create:complete" },
  { slug: "axe-reports",        label: "Axe Reports", apiEnv: "AMPLITUDE_AXE_REPORTS_API_KEY", secretEnv: "AMPLITUDE_AXE_REPORTS_SECRET_KEY", event: "usage:chart:load" },
  { slug: "axe-linter",         label: "Axe Linter", apiEnv: "AMPLITUDE_AXE_LINTER_API_KEY", secretEnv: "AMPLITUDE_AXE_LINTER_SECRET_KEY", event: "extension:configure" },
  { slug: "axe-mcp-server",     label: "Axe MCP Server", apiEnv: "AMPLITUDE_AXE_MCP_SERVER_API_KEY", secretEnv: "AMPLITUDE_AXE_MCP_SERVER_SECRET_KEY", event: "axe-mcp-server:analyze" },
];

// Window: pass `--days=N` to set lookback; default 14d to detect recent deploys
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 14;
console.log(`Lookback: ${days} days\n`);
const end = new Date();
const start = new Date(end.getTime() - days * 86400 * 1000);
function fmt(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
const startStr = fmt(start);
const endStr = fmt(end);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_HEX_RE = /^[0-9a-f]{16,}$/i;
function classify(v) {
  if (v == null || v === "" || v === "(none)" || v === "undefined") return "empty";
  if (UUID_RE.test(v)) return "uuid";
  if (ALL_HEX_RE.test(v)) return "hex";
  if (/^[T0-9A-Z]{8,12}$/.test(v) && /[T0-9]/.test(v[0])) return "team-id"; // Slack
  if (v.includes(".") && /\.[a-z]{2,}$/i.test(v)) return "domain";
  if (/^https?:\/\//.test(v)) return "url";
  return "name";
}

async function probe(product) {
  const apiKey = process.env[product.apiEnv];
  const secretKey = process.env[product.secretEnv];
  if (!apiKey || !secretKey) {
    return { product, error: `missing env (${product.apiEnv})` };
  }
  const auth = "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

  // Use events/segmentation with group_by gp:organization, m=uniques
  const params = new URLSearchParams();
  params.append("e", JSON.stringify({
    event_type: product.event,
    group_by: [{ type: "user", value: "gp:organization" }],
  }));
  params.append("start", startStr);
  params.append("end", endStr);
  params.append("m", "uniques");
  params.append("i", "30"); // bucket size doesn't matter; we want segment list

  const url = `https://amplitude.com/api/2/events/segmentation?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    const data = await res.json();
    if (!res.ok) return { product, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    return { product, data };
  } catch (e) {
    return { product, error: e.message };
  }
}

console.log(`Probing gp:organization on each product's headline event over ${startStr}–${endStr}`);
console.log("(classifications: uuid / domain / name / team-id / hex / empty / url)\n");

for (const product of PRODUCTS) {
  const { error, data } = await probe(product);
  console.log(`=== ${product.label} (${product.slug}) · event=${product.event} ===`);
  if (error) {
    console.log(`  ERROR: ${error}\n`);
    continue;
  }

  // data.data.seriesLabels and data.data.series — the segmentation values
  const series = data?.data?.series || [];
  const labels = data?.data?.seriesLabels || [];
  if (series.length === 0) {
    console.log(`  (no data)\n`);
    continue;
  }

  // Each label is a segment value. Sum each segment's last bucket as a rough
  // "active users with this org value" count. Strip the leading "0," group
  // prefix Amplitude adds to multi-group labels.
  function stripPrefix(label) {
    if (typeof label !== "string") return String(label ?? "");
    return label.startsWith("0,") ? label.slice(2) : label;
  }
  const summary = labels.map((rawLabel, i) => {
    const arr = series[i] || [];
    const total = arr.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
    const label = stripPrefix(rawLabel);
    const cls = classify(label);
    return { label, total, cls };
  }).sort((a, b) => b.total - a.total);

  const byCls = {};
  for (const s of summary) byCls[s.cls] = (byCls[s.cls] || 0) + 1;

  console.log(`  segments: ${summary.length} · breakdown: ${Object.entries(byCls).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  top 8:`);
  for (const s of summary.slice(0, 8)) {
    console.log(`    [${s.cls.padEnd(7)}] users=${String(s.total).padStart(5)}  "${(s.label ?? "").slice(0, 60)}"`);
  }
  console.log();
}
