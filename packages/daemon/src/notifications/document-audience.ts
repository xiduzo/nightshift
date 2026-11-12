import type { DocumentOf } from "@nightshift/auth";
import { documentKind } from "@nightshift/engine";

/** Who hears that a synced document was stored: one Person, or the people of a Space. */
export type DocumentAudience = { personId: string } | { spaceId: string };

/**
 * Who hears that the synced document `name` was stored, so their open
 * screens read it again. This computer's Device document and its copies
 * of the owner's other Devices: the owner (`personId`). A Space document,
 * and a Project's flows, flow history and knowledge: the people of its
 * Space. Nobody for a name of no kind, or a Project this Replica does not
 * have.
 */
export async function documentAudience(
	name: string,
	deps: {
		/** The Space of a document (`SyncedDocuments.documentOf`). */
		documentOf(name: string): Promise<DocumentOf | null>;
		/** This computer's owner. */
		personId: string;
	},
): Promise<DocumentAudience | null> {
	const found = documentKind(name);
	if (!found) return null;
	if (found.kind === "device" || found.kind === "device-copy") {
		return { personId: deps.personId };
	}
	const of = await deps.documentOf(name);
	if (!of || of.kind === "device") return null;
	return { spaceId: of.spaceId };
}
