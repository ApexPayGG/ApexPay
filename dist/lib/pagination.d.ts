/** Domyślny limit strony dla list kursorowych (panel integratora). */
export declare const DEFAULT_PAGE_LIMIT = 20;
/** Maksymalny dozwolony limit (query `limit`). */
export declare const MAX_PAGE_LIMIT = 50;
export type PaginatedSlice<T> = {
    items: T[];
    nextCursor: string | null;
};
/**
 * Parsuje `limit` z query (np. `req.query.limit`). Nieprawidłowe wartości → domyślny limit.
 */
export declare function parsePaginationLimit(raw: unknown): number;
/** ISO-8601 w UTF-8 → base64url (bez paddingu). */
export declare function encodeCursor(date: Date): string;
/** base64url → `Date`; nieprawidłowy lub pusty → `undefined`. */
export declare function decodeCursor(cursor?: string): Date | undefined;
/**
 * Obcina do `limit` elementów; jeśli wejście ma więcej niż `limit`, zwraca `nextCursor`
 * z daty ostatniego elementu na stronie.
 */
export declare function paginatedResponse<T>(items: T[], limit: number, getDate: (item: T) => Date): PaginatedSlice<T>;
//# sourceMappingURL=pagination.d.ts.map