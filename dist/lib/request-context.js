import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
/**
 * Bieżący kontekst żądania / joba; poza `runWithContext` zwraca `{}`.
 */
export function getContext() {
    return storage.getStore() ?? {};
}
/**
 * Uruchamia `fn` z nowym kontekstem AsyncLocalStorage (dla workerów, testów).
 */
export function runWithContext(context, fn) {
    return storage.run(context, fn);
}
/**
 * Mutuje aktywny store (ten sam `traceId`) — wywołaj po `req.user` (JWT / API key).
 */
export function attachUserToRequestContext(req) {
    const store = storage.getStore();
    if (store === undefined) {
        return;
    }
    if (req.user !== undefined) {
        store.userId = req.user.id;
        store.actorType = req.user.role;
    }
}
export function getRequestContextStorage() {
    return storage;
}
//# sourceMappingURL=request-context.js.map