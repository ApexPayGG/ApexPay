import pino from "pino";
import { getContext } from "./request-context.js";
const level = process.env.LOG_LEVEL?.trim() || "info";
const isProd = process.env.NODE_ENV === "production";
/**
 * Singleton Pino: w **production** czysty JSON na stdout; w dev/test — `pino-pretty`.
 */
export const logger = isProd
    ? pino({ level })
    : pino({
        level,
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "SYS:HH:MM:ss.l",
                ignore: "pid,hostname",
            },
        },
    });
/**
 * Child logger z `traceId` / `userId` / `actorType` z AsyncLocalStorage (HTTP lub worker).
 */
export function contextLogger() {
    const { traceId, userId, actorType } = getContext();
    const childBindings = {};
    if (traceId !== undefined) {
        childBindings.traceId = traceId;
    }
    if (userId !== undefined) {
        childBindings.userId = userId;
    }
    if (actorType !== undefined) {
        childBindings.actorType = actorType;
    }
    if (Object.keys(childBindings).length === 0) {
        return logger;
    }
    return logger.child(childBindings);
}
//# sourceMappingURL=logger.js.map