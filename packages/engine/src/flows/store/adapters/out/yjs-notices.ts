import { randomUUID } from "node:crypto";
import type { FlowDocument } from "../../../../documents";
import {
	type FlowNotice,
	type NewNotice,
	readableNotices,
} from "../../domain/notices";
import { mapsOf } from "./yjs-flow-encoding";

/**
 * The notices and the markers of a flow document: `notices` (id → notice)
 * and the markers in `meta`, each a step done once per document.
 */

/** Every notice of the document, oldest first. One this Night Shift cannot read is left out. */
export function flowNotices(document: FlowDocument): FlowNotice[] {
	return readableNotices(mapsOf(document).notices.entries());
}

/** Whether the document holds this marker: a step done once per document (the merge of another document). */
export function marked(document: FlowDocument, marker: string): boolean {
	return mapsOf(document).meta.has(marker);
}

/** Adds the notice once per document: the marker stays when a person dismisses it. */
export async function noteOnce(
	document: FlowDocument,
	marker: string,
	notice: NewNotice,
): Promise<void> {
	if (marked(document, marker)) return;
	const maps = mapsOf(document);
	await document.current.change(() => {
		maps.notices.set(randomUUID(), { ...notice });
		maps.meta.set(marker, notice.at);
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
