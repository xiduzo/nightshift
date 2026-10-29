import * as Y from "yjs";
import type { SpaceDocuments } from "../projects";

/** The transaction origin of a copy that arrives from another Replica. */
const ARRIVED = Symbol("space-document-sync");

/**
 * Brings a Space's document from one Replica to another, as a Link's
 * sync does: what a Device keeps of a Space its Host keeps. It resolves
 * once the copy is stored, and its rows (the Projects) follow. A test
 * calls it again for a later change: Hocuspocus does not run in memory.
 */
export async function syncSpaceDocument(
	from: SpaceDocuments,
	to: SpaceDocuments,
	spaceId: string,
): Promise<void> {
	const source = await from.open(spaceId);
	const copy = await to.open(spaceId);
	Y.applyUpdate(copy.doc, Y.encodeStateAsUpdate(source.doc), ARRIVED);
	await copy.flush();
}
