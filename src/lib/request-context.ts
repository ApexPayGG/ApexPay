import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContextData = {
  traceId: string;
  userId?: string | undefined;
  actorType?: string | undefined;
};

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Bieżący kontekst żądania / joba; poza `runWithContext` zwraca `{}`.
 */
export function getContext(): Partial<RequestContextData> {
  return storage.getStore() ?? {};
}

/**
 * Uruchamia `fn` z nowym kontekstem AsyncLocalStorage (dla workerów, testów).
 */
export function runWithContext<T>(context: RequestContextData, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Mutuje aktywny store (ten sam `traceId`) — wywołaj po `req.user` (JWT / API key).
 */
export function attachUserToRequestContext(req: {
  user?: { id: string; role?: string | undefined };
}): void {
  const store = storage.getStore();
  if (store === undefined) {
    return;
  }
  if (req.user !== undefined) {
    store.userId = req.user.id;
    store.actorType = req.user.role;
  }
}

export function getRequestContextStorage(): AsyncLocalStorage<RequestContextData> {
  return storage;
}
