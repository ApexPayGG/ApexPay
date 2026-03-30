import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics, } from "prom-client";
export const register = new Registry();
collectDefaultMetrics({ register });
/** Wiersze pobrane w cyklu (FOR UPDATE) — czekające na publikację w tym batchu. */
export const outboxPendingEventsTotal = new Gauge({
    name: "outbox_pending_events_total",
    help: "Liczba wierszy outboxa pobranych w cyklu ($queryRaw), oczekujących na publikację.",
    registers: [register],
});
export const matchResolutionDurationSeconds = new Histogram({
    name: "match_resolution_duration_seconds",
    help: "Czas transakcji rozliczenia sporu (blokada FOR UPDATE + rozliczenie).",
    buckets: [0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
    registers: [register],
});
export const messageBrokerPublishErrorsTotal = new Counter({
    name: "message_broker_publish_errors_total",
    help: "Błędy wysyłki wiadomości do brokera (RabbitMQ).",
    registers: [register],
});
//# sourceMappingURL=metrics.js.map