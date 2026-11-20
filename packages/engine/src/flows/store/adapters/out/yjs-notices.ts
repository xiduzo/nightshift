import { randomUUID } from "node:crypto";
import type { FlowDocument } from "../../../../documents";
import {
	type FlowNotice,
	type NewNotice,
	readableNotices,
} from "../../domain/notices";
import { type FlowMaps, mapsOf } from "./yjs-flow-encoding";

/**
 * The notices and the markers of a flow document: `notices` (id → notice)
 * and the markers in `meta`, each a step done once per document.
 */

/** Every notice of the document, oldest first. One this Night Shift cannot read is left out. */
export function flowNotices(document: FlowDocument): FlowNotice[] {
	return readableNotices(mapsOf(document).notices.entries());
}

/** The notices as they go into the document in one change: call inside `current.change`. */
function putNotices(maps: FlowMaps, notices: readonly NewNotice[]): void {
	// The index leads the id, so notices of one change and one time keep their order.
	notices.forEach((notice, index) => {
		maps.notices.set(`${String(index).padStart(4, "0")}-${randomUUID()}`, {
			...notice,
		});
	});
}

/** Adds the notices, in one change. */
export async function addNotices(
	document: FlowDocument,
	notices: readonly NewNotice[],
): Promise<void> {
	const maps = mapsOf(document);
	await document.current.change(() => putNotices(maps, notices));
}

/** Whether the document holds this marker: a step done once per document (the import of a Clone). */
export function marked(document: FlowDocument, marker: string): boolean {
	return mapsOf(document).meta.has(marker);
}

/** Sets the marker, with these notices, in one change. */
export async function mark(
	document: FlowDocument,
	marker: string,
	at: number,
	notices: readonly NewNotice[] = [],
): Promise<void> {
	const maps = mapsOf(document);
	await document.current.change(() => {
		putNotices(maps, notices);
		maps.meta.set(marker, at);
	});
}

/** Removes a notice. One that is gone already is no error. */
export async function dismissNotice(
	document: FlowDocument,
	id: string,
): Promise<void> {
	const maps = mapsOf(document);
	if (!maps.notices.has(id)) return;
	await document.current.change(() => maps.notices.delete(id));
}
