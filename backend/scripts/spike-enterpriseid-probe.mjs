#!/usr/bin/env node
// Probe `gp:enterpriseId` (and friends) across products. The MCP Server
// taxonomy showed `gp:enterpriseId` was indexed — looks like the user-claimed
// "Axe Account UUID" fix lives there. Verify across all products.
//
// Usage: node backend/scripts/spike-enterpriseid-probe.mjs

import 'dotenv/config';

const PRODUCTS = [
  { slug: "axe-account-portal", label: "Axe Accounts",            apiEnv: "AMPLITUDE_AXE_ACCOUNT_PORTAL_API_KEY", secretEnv: "AMPLITUDE_AXE_ACCOUNT_PORTAL_SECRET_KEY", event: "login" },
  { slug: "axe-devtools",       label: "Axe DevTools Extension",  apiEnv: "AMPLITUDE_AXE_DEVTOOLS_API_KEY",       secretEnv: "AMPLITUDE_AXE_DEVTOOLS_SECRET_KEY",       event: "analysis:complete" },
  { slug: "developer-hub",      label: "Developer Hub",           apiEnv: "AMPLITUDE_DEVELOPER_HUB_API_KEY",      secretEnv: "AMPLITUDE_DEVELOPER_HUB_SECRET_KEY",      event: "project:create" },
  { slug: "axe-devtools-mobile",label: "Axe DevTools Mobile",     apiEnv: "AMPLITUDE_AXE_DEVTOOLS_MOBILE_API_KEY",secretEnv: "AMPLITUDE_AXE_DEVTOOLS_MOBILE_SECRET_KEY",event: "scan:create" },
  { slug: "axe-assistant",      label: "Axe Assistant",           apiEnv: "AMPLITUDE_AXE_ASSISTANT_API_KEY",      secretEnv: "AMPLITUDE_AXE_ASSISTANT_SECRET_KEY",      event: "user:message_sent" },
  { slug: "deque-university",   label: "Deque University",        apiEnv: "AMPLITUDE_DEQUE_UNIVERSITY_API_KEY",   secretEnv: "AMPLITUDE_DEQUE_UNIVERSITY_SECRET_KEY",   event: "session_start" },
  { slug: "axe-monitor",        label: "Axe Monitor",             apiEnv: "AMPLITUDE_AXE_MONITOR_API_KEY",        secretEnv: "AMPLITUDE_AXE_MONITOR_SECRET_KEY",        event: "scan:create:complete" },
  { slug: "axe-reports",        label: "Axe Reports",             apiEnv: "AMPLITUDE_AXE_REPORTS_API_KEY",        secretEnv: "AMPLITUDE_AXE_REPORTS_SECRET_KEY",        event: "usage:chart:load" },
  { slug: "axe-linter",         label: "Axe Linter",              apiEnv: "AMPLITUDE_AXE_LINTER_API_KEY",         secretEnv: "AMPLITUDE_AXE_LINTER_SECRET_KEY",         event: "extension:configure" },
  { slug: "axe-mcp-server",     label: "Axe MCP Server",          apiEnv: "AMPLITUDE_AXE_MCP_SERVER_API_KEY",     secretEnv: "AMPLITUDE_AXE_MCP_SERVER_SECRET_KEY",     event: "axe-mcp-server:analyze" },
];

const probeProps = [
  { type: "user", value: "gp:enterpriseId" },
  { type: "user", value: "gp:organization" },
  { type: "user", value: "gp:userId" },
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
  return "name";
}
function stripPrefix(label) {
  if (typeof label !== "string") return String(label ?? "");
  return label.startsWith("0,") ? label.slice(2) : label;
}

// 90d window — broad enough to catch slow-volume products
const end = new Date();
const start = new Date(end.getTime() - 90 * 86400 * 1000);
const startStr = fmt(start);
const endStr = fmt(end);

for (const p of PRODUCTS) {
  const apiKey = process.env[p.apiEnv];
  const secretKey = process.env[p.secretEnv];
  if (!apiKey || !secretKey) {
    console.log(`\n=== ${p.label} === (missing creds)`);
    continue;
  }
  const auth = "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
  console.log(`\n=== ${p.label} (event=${p.event}, last 90d) ===`);

  for (const prop of probeProps) {
    const params = new URLSearchParams();
    params.append("e", JSON.stringify({ event_type: p.event, group_by: [prop] }));
    params.append("start", startStr);
    params.append("end", endStr);
    params.append("m", "uniques");
    params.append("i", "30");
    try {
      const res = await fetch(`https://amplitude.com/api/2/events/segmentation?${params}`, {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      process.stdout.write(`  ${prop.value.padEnd(20)} `);
      if (!res.ok) {
        console.log(`ERROR: ${(data.error?.message || JSON.stringify(data)).slice(0, 80)}`);
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
      }).sort((a, b) => b.total - a.total);
      const byCls = {};
      for (const s of summary) byCls[s.cls] = (byCls[s.cls] || 0) + 1;
      const summaryStr = Object.entries(byCls).map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`segments=${String(summary.length).padStart(3)}  [${summaryStr}]`);
      // Always dump top 5 sample values so we can eyeball the shape
      if (summary.length > 0 && prop.value === "gp:enterpriseId") {
        for (const s of summary.slice(0, 5)) {
          console.log(`      [${s.cls.padEnd(6)}] users=${String(s.total).padStart(5)}  "${s.v.slice(0, 70)}"`);
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
}
