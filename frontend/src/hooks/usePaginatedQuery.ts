import { useInfiniteQuery } from "@tanstack/react-query";

/** Zgodnie z API: domyślnie 20, max 50 (serwer obcina). */
export const INTEGRATOR_PAGE_LIMIT = 20;

export type PaginatedListResult<T> = {
  items: T[];
  nextCursor: string | null;
};

type UsePaginatedQueryOpts<T> = {
  queryKey: readonly unknown[];
  /** Domyślnie {@link INTEGRATOR_PAGE_LIMIT}. */
  limit?: number;
  fetchPage: (args: {
    cursor: string | undefined;
    limit: number;
  }) => Promise<PaginatedListResult<T>>;
};

/**
 * Wrapper na `useInfiniteQuery`: kolejne strony przez `cursor` + `limit` w URL,
 * zwraca spłaszczoną listę i stan „Załaduj więcej”.
 */
export function usePaginatedQuery<T>(opts: UsePaginatedQueryOpts<T>) {
  const limit = opts.limit ?? INTEGRATOR_PAGE_LIMIT;
  const q = useInfiniteQuery({
    queryKey: [...opts.queryKey, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      opts.fetchPage({ cursor: pageParam, limit }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const data = q.data?.pages.flatMap((p) => p.items) ?? [];

  return {
    data,
    fetchNextPage: q.fetchNextPage,
    hasNextPage: Boolean(q.hasNextPage),
    isFetchingNextPage: q.isFetchingNextPage,
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
