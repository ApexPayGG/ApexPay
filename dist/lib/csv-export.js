function escapeCsvCell(value) {
    const escaped = value.replace(/"/g, "\"\"");
    if (/[",\r\n]/.test(escaped)) {
        return `"${escaped}"`;
    }
    return escaped;
}
export function toCsv(headers, rows) {
    const lines = [];
    lines.push(headers.map((h) => escapeCsvCell(h)).join(","));
    for (const row of rows) {
        lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
    }
    return `\uFEFF${lines.join("\r\n")}`;
}
export function csvResponse(res, filename, csv) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(csv);
}
//# sourceMappingURL=csv-export.js.map