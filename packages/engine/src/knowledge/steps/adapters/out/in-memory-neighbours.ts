import type {
	StepBrief,
	StepFiles,
	StepFolders,
	StepHolds,
	StepLearnings,
	StepPageReaders,
	StepReader,
	StepSearch,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryStepsPorts`, which gives a use-case test every port of
 * the slice at once. Each twin writes what it is asked into one shared
 * list, `events`, so a test sees the order. Test code: production code
 * never imports this file.
 */

type Snapshot = Awaited<ReturnType<StepFolders["scan"]>>;

/** A look at a folder with these readable paths, all changed at 1. */
function snapshotOf(dir: string, paths: readonly string[]): Snapshot {
	const files = paths.map((path) => ({
		path,
		mtimeMs: 1,
	})) as unknown as Snapshot["files"];
	return {
		dir,
		files,
		readable: files,
		newestReadable: files.length ? 1 : 0,
		file: (path) => files.find((file) => file.path === path),
		changedSince: () => {
			throw new Error("The twin of a look tells no changes.");
		},
		sha256: async () => null,
	};
}

/** The folders of the projects: `/k/<projectId>`, with the paths in `files`. */
export function inMemoryStepFolders(events: string[]) {
	const twin = {
		/** The readable paths of each project's folder. */
		files: new Map<string, string[]>(),
		/** Projects whose folder cannot be made. */
		unmade: new Set<string>(),
		/** Projects whose folder cannot be read. */
		unread: new Set<string>(),
		folder: (projectId: string) => `/k/${projectId}`,
		async ensure(projectId: string) {
			events.push(`ensure ${projectId}`);
			if (twin.unmade.has(projectId)) throw new Error("no folder");
			return `/k/${projectId}`;
		},
		async scan(projectId: string) {
			events.push(`scan ${projectId}`);
			if (twin.unread.has(projectId)) throw new Error("no look");
			return snapshotOf(`/k/${projectId}`, twin.files.get(projectId) ?? []);
		},
	};
	return twin satisfies StepFolders;
}

/** The holds of the folders: each start and end, in order. */
export function inMemoryStepHolds(events: string[]) {
	return {
		async startStep(projectId: string) {
			events.push(`hold ${projectId}`);
			return {
				done: async () => {
					events.push(`done ${projectId}`);
				},
			};
		},
	} satisfies StepHolds;
}

/** The index and the views: each write and each view, in order. */
export function inMemoryStepFiles(events: string[]) {
	const twin = {
		/** When set, the next view fails with it. */
		failView: null as Error | null,
		async writeIndex(snapshot: { dir: string }) {
			events.push(`index ${snapshot.dir}`);
		},
		async openView(source: string, _files: unknown, only: readonly string[]) {
			events.push(`view ${source} ${only.join(",")}`);
			if (twin.failView) throw twin.failView;
			return {
				path: `${source}.view`,
				remove: async () => {
					events.push(`remove ${source}.view`);
				},
			};
		},
	};
	return twin satisfies StepFiles;
}

/** The read of one file: each path asked. */
export function inMemoryStepReader(events: string[]) {
	return {
		async read(projectId: string, path: string) {
			events.push(`read ${projectId} ${path}`);
			return null;
		},
	} satisfies StepReader;
}

/** The search: each search and each refresh. */
export function inMemoryStepSearch(events: string[]) {
	return {
		async search(projectId: string) {
			events.push(`search ${projectId}`);
			return [];
		},
		async refresh(projectId: string) {
			events.push(`refresh ${projectId}`);
			return { files: 0, indexed: 0, removed: 0 };
		},
	} satisfies StepSearch;
}

/** The learnings of a session's reports: the events pass as they are, each step noted. */
export function inMemoryStepLearnings(events: string[]) {
	return {
		async *keepReported(
			given: AsyncIterable<never>,
			projectId: string,
			step: { runId: string; stepId?: string },
		) {
			events.push(`keep ${projectId} ${step.runId} ${step.stepId ?? "-"}`);
			yield* given;
		},
	} satisfies StepLearnings;
}

/** The page readers: a reader per step, or a failure to open one. */
export function inMemoryStepPageReaders(events: string[]) {
	const twin = {
		/** When set, the next reader fails with it. */
		failOpen: null as Error | null,
		async forStep(projectId: string) {
			events.push(`reader ${projectId}`);
			if (twin.failOpen) throw twin.failOpen;
			return {
				env: { NS_READER_URL: `http://reader/${projectId}` },
				close: async () => {
					events.push(`close reader ${projectId}`);
				},
			};
		},
	};
	return twin satisfies StepPageReaders;
}

/** The brief of `@nightshift/agents`, plain: the folder and what each session was told. */
export function inMemoryStepBrief() {
	const twin = {
		/** What each session brief was made of. */
		sessions: [] as Parameters<StepBrief["session"]>[0][],
		env: (folder: string) => ({ NS_KNOWLEDGE: folder }),
		session(input: Parameters<StepBrief["session"]>[0]) {
			twin.sessions.push(input);
			return { env: { NS_KNOWLEDGE: input.folder }, addDirs: [input.folder] };
		},
	};
	return twin satisfies StepBrief;
}

/** Every port of knowledge/steps in memory at once: where each use-case test starts. */
export function inMemoryStepsPorts() {
	const events: string[] = [];
	return {
		events,
		holds: inMemoryStepHolds(events),
		folders: inMemoryStepFolders(events),
		files: inMemoryStepFiles(events),
		reader: inMemoryStepReader(events),
		search: inMemoryStepSearch(events),
		learnings: inMemoryStepLearnings(events),
		readers: inMemoryStepPageReaders(events),
		brief: inMemoryStepBrief(),
	};
}
