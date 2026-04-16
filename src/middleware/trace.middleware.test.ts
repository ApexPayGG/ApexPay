import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTraceMiddleware, APEX_TRACE_HEADER } from "./trace.middleware.js";

describe("trace middleware — x-trace-id", () => {
  it("odbija ten sam traceId w odpowiedzi co w żądaniu", async () => {
    const app = express();
    app.use(createTraceMiddleware());
    app.get("/ping", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const sent = "upstream-trace-abc-123";
    const res = await request(app).get("/ping").set(APEX_TRACE_HEADER, sent);

    expect(res.headers[APEX_TRACE_HEADER]).toBe(sent);
    expect(res.status).toBe(200);
  });

  it("generuje UUID gdy brak nagłówka", async () => {
    const app = express();
    app.use(createTraceMiddleware());
    app.get("/p", (_req, res) => res.json({}));

    const res = await request(app).get("/p");
    const tid = res.headers[APEX_TRACE_HEADER];
    expect(typeof tid).toBe("string");
    expect(tid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
