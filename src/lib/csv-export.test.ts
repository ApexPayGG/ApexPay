import { describe, expect, it } from "vitest";
import { toCsv } from "./csv-export.js";

describe("toCsv", () => {
  it("dodaje BOM i escapuje przecinki, cudzyslowy oraz nowa linie", () => {
    const csv = toCsv(["A", "B"], [
      ["x,y", "plain"],
      ['a"b', "line1\nline2"],
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split("\r\n");

    expect(lines[0]).toBe("A,B");
    expect(lines[1]).toBe('"x,y",plain');
    expect(lines[2]).toBe('"a""b","line1\nline2"');
  });
});
