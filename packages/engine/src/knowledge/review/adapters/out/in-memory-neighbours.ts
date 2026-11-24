import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryLearnings } from "../../../learnings/adapters/out/in-memory-learnings";
import type { Sources, SourcesSpace } from "../../../sources";
import { inMemorySourcesPorts } from "../../../sources/adapters/out/in-memory-neighbours";
import { listFillingFlows } from "../../../sources/application/list-filling-flows";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import { inMemoryKnowledgeUseLog } from "./in-memory-knowledge-use-log";
import { inMemoryQuestionSetFile } from "./in-memory-question-set-file";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryReviewPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** Every port of knowledge/review in memory at once, over the real sync, files, learnings and sources: where each use-case test starts. */
export function inMemoryReviewPorts() {
	let clock = 1_000;
	const now = () => clock;
	const sync = inMemorySync();
	const ports = inMemorySourcesPorts(sync);
	return {
		access: inMemoryAccess(),
		log: inMemoryKnowledgeUseLog(),
		questions: inMemoryQuestionSetFile(),
		sync,
		holds: sync.reconciler,
		files: ports.files,
		/** The Space of the sources, as the person who asks sees it. */
		space: ports.space,
		sources: {
			sourcesIn: (space: SourcesSpace) => {
				const flows = listFillingFlows({ ...ports, space, now });
				return {
					syncs: async (projectId: string) =>
						(await flows({ projectId })).syncs,
				};
			},
		} as Pick<Sources, "sourcesIn">,
		learnings: inMemoryLearnings(sync),
		now,
		/** Sets the clock of `now`. */
		setNow(at: number) {
			clock = at;
		},
	};
}
