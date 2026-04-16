import { AsyncLocalStorage } from "node:async_hooks";
export type RequestContextData = {
    traceId: string;
    userId?: string | undefined;
    actorType?: string | undefined;
};
/**
 * Bieżący kontekst żądania / joba; poza `runWithContext` zwraca `{}`.
 */
export declare function getContext(): Partial<RequestContextData>;
/**
 * Uruchamia `fn` z nowym kontekstem AsyncLocalStorage (dla workerów, testów).
 */
export declare function runWithContext<T>(context: RequestContextData, fn: () => T): T;
/**
 * Mutuje aktywny store (ten sam `traceId`) — wywołaj po `req.user` (JWT / API key).
 */
export declare function attachUserToRequestContext(req: {
    user?: {
        id: string;
        role?: string | undefined;
    };
}): void;
export declare function getRequestContextStorage(): AsyncLocalStorage<RequestContextData>;
//# sourceMappingURL=request-context.d.ts.map