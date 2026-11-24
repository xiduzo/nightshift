import { Refusal } from "@nightshift/refusal";
import type { RowBatch } from "../../../../contract";
import type { Branches } from "../../../../git";
import type {
	NewIds,
	ProjectDirectory,
	ProjectLog,
	Repos,
	SpaceHolds,
	ThisDevice,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`). Test code: production code never
 * imports this file.
 */

/** This computer, as the twins name it. */
export const HERE = "this-computer";

/** The log of the Project facts: each fact in order, after `run` ran its batch. */
export function inMemoryProjectLog(run: (batch: RowBatch) => Promise<void>) {
	const facts: Parameters<ProjectLog["append"]>[0][] = [];
	const log = {
		facts,
		async append(fact: Parameters<ProjectLog["append"]>[0], before?: RowBatch) {
			if (before) await run(before);
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

/** The Spaces a move holds, as a test says. */
export function inMemorySpaceHolds() {
	const held = new Set<string>();
	const twin = {
		held,
		async unlessHeld<T>(spaceId: string, work: () => Promise<T>): Promise<T> {
			if (held.has(spaceId)) throw new Refusal("unavailable", "held");
			return work();
		},
	};
	return twin satisfies SpaceHolds;
}

/** This computer. */
export function inMemoryThisDevice() {
	return { deviceId: async () => HERE } satisfies ThisDevice;
}

/** New ids: `project-1`, `project-2`, and so on. */
export function inMemoryIds() {
	let next = 0;
	return { projectId: () => `project-${++next}` } satisfies NewIds;
}
