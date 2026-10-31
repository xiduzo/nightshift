/**
 * The reads this phone keeps between starts: what its tabs show first.
 * Not the detail of a run (large, and read when the person opens it),
 * not a stream, not the session, and nothing that may hold a secret.
 */
export const KEPT_PATHS = [
	"dashboard.summary",
	"dashboard.flow",
	"gates.list",
	"runs.list",
	"projects.list",
	"flows.list",
	"schedules.list",
	"spaces.list",
] as const;

const KEPT = new Set<string>(KEPT_PATHS);

/** How long a kept read may show at the next start. Older ones are dropped. */
export const KEPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type QueryLike = {
	queryKey: readonly unknown[];
	state: { status: string };
};

function typeOf(queryKey: readonly unknown[]): unknown {
	return (queryKey[1] as { type?: unknown } | undefined)?.type;
}

/** Whether the phone keeps this query between starts: a read of `KEPT` (plain or in pages) that has its data. */
export function keptQuery(query: QueryLike): boolean {
	if (query.state.status !== "success") return false;
	const [path] = query.queryKey;
	if (!Array.isArray(path)) return false;
	const type = typeOf(query.queryKey);
	return (type === "query" || type === "infinite") && KEPT.has(path.join("."));
}

type KeptQuery = { queryKey: readonly unknown[]; state: { data?: unknown } };

/**
 * What the phone writes of the kept reads: a read in pages (the Runs tab)
 * keeps only its first page. The next start shows that page, and the
 * person loads more as before.
 */
export function firstPageOnly<
	T extends { clientState: { queries: readonly KeptQuery[] } },
>(kept: T): T {
	return {
		...kept,
		clientState: {
			...kept.clientState,
			queries: kept.clientState.queries.map((query) => {
				if (typeOf(query.queryKey) !== "infinite") return query;
				const data = query.state.data as
					| { pages: unknown[]; pageParams: unknown[] }
					| undefined;
				if (!data || data.pages.length <= 1) return query;
				return {
					...query,
					state: {
						...query.state,
						data: {
							pages: data.pages.slice(0, 1),
							pageParams: data.pageParams.slice(0, 1),
						},
					},
				};
			}),
		},
	};
}
