import type {
	EnsureQueryDataOptions,
	QueryClient,
	QueryKey,
} from "@tanstack/react-query";

/**
 * Starts loading the data of a page before the page shows: when you point
 * at its link, and while its code loads. It loads only what is not in the
 * cache yet, and never waits or throws: the page shows its own loading and
 * its own errors, as before. Only in the browser, because the session is
 * there.
 */
export function preloadQuery<
	TQueryFnData,
	TError,
	TData,
	TQueryKey extends QueryKey,
>(
	queryClient: QueryClient,
	options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
): void {
	if (typeof window === "undefined") return;
	void queryClient.ensureQueryData(options).catch(() => undefined);
}
