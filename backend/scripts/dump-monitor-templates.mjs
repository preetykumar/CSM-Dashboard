// Dump every row that has ANY content in cols 1-12 (not just ID/Description).
// Goal: verify what enhancements are actually in the xlsx files.

import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const FILES = [
  {
    label: "SaaS (post-sale)",
    path: path.join(REPO_ROOT, "templates", "axe-monitor-SaaS-post-sale-implementation-playbook pK edits.xlsx"),
  },
  {
    label: "On-Prem (sale)",
    path: path.join(REPO_ROOT, "templates", "axe-monitor-onprem-sale-implementation-playbook with pK edits.xlsx"),
  },
];

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value.richText) return value.richText.map((r) => r.text).join("");
  if (typeof value === "object" && value.text) return value.text;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

for (const file of FILES) {
  console.log("\n" + "=".repeat(100));
  console.log(`FILE: ${file.label}`);
  console.log("=".repeat(100));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file.path);
  const sheet = wb.worksheets[0];

  let kept = 0;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells = {};
    let hasAny = false;
    for (let c = 1; c <= 12; c++) {
      const v = cellText(row.getCell(c).value).trim();
      cells[c] = v;
      if (v) hasAny = true;
    }
    if (!hasAny) continue;
    kept++;
    // Print compact form: ID | Type | Description
    const id = cells[1] || "(no id)";
    const type = cells[3] || "(no type)";
    const desc = cells[2] || "(no desc)";
    const outcome = cells[4] ? ` | outcome="${cells[4]}"` : "";
    const status = cells[5] ? ` | status=${cells[5]}` : "";
    console.log(`[${id.padEnd(8)}] ${type.padEnd(10)} ${desc}${outcome}${status}`);
  }
  console.log(`\n--- Total rows with any content in cols 1-12: ${kept} ---`);
}
