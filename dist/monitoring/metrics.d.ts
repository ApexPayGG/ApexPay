import { Counter, Gauge, Histogram, Registry } from "prom-client";
export declare const register: Registry<"text/plain; version=0.0.4; charset=utf-8">;
/** Wiersze pobrane w cyklu (FOR UPDATE) — czekające na publikację w tym batchu. */
export declare const outboxPendingEventsTotal: Gauge<string>;
export declare const matchResolutionDurationSeconds: Histogram<string>;
export declare const messageBrokerPublishErrorsTotal: Counter<string>;
//# sourceMappingURL=metrics.d.ts.map