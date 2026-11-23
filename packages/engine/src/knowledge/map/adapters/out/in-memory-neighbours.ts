import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../../contract";
import type {
	AskedQuestions,
	FolderHolds,
	MapAccess,
	MapEntries,
	MapIndex,
	MapLearnings,
} from "../../application/ports";
import type { MapLearning, MapQuestion } from "../../domain/map";
import { createMapMemo } from "../../domain/memo";
import { inMemoryNotTopicsFile } from "./in-memory-not-topics-file";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryMapPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The files each project's document lists, by path. */
export function inMemoryMapEntries() {
	const twin = {
		listed: new Map<string, string[]>(),
		async open(projectId: string) {
			const paths = twin.listed.get(projectId) ?? [];
			return { entries: () => new Map(paths.map((path) => [path, {}])) };
		},
	};
	return twin satisfies MapEntries;
}

type IndexForMap = Awaited<ReturnType<MapIndex["forMap"]>>;

/** The search index in memory: a stamp, and what it holds for the Map. */
export function inMemoryMapIndex() {
	const twin = {
		stamp: "stamp-1",
		held: {
			files: [],
			read: [],
			filesLeftOut: 0,
			vectors: [],
			closeAt: null,
		} as IndexForMap,
		/** How often the Map read what the index holds. */
		reads: 0,
		async mapStamp() {
			return twin.stamp;
		},
		async forMap() {
			twin.reads++;
			return twin.held;
		},
	};
	return twin satisfies MapIndex;
}

/** The learnings that wait, by project. */
export function inMemoryMapLearnings() {
	const twin = {
		waitingIn: new Map<string, MapLearning[]>(),
		asked: [] as { projectId: string; onlyHere: boolean }[],
		async waiting(projectId: string, options: { onlyHere: boolean }) {
			twin.asked.push({ projectId, onlyHere: options.onlyHere });
			return twin.waitingIn.get(projectId) ?? [];
		},
	};
	return twin satisfies MapLearnings;
}

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

/** Every port of knowledge/map in memory at once: where each use-case test starts. */
export function inMemoryMapPorts() {
	let clock = 1_000;
	return {
		access: inMemoryMapAccess(),
		entries: inMemoryMapEntries(),
		index: inMemoryMapIndex(),
		asked: inMemoryAskedQuestions(),
		learnings: inMemoryMapLearnings(),
		notTopics: inMemoryNotTopicsFile(),
		holds: inMemoryFolderHolds(),
		memo: createMapMemo(),
		now: () => clock,
		/** Sets the clock of `now`. */
		setNow(at: number) {
			clock = at;
		},
	};
}

export type InMemoryMapAccess = MapAccess & {
	opened: { actor: Actor; spaceId: string; need?: Permissions }[];
	refuse(error: unknown): void;
};

export function inMemoryMapAccess(): InMemoryMapAccess {
	let refusal: { error: unknown } | null = null;
	const access: InMemoryMapAccess = {
		opened: [],
		refuse: (error) => {
			refusal = { error };
		},
		async openSpace(actor, request) {
			access.opened.push({ actor, ...request });
			if (refusal && "personId" in actor) throw refusal.error;
		},
	};
	return access;
}
