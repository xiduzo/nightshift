import { inMemoryFiles } from "../../../files/adapters/out/in-memory-files";
import { inMemoryLearnings } from "../../../learnings/adapters/out/in-memory-learnings";
import type { PageReaders } from "../../../readers";
import { inMemorySearch } from "../../../search/adapters/out/in-memory-search";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import type { StepBrief } from "../../application/ports";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryStepsPorts`, which gives a use-case test every port of
 * the slice at once. What a step asks goes into one list, `events`, so a
 * test sees the order. Test code: production code
 * never imports this file.
 */

/** The page readers: a reader per step, or a failure to open one. */
function stepPageReaders(events: string[]) {
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
	return twin satisfies Pick<PageReaders, "forStep">;
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

/** Calls `name` of `part` as before, and notes the call first. */
function noted<
	Name extends string,
	Part extends Record<Name, (...args: never[]) => unknown>,
>(
	part: Part,
	name: Name,
	note: (...args: Parameters<Part[Name]>) => void,
): void {
	const call = part[name] as unknown as (...args: unknown[]) => unknown;
	Object.assign(part, {
		[name]: (...args: Parameters<Part[Name]>) => {
			note(...args);
			return call(...args);
		},
	});
}

/** Every port of knowledge/steps in memory at once, over the real sync, files, search and learnings: where each use-case test starts. */
export function inMemoryStepsPorts() {
	const sync = inMemorySync();
	const events = sync.holds;
	const files = inMemoryFiles(sync);
	const { folders, reader, views } = files;
	const search = inMemorySearch(sync, folders);
	const learnings = inMemoryLearnings(sync, search);
	noted(folders, "ensure", (projectId) => events.push(`ensure ${projectId}`));
	noted(folders, "scan", (projectId) => events.push(`scan ${projectId}`));
	noted(files, "writeIndex", ({ dir }) => events.push(`index ${dir}`));
	noted(files, "openView", (source, _all, only) =>
		events.push(`view ${source} ${only.join(",")}`),
	);
	noted(views, "remove", (view) => events.push(`remove ${view}`));
	noted(reader, "read", (projectId, path) =>
		events.push(`read ${projectId} ${path}`),
	);
	noted(search, "search", (projectId) => events.push(`search ${projectId}`));
	noted(search, "refresh", (projectId) => events.push(`refresh ${projectId}`));
	return {
		events,
		holds: sync.reconciler,
		folders,
		files,
		views,
		reader,
		search,
		learnings,
		readers: stepPageReaders(events),
		brief: inMemoryStepBrief(),
	};
}
