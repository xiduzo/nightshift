import type * as Y from "yjs";
import type { PersistedDocument } from "./ydoc";

/**
 * CONVERSION, with an end: the next step on `arch/end-state` removes this
 * file and its two callers (`openDeviceDocument`, `createSpaceDocuments`),
 * and the readers then require the fields.
 *
 * Writes the default of each absent field into the entries of one map.
 * It only adds: the raw entry is spread and never parsed, so a field this
 * version does not know stays. An entry that is not a plain object stays
 * as it is. With nothing to add it makes no change. The read and the
 * write are one transaction, so a change made here before it is kept.
 *
 * A change another Replica makes at the same time wins, whatever it is:
 * of two concurrent values Yjs keeps the one of the higher client id, and
 * this writes under a low one. The next start then adds the field to it.
 */
export async function writeExplicitEntries(
	document: Pick<PersistedDocument, "doc" | "change">,
	map: Y.Map<unknown>,
	defaults: Readonly<Record<string, unknown>>,
): Promise<{ written: number; entries: number }> {
	const found = incomplete(map, defaults);
	if (found.length > 0) {
		await document.change(() => {
			const { doc } = document;
			const own = doc.clientID;
			doc.clientID = 1 + Math.floor(Math.random() * LOW_CLIENT_IDS);
			try {
				for (const [key, entry] of found) map.set(key, entry);
			} finally {
				doc.clientID = own;
			}
		});
	}
	return { written: found.length, entries: map.size };
}

/** A client id of Yjs is a random number of 32 bits: one in 65,536 is this low. */
const LOW_CLIENT_IDS = 0xffff;

/** The entries of a map that miss a field, with the default of each field they miss. */
function incomplete(
	map: Y.Map<unknown>,
	defaults: Readonly<Record<string, unknown>>,
): [string, Record<string, unknown>][] {
	const found: [string, Record<string, unknown>][] = [];
	for (const [key, value] of map.entries()) {
		if (!isPlainObject(value)) continue;
		const absent = Object.entries(defaults).filter(
			([field]) => value[field] === undefined,
		);
		if (absent.length === 0) continue;
		found.push([key, { ...value, ...Object.fromEntries(absent) }]);
	}
	return found;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}
