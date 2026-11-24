import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryLearnings } from "../../../learnings/adapters/out/in-memory-learnings";
import { inMemorySearch } from "../../../search/adapters/out/in-memory-search";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import type { AskedQuestions } from "../../application/ports";
import type { MapQuestion } from "../../domain/map";
import { createMapMemo } from "../../domain/memo";
import { inMemoryNotTopicsFile } from "./in-memory-not-topics-file";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryMapPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The questions agents asked, by project. */
export function inMemoryAskedQuestions() {
	const twin = {
		askedIn: new Map<string, MapQuestion[]>(),
		async asked(projectId: string) {
			return twin.askedIn.get(projectId) ?? [];
		},
	};
	return twin satisfies AskedQuestions;
}

/** Every port of knowledge/map in memory at once, over the real sync, search and learnings: where each use-case test starts. */
export function inMemoryMapPorts() {
	let clock = 1_000;
	const sync = inMemorySync();
	const search = inMemorySearch(sync);
	return {
		access: inMemoryAccess(),
		sync,
		documents: sync.documents,
		index: search,
		asked: inMemoryAskedQuestions(),
		learnings: inMemoryLearnings(sync, search),
		notTopics: inMemoryNotTopicsFile(),
		holds: sync.reconciler,
		memo: createMapMemo(),
		now: () => clock,
		/** Sets the clock of `now`. */
		setNow(at: number) {
			clock = at;
		},
	};
}
