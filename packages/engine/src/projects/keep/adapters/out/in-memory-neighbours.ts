import { Refusal } from "@nightshift/refusal";
import type { RowBatch } from "../../../../contract";
import type { Branches } from "../../../../git";
import type {
	NewIds,
	ProjectDirectory,
	ProjectLog,
	Repos,
	ThisDevice,
} from "../../application/ports";
import {
	type InMemoryProjectStore,
	inMemoryProjectStore,
	projectRecords,
} from "./in-memory-project-store";
import { inMemorySpaceProjects } from "./in-memory-space-projects";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryKeepPorts`, which
 * gives a use-case test every shared port of the Projects at once. Test
 * code: production code never imports this file.
 */

/** This computer, as the twins name it. */
export const HERE = "this-computer";

/** The log of the Project facts: each fact in order, and its batch runs on the store. */
export function inMemoryProjectLog(store: Pick<InMemoryProjectStore, "apply">) {
	const facts: Parameters<ProjectLog["append"]>[0][] = [];
	const log = {
		facts,
		async append(fact: Parameters<ProjectLog["append"]>[0], before?: RowBatch) {
			if (before) store.apply(before);
			facts.push(fact);
		},
	};
	return log satisfies ProjectLog;
}

/** git on this computer: each folder a test makes, with its top folder and `origin`. */
export function inMemoryRepos() {
	const repos = new Map<
		string,
		{ top: string; origin: string | null; branches: Branches }
	>();
	const folders = new Set<string>();
	const twin = {
		/** A repository at `path` (its top folder), with its `origin` URL. */
		add(path: string, origin: string | null = null, top = path) {
			repos.set(path, {
				top,
				origin,
				branches: { current: "main", local: ["main"], remote: [] },
			});
			folders.add(top);
		},
		/** The folder is gone from the disk. */
		remove(path: string) {
			folders.delete(path);
		},
		async topLevel(path: string) {
			const repo = repos.get(path);
			if (!repo)
				throw new Refusal("invalid", `${path} is not a git repository.`);
			return repo.top;
		},
		async origin(path: string) {
			return [...repos.values()].find((r) => r.top === path)?.origin ?? null;
		},
		async branches(path: string) {
			const repo = [...repos.values()].find((r) => r.top === path);
			return repo?.branches ?? { current: null, local: [], remote: [] };
		},
		exists: (path: string) => folders.has(path),
	};
	return twin satisfies Repos;
}

/** The names of the Devices, and the Spaces a Host keeps. */
export function inMemoryProjectDirectory() {
	const names = new Map<string, string>();
	const hosted = new Set<string>();
	const twin = {
		name(deviceId: string, name: string) {
			names.set(deviceId, name);
		},
		hostElsewhere(spaceId: string) {
			hosted.add(spaceId);
		},
		async names(ids: readonly string[]) {
			return new Map(
				ids.flatMap((id) => {
					const name = names.get(id);
					return name === undefined ? [] : [[id, name] as const];
				}),
			);
		},
		async hostedElsewhere(spaceId: string) {
			return hosted.has(spaceId);
		},
	};
	return twin satisfies ProjectDirectory;
}

/** New ids: `project-1`, `project-2`, and so on. */
export function inMemoryIds() {
	let next = 0;
	return { projectId: () => `project-${++next}` } satisfies NewIds;
}

/** Every shared port of the Projects in memory at once: where each use-case test starts. */
export function inMemoryKeepPorts() {
	const store = inMemoryProjectStore(projectRecords(HERE));
	return {
		store,
		spaceProjects: inMemorySpaceProjects(undefined, (spaceId, id, entry) =>
			store.project(spaceId, id, entry),
		),
		projectLog: inMemoryProjectLog(store),
		thisDevice: { deviceId: async () => HERE } satisfies ThisDevice,
		repos: inMemoryRepos(),
		directory: inMemoryProjectDirectory(),
		ids: inMemoryIds(),
	};
}
