import type { KnowledgeFile } from "../../files";
import {
	fileUseOf,
	type KnowledgeUseReport,
	USE_EVENTS,
	useSince,
} from "../domain/use";
import type { KnowledgeUseLog, ListedFiles } from "./ports";

export type ReadKnowledgeUsePorts = {
	files: ListedFiles;
	log: KnowledgeUseLog;
	now: () => number;
};

/** Which project's use. */
export type ReadKnowledgeUse = { projectId: string };

/**
 * How agents used the project's knowledge in the last 90 days, file by
 * file, and which of the files the document lists no run used lately. The
 * listed files come first, then the clock, then the log. The files come
 * back too: the review lists the unused ones.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const readKnowledgeUse =
	(ports: ReadKnowledgeUsePorts) =>
	async ({
		projectId,
	}: ReadKnowledgeUse): Promise<{
		files: KnowledgeFile[];
		use: KnowledgeUseReport;
	}> => {
		const files = await ports.files.files(projectId);
		const now = ports.now();
		const rows = await ports.log.events(
			projectId,
			["KnowledgeSearched", "KnowledgeRead"],
			{ limit: USE_EVENTS, since: useSince(now) },
		);
		return { files, use: fileUseOf(rows, files, now) };
	};
