import {
	isKnowledgeOwnFolder,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/**
 * The paths a removal of a source's folder takes: every path under the
 * folder. Refuses a folder outside the knowledge and one of Night
 * Shift's own. `isKnowledgePath` says which paths are the knowledge.
 */
export function folderPrefix(
	folder: string,
	isKnowledgePath: (path: string) => boolean,
): string {
	const name = folder.replace(/\/+$/, "");
	const prefix = `${name}/`;
	if (!isKnowledgePath(`${prefix}x`) || isKnowledgeOwnFolder(name)) {
		throw new Refusal(
			"invalid",
			`Choose a folder inside the knowledge. ${KNOWLEDGE_OWN_FOLDERS_WORDS}`,
		);
	}
	return prefix;
}

/** A removal while a step writes the folder. */
export function heldNow(): Refusal {
	return new Refusal(
		"conflict",
		"A run is changing this knowledge now. Try again when it ends.",
	);
}
