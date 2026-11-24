import { inMemorySearch } from "../../../search/adapters/out/in-memory-search";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import { countWaitingNotes } from "../../application/count-waiting-notes";
import { keepReportedLearnings } from "../../application/keep-reported-learnings";
import { listProjectLearnings } from "../../application/list-project-learnings";
import { listWaitingLearnings } from "../../application/list-waiting-learnings";
import { proposeLearnings } from "../../application/propose-learnings";
import { inMemoryLearningsPorts } from "./in-memory-neighbours";

/**
 * The learnings over in-memory adapters: the real use cases, with the files
 * a test publishes in the sync. The use-case test of every slice that reads
 * the learnings takes this one. Test code: production code never imports
 * this file.
 */
export function inMemoryLearnings(
	sync = inMemorySync(),
	search = inMemorySearch(sync),
) {
	const ports = inMemoryLearningsPorts(sync, search);
	const waiting = listWaitingLearnings(ports);
	const ofProjects = listProjectLearnings({ waiting });
	const count = countWaitingNotes(ports);
	const keepReported = keepReportedLearnings({
		propose: proposeLearnings(ports),
	});
	const bound = { waiting, ofProjects, count, keepReported };
	return { ...ports, ...bound };
}
