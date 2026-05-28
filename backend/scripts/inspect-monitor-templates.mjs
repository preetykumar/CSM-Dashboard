// Inspect both Monitor playbook xlsx files: sheet names, columns, sample rows.
// Goal: figure out the natural hierarchy (phases/tasks/subtasks) before designing schema.
//
// Usage: node backend/scripts/inspect-monitor-templates.mjs

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

function preview(value, max = 80) {
  const oneLine = cellText(value).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

for (const file of FILES) {
  console.log("\n" + "=".repeat(80));
  console.log(`FILE: ${file.label}`);
  console.log("=".repeat(80));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file.path);

  for (const sheet of wb.worksheets) {
    // Print full header row (all 28 columns)
    console.log(`\nSHEET: "${sheet.name}"  rowCount=${sheet.rowCount} colCount=${sheet.columnCount}`);
    console.log("\nAll header columns (row 1):");
    const headerRow = sheet.getRow(1);
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = preview(headerRow.getCell(c).value, 60);
      if (v) console.log(`  col ${String(c).padStart(2)}: ${v}`);
    }

    // Count actual non-empty rows + activity type distribution
    let nonEmpty = 0;
    const typeCounts = {};
    let maxIdDepth = 0;
    const sampleByType = {};
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const id = cellText(row.getCell(1).value);
      const desc = cellText(row.getCell(2).value);
      const type = cellText(row.getCell(3).value);
      if (!id && !desc) continue;
      nonEmpty++;
      typeCounts[type || "(blank)"] = (typeCounts[type || "(blank)"] || 0) + 1;
      // ID depth = number of separators (. or ,) + 1
      const depth = id ? id.split(/[.,]/).length : 0;
      if (depth > maxIdDepth) maxIdDepth = depth;
      if (!sampleByType[type || "(blank)"]) {
        sampleByType[type || "(blank)"] = { id, desc: desc.slice(0, 70) };
      }
    }
    console.log(`\nNon-empty rows: ${nonEmpty}`);
    console.log(`Max ID depth (e.g. "2.14.1" = 3): ${maxIdDepth}`);
    console.log(`Activity Type distribution:`);
    for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      const s = sampleByType[k];
      console.log(`  ${k.padEnd(15)} ${String(v).padStart(4)}  e.g. [${s.id}] ${s.desc}`);
    }

    // Show columns 11+ from rows that have something there
    console.log(`\nSample data from cols 11-28 (rows where they're populated):`);
    let shown = 0;
    for (let r = 2; r <= sheet.rowCount && shown < 5; r++) {
      const row = sheet.getRow(r);
      const id = cellText(row.getCell(1).value);
      const extras = [];
      for (let c = 11; c <= sheet.columnCount; c++) {
        const v = preview(row.getCell(c).value, 30);
        if (v) extras.push(`c${c}=${v}`);
      }
      if (extras.length > 0) {
        console.log(`  r${r} id=${id}: ${extras.join(" | ")}`);
        shown++;
      }
    }
    if (shown === 0) console.log("  (cols 11-28 appear unused)");
  }
}
