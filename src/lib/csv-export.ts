import type { Response } from "express";

function escapeCsvCell(value: string): string {
  const escaped = value.replace(/"/g, "\"\"");
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(headers.map((h) => escapeCsvCell(h)).join(","));
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function csvResponse(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
