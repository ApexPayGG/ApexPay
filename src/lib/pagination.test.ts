import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  paginatedResponse,
} from "./pagination.js";

describe("encodeCursor / decodeCursor", () => {
  it("round-trip zachowuje instant", () => {
    const d = new Date("2024-06-01T12:34:56.789Z");
    const c = encodeCursor(d);
    const back = decodeCursor(c);
    expect(back).toBeDefined();
    expect(back!.getTime()).toBe(d.getTime());
  });

  it("pusty / undefined → undefined", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
    expect(decodeCursor("   ")).toBeUndefined();
  });

  it("śmieciowy cursor → undefined", () => {
    expect(decodeCursor("not-base64!!!")).toBeUndefined();
  });
});

describe("paginatedResponse", () => {
  const mk = (iso: string) => ({ id: iso, createdAt: new Date(iso) });

  it("nextCursor jest null gdy items.length <= limit", () => {
    const items = [mk("2024-01-01T00:00:00.000Z"), mk("2024-01-02T00:00:00.000Z")];
    const out = paginatedResponse(items, 20, (x) => x.createdAt);
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
  });

  it("nextCursor jest nie-null gdy items.length > limit", () => {
    const items = [
      mk("2024-01-03T00:00:00.000Z"),
      mk("2024-01-02T00:00:00.000Z"),
      mk("2024-01-01T00:00:00.000Z"),
    ];
    const out = paginatedResponse(items, 2, (x) => x.createdAt);
    expect(out.items).toHaveLength(2);
    expect(out.items[1]!.id).toBe("2024-01-02T00:00:00.000Z");
    expect(out.nextCursor).not.toBeNull();
    const d = decodeCursor(out.nextCursor!);
    expect(d?.toISOString()).toBe("2024-01-02T00:00:00.000Z");
  });
});
