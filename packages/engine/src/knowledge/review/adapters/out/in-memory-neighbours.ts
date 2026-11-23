import type { KnowledgeFile } from "../../../files";
import type { ProjectLearning } from "../../../learnings";
import type { KnowledgeSync } from "../../../sources";
import type {
	FolderHolds,
	ListedFiles,
	SourceSyncs,
	WaitingLearnings,
} from "../../application/ports";
import { inMemoryKnowledgeUseLog } from "./in-memory-knowledge-use-log";
import { inMemoryQuestionSetFile } from "./in-memory-question-set-file";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryReviewPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The holds of the folders: each start and end, in order. */
export function inMemoryFolderHolds() {
	const twin = {
		events: [] as string[],
		async startStep(projectId: string) {
			twin.events.push(`hold ${projectId}`);
			return {
				done: async () => {
					twin.events.push(`done ${projectId}`);
				},
			};
		},
	};
	return twin satisfies FolderHolds;
}

/** The files each project's document lists. */
export function inMemoryListedFiles() {
	const twin = {
		listed: new Map<string, KnowledgeFile[]>(),
		async files(projectId: string) {
			return twin.listed.get(projectId) ?? [];
		},
	};
	return twin satisfies ListedFiles;
}

/** The flows that fill each project's knowledge. */
export function inMemorySourceSyncs() {
	const twin = {
		syncsIn: new Map<string, KnowledgeSync[]>(),
		async syncs(_space: unknown, projectId: string) {
			return twin.syncsIn.get(projectId) ?? [];
		},
	};
	return twin satisfies SourceSyncs;
}

/** The learnings that wait in each project. */
export function inMemoryWaitingLearnings() {
	const twin = {
		waitingIn: new Map<string, ProjectLearning[]>(),
		async learnings(projectIds: readonly string[]) {
			return projectIds.flatMap((id) => twin.waitingIn.get(id) ?? []);
		},
	};
	return twin satisfies WaitingLearnings;
}

/** Every port of knowledge/review in memory at once: where each use-case test starts. */
export function inMemoryReviewPorts() {
	let clock = 1_000;
	return {
		log: inMemoryKnowledgeUseLog(),
		questions: inMemoryQuestionSetFile(),
		holds: inMemoryFolderHolds(),
		files: inMemoryListedFiles(),
		syncs: inMemorySourceSyncs(),
		learnings: inMemoryWaitingLearnings(),
		now: () => clock,
		/** Sets the clock of `now`. */
		setNow(at: number) {
			clock = at;
		},
	};
}
