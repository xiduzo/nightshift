import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryLearnings } from "../../../learnings/adapters/out/in-memory-learnings";
import type { Sources, SourcesSpace } from "../../../sources";
import { inMemorySourcesPorts } from "../../../sources/adapters/out/in-memory-neighbours";
import { listFillingFlows } from "../../../sources/application/list-filling-flows";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import { inMemoryQuestionSetFile } from "./in-memory-question-set-file";

/**
 * `inMemoryReviewPorts`, the ports of the slice that are no database. Test
 * code: production code never imports this file.
 */

/** The ports of knowledge/review that are no database, over the real sync, files, learnings and sources. */
export function inMemoryReviewPorts() {
	let clock = 1_000;
	const now = () => clock;
	const sync = inMemorySync();
	const ports = inMemorySourcesPorts(sync);
	return {
		access: inMemoryAccess(),
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
