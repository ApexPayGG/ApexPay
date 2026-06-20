import { ConnectedAccountStatus, DisputeStatus, FraudCheckStatus, Prisma, RefundStatus, } from "@prisma/client";
import { z } from "zod";
const granularitySchema = z.enum(["day", "week", "month"]);
function parseDate(raw, fallback) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return fallback;
    }
    const date = new Date(raw.trim());
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    return date;
}
function defaultRange() {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from, to };
}
function parseRangeOrRespond(req, res) {
    const defaults = defaultRange();
    const from = parseDate(req.query.from, defaults.from);
    const to = parseDate(req.query.to, defaults.to);
    if (from === undefined || to === undefined) {
        res.status(400).json({ error: "Nieprawidłowy zakres dat.", code: "BAD_REQUEST" });
        return null;
    }
    if (from > to) {
        res.status(400).json({ error: "Parametr from nie może być późniejszy niż to.", code: "BAD_REQUEST" });
        return null;
    }
    return { from, to };
}
function parseLimit(raw, fallback, max) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return fallback;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, max);
}
function toBigint(value) {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim().length > 0) {
        return BigInt(value.trim());
    }
    return 0n;
}
function minorToPln(value) {
    return Number(value) / 100;
}
function bucketKey(date, granularity) {
    const d = new Date(date);
    if (granularity === "month") {
        d.setUTCDate(1);
    }
    else if (granularity === "week") {
        const day = d.getUTCDay();
        const shift = day === 0 ? 6 : day - 1;
        d.setUTCDate(d.getUTCDate() - shift);
    }
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}
function advanceBucket(date, granularity) {
    const next = new Date(date);
    if (granularity === "month") {
        next.setUTCMonth(next.getUTCMonth() + 1);
    }
    else if (granularity === "week") {
        next.setUTCDate(next.getUTCDate() + 7);
    }
    else {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
}
function buildBucketRange(from, to, granularity) {
    const keys = [];
    let cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    if (granularity === "month") {
        cursor.setUTCDate(1);
    }
    if (granularity === "week") {
        const day = cursor.getUTCDay();
        const shift = day === 0 ? 6 : day - 1;
        cursor.setUTCDate(cursor.getUTCDate() - shift);
    }
    const toKeyBoundary = new Date(to);
    toKeyBoundary.setUTCHours(23, 59, 59, 999);
    while (cursor <= toKeyBoundary) {
        keys.push(bucketKey(cursor, granularity));
        cursor = advanceBucket(cursor, granularity);
    }
    return keys;
}
function mapRevenueRows(rows, granularity) {
    const out = new Map();
    for (const row of rows) {
        const key = bucketKey(new Date(row.bucket), granularity);
        out.set(key, (out.get(key) ?? 0n) + toBigint(row.amount));
    }
    return out;
}
export class AdminAnalyticsController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async overview(req, res) {
        const range = parseRangeOrRespond(req, res);
        if (range === null) {
            return;
        }
        const { from, to } = range;
        try {
            const [chargesAgg, payoutsAgg, refundsAgg, fraudBlocked, fraudFlagged, activeConnectedAccounts, pendingDisputes] = await Promise.all([
                this.prisma.marketplaceCharge.aggregate({
                    _count: { _all: true },
                    _sum: { amountCents: true },
                    where: { createdAt: { gte: from, lte: to } },
                }),
                this.prisma.payout.aggregate({
                    _count: { _all: true },
                    _sum: { amount: true },
                    where: { createdAt: { gte: from, lte: to } },
                }),
                this.prisma.refund.aggregate({
                    _count: { _all: true },
                    _sum: { amount: true },
                    where: { createdAt: { gte: from, lte: to }, status: RefundStatus.SUCCEEDED },
                }),
                this.prisma.fraudCheck.count({
                    where: { createdAt: { gte: from, lte: to }, status: FraudCheckStatus.BLOCKED },
                }),
                this.prisma.fraudCheck.count({
                    where: { createdAt: { gte: from, lte: to }, status: FraudCheckStatus.FLAGGED },
                }),
                this.prisma.connectedAccount.count({
                    where: { status: ConnectedAccountStatus.ACTIVE },
                }),
                this.prisma.dispute.count({
                    where: { status: { in: [DisputeStatus.RECEIVED, DisputeStatus.UNDER_REVIEW] } },
                }),
            ]);
            res.status(200).json({
                status: "success",
                data: {
                    totalCharges: {
                        count: chargesAgg._count._all,
                        amountPln: minorToPln(chargesAgg._sum.amountCents ?? 0n),
                    },
                    totalPayouts: {
                        count: payoutsAgg._count._all,
                        amountPln: minorToPln(payoutsAgg._sum.amount ?? 0n),
                    },
                    totalRefunds: {
                        count: refundsAgg._count._all,
                        amountPln: minorToPln(refundsAgg._sum.amount ?? 0n),
                    },
                    fraudBlocked,
                    fraudFlagged,
                    activeConnectedAccounts,
                    pendingDisputes,
                },
            });
        }
        catch (err) {
            console.error("[admin/analytics/overview]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async revenueChart(req, res) {
        const range = parseRangeOrRespond(req, res);
        if (range === null) {
            return;
        }
        const { from, to } = range;
        const granularityParse = granularitySchema.safeParse(req.query.granularity ?? "day");
        if (!granularityParse.success) {
            res.status(400).json({ error: "Nieprawidłowy parametr granularity.", code: "BAD_REQUEST" });
            return;
        }
        const granularity = granularityParse.data;
        const truncLiteral = granularity === "day"
            ? Prisma.sql `'day'`
            : granularity === "week"
                ? Prisma.sql `'week'`
                : Prisma.sql `'month'`;
        try {
            const [chargesRows, payoutsRows, refundsRows] = await Promise.all([
                this.prisma.$queryRaw(Prisma.sql `
          SELECT DATE_TRUNC(${truncLiteral}, "createdAt") AS bucket, SUM("amountCents") AS amount
          FROM "marketplace_charges"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
                this.prisma.$queryRaw(Prisma.sql `
          SELECT DATE_TRUNC(${truncLiteral}, "createdAt") AS bucket, SUM("amount") AS amount
          FROM "payouts"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
                this.prisma.$queryRaw(Prisma.sql `
          SELECT DATE_TRUNC(${truncLiteral}, "createdAt") AS bucket, SUM("amount") AS amount
          FROM "refunds"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} AND "status" = ${RefundStatus.SUCCEEDED}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
            ]);
            const chargesByBucket = mapRevenueRows(chargesRows, granularity);
            const payoutsByBucket = mapRevenueRows(payoutsRows, granularity);
            const refundsByBucket = mapRevenueRows(refundsRows, granularity);
            const keys = buildBucketRange(from, to, granularity);
            res.status(200).json({
                status: "success",
                data: keys.map((key) => ({
                    date: key,
                    chargesAmount: minorToPln(chargesByBucket.get(key) ?? 0n),
                    payoutsAmount: minorToPln(payoutsByBucket.get(key) ?? 0n),
                    refundsAmount: minorToPln(refundsByBucket.get(key) ?? 0n),
                })),
            });
        }
        catch (err) {
            console.error("[admin/analytics/revenue-chart]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async fraudChart(req, res) {
        const defaults = (() => {
            const to = new Date();
            const from = new Date(to);
            from.setDate(from.getDate() - 13);
            return { from, to };
        })();
        const from = parseDate(req.query.from, defaults.from);
        const to = parseDate(req.query.to, defaults.to);
        if (from === undefined || to === undefined || from > to) {
            res.status(400).json({ error: "Nieprawidłowy zakres dat.", code: "BAD_REQUEST" });
            return;
        }
        try {
            const rows = await this.prisma.$queryRaw(Prisma.sql `
        SELECT DATE_TRUNC('day', "createdAt") AS bucket, "status", COUNT(*) AS count
        FROM "fraud_checks"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `);
            const keys = buildBucketRange(from, to, "day");
            const rowsByKey = new Map();
            for (const key of keys) {
                rowsByKey.set(key, { blocked: 0, flagged: 0, passed: 0 });
            }
            for (const row of rows) {
                const key = bucketKey(new Date(row.bucket), "day");
                const agg = rowsByKey.get(key);
                if (agg === undefined) {
                    continue;
                }
                const count = Number(toBigint(row.count));
                if (row.status === FraudCheckStatus.BLOCKED) {
                    agg.blocked += count;
                }
                else if (row.status === FraudCheckStatus.FLAGGED) {
                    agg.flagged += count;
                }
                else if (row.status === FraudCheckStatus.PASSED) {
                    agg.passed += count;
                }
            }
            res.status(200).json({
                status: "success",
                data: keys.map((key) => ({
                    date: key,
                    blocked: rowsByKey.get(key)?.blocked ?? 0,
                    flagged: rowsByKey.get(key)?.flagged ?? 0,
                    passed: rowsByKey.get(key)?.passed ?? 0,
                })),
            });
        }
        catch (err) {
            console.error("[admin/analytics/fraud-chart]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    // Używane w testach i ewentualnym eksporcie.
    static parseExportLimit(raw) {
        return parseLimit(raw, 5000, 5000);
    }
}
//# sourceMappingURL=admin-analytics.controller.js.map