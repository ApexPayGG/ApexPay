import pino from "pino";
/**
 * Singleton Pino: w **production** czysty JSON na stdout; w dev/test — `pino-pretty`.
 */
export declare const logger: pino.Logger;
/**
 * Child logger z `traceId` / `userId` / `actorType` z AsyncLocalStorage (HTTP lub worker).
 */
export declare function contextLogger(): pino.Logger;
//# sourceMappingURL=logger.d.ts.map