// Which Sections are folded, per browser (decision 1 of the canvas
// research): the flow file holds the Sections, never whether they are
// folded. Kept per project and flow, as a list of Section ids, so the
// editor, the run page and a Subflow seen in place fold the same.

/** Where this browser keeps the folds, or null when it has no storage. */
export type FoldStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "nightshift:section-folds:";

/** The storage key of a flow's folds. `flowKey` is `<project>/<flow>`. */
export function foldsStorageKey(flowKey: string): string {
	return STORAGE_PREFIX + flowKey;
}

function browserStorage(): FoldStorage | undefined {
	try {
		return globalThis.localStorage ?? undefined;
	} catch {
		// Blocked site data throws on access.
		return undefined;
	}
}

/** The ids of the folded Sections of a flow. Empty when the browser keeps none. */
export function readFolds(
	flowKey: string,
	storage: FoldStorage | undefined = browserStorage(),
): Set<string> {
	try {
		const stored = storage?.getItem(foldsStorageKey(flowKey));
		const ids: unknown = stored ? JSON.parse(stored) : [];
		return new Set(
			Array.isArray(ids)
				? ids.filter((id): id is string => typeof id === "string")
				: [],
		);
	} catch {
		return new Set();
	}
}

export function writeFolds(
	flowKey: string,
	folds: ReadonlySet<string>,
	storage: FoldStorage | undefined = browserStorage(),
): void {
	try {
		const key = foldsStorageKey(flowKey);
		if (folds.size === 0) storage?.removeItem(key);
		else storage?.setItem(key, JSON.stringify([...folds].sort()));
	} catch {
		// Storage can be full or blocked. The folds hold until a reload.
	}
}

/** The folds with one Section folded or unfolded. The same set when nothing changes. */
export function withFold(
	folds: ReadonlySet<string>,
	sectionId: string,
	folded: boolean,
): ReadonlySet<string> {
	if (folds.has(sectionId) === folded) return folds;
	const next = new Set(folds);
	if (folded) next.add(sectionId);
	else next.delete(sectionId);
	return next;
}
