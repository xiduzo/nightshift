/**
 * The reads this phone keeps between starts: what its tabs show first.
 * Not the detail of a run (large, and read when the person opens it),
 * not a stream, not the session, and nothing that may hold a secret.
 */
const KEPT = new Set([
	"dashboard.summary",
	"dashboard.flow",
	"gates.list",
	"runs.list",
	"projects.list",
	"flows.list",
	"schedules.list",
	"spaces.list",
]);

/** Whether the phone keeps this query between starts: a plain read of `KEPT` that has its data. */
export function keptQuery(query: {
	queryKey: readonly unknown[];
	state: { status: string };
}): boolean {
	if (query.state.status !== "success") return false;
	const [path, options] = query.queryKey;
	if (!Array.isArray(path)) return false;
	const type = (options as { type?: unknown } | undefined)?.type;
	return type === "query" && KEPT.has(path.join("."));
}
