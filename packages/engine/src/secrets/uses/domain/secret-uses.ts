import type { NotRead } from "../../../contract";

/** A use is written at most once a minute per secret: the time is to the minute. */
export const SECRET_USE_INTERVAL_MS = 60_000;

/**
 * The use times after Night Shift read `names` at `at`, or null when none
 * is due: a name is due when it was never used, or not in the last
 * minute.
 */
export function dueUses(
	used: ReadonlyMap<string, number>,
	names: Iterable<string>,
	at: number,
): Map<string, number> | null {
	const due = [...new Set(names)].filter((name) => {
		const last = used.get(name);
		return last === undefined || Math.abs(at - last) >= SECRET_USE_INTERVAL_MS;
	});
	if (due.length === 0) return null;
	const next = new Map(used);
	for (const name of due) next.set(name, at);
	return next;
}

/** The values read for a use, and which scopes could not be read. */
export type Resolved = {
	vars: Record<string, string | undefined>;
	/** The names whose value is the use's Project's. */
	fromProject: ReadonlySet<string>;
	unreachable: boolean;
	projectUnreachable: boolean;
	/** A name is a Personal secret, which works nowhere on this computer. */
	personalHere: boolean;
};

/** The flags of `NotRead` that are set, to spread into a result. */
export function notRead({
	unreachable,
	projectUnreachable,
	personalHere,
}: Resolved): NotRead {
	return {
		...(unreachable ? { unreachable } : {}),
		...(projectUnreachable ? { projectUnreachable } : {}),
		...(personalHere ? { personalHere } : {}),
	};
}
