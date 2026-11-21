import { Refusal } from "@nightshift/refusal";
import { OLDER_HOST } from "../../../contract";
import { NOT_FETCHED, ON_ANOTHER_DEVICE } from "../domain/listing";
import { cleanPath } from "../domain/paths";
import type { KnowledgeText, ReadFrom } from "../domain/text";
import type {
	ContentArchive,
	ContentTexts,
	KnowledgeEntries,
	KnowledgeFolders,
	SpaceStatus,
} from "./ports";

export type ReadKnowledgeFilePorts = {
	folders: Pick<KnowledgeFolders, "read">;
	status: Pick<SpaceStatus, "spaceOf" | "isOlder" | "heard">;
	documents: KnowledgeEntries;
	archive: ContentArchive;
	texts: ContentTexts;
	/** This Device: a file larger than 10 MB can be read only on the Device that has it. */
	deviceId: string;
};

/** One file of a project's knowledge, by its path, at most `maxBytes` of its text, from `from` when given. */
export type ReadKnowledgeFile = {
	projectId: string;
	path: string;
	maxBytes: number;
	from?: ReadFrom;
};

/**
 * One file of the project's knowledge: this Device's copy, else its
 * content by its hash in the document, from the archive here or at the
 * Host. A PDF or Word file gives its text either way. Null when neither
 * has the file, and for a proposed learning. Refuses (never a plain error)
 * a file that is not text, one that stays on another Device, and one whose
 * content cannot be fetched now.
 *
 * A person on the Knowledge page asks it, and an agent. The API checks who
 * may first.
 */
export const readKnowledgeFile =
	(ports: ReadKnowledgeFilePorts) =>
	async (request: ReadKnowledgeFile): Promise<KnowledgeText | null> => {
		const { projectId, path, maxBytes, from } = request;
		// This computer's folder first: it may not have the file yet.
		const here = await ports.folders.read(projectId, path, maxBytes, from);
		if (here) return here;
		const clean = cleanPath(path);
		if (clean === null) return null;
		const spaceId = await ports.status.spaceOf(projectId);
		const entry = (await ports.documents.open(projectId)).entries().get(clean);
		if (spaceId === null || !entry) return null;
		if (entry.local && entry.deviceId !== ports.deviceId) {
			throw new Refusal("unavailable", ON_ANOTHER_DEVICE);
		}
		const content = await ports.archive
			.read({ kind: "content", spaceId, sha256: entry.sha256 })
			.catch((error: unknown) => {
				ports.status.heard(spaceId, error);
				return null;
			});
		if (!content && ports.status.isOlder(spaceId)) {
			throw new Refusal("unavailable", OLDER_HOST);
		}
		if (!content) throw new Refusal("unavailable", NOT_FETCHED);
		return ports.texts.text(clean, content, maxBytes, from);
	};
