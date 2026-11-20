import { Refusal } from "@nightshift/refusal";
import type { Clock, ProjectSpaces, ThisDevice } from "../../application/ports";
import {
	type InMemoryFlowStore,
	inMemoryFlowStore,
} from "./in-memory-flow-store";

/**
 * The in-memory adapters of the ports that another slice fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryStorePorts`, which
 * gives a use-case test every port of the slice at once. Test code:
 * production code never imports this file.
 */

/** The Projects of a test, by their Space. One that is not set is "not found". */
export type InMemoryProjectSpaces = ProjectSpaces & {
	set(projectId: string, spaceId: string): void;
	/** Every Project asked for, in order. */
	asked: string[];
};

export function inMemoryProjectSpaces(
	spaces: Record<string, string> = {},
): InMemoryProjectSpaces {
	const known = new Map(Object.entries(spaces));
	const projects: InMemoryProjectSpaces = {
		asked: [],
		set(projectId, spaceId) {
			known.set(projectId, spaceId);
		},
		async spaceOf(projectId) {
			projects.asked.push(projectId);
			const spaceId = known.get(projectId);
			if (spaceId === undefined) {
				throw new Refusal("not-found", "This project does not exist.");
			}
			return spaceId;
		},
	};
	return projects;
}

export function inMemoryThisDevice(id: string): ThisDevice {
	return { id: async () => id };
}

/** A clock a test sets. */
export type InMemoryClock = Clock & { set(at: number): void };

export function inMemoryClock(at: number): InMemoryClock {
	let now = at;
	return Object.assign(() => now, {
		set(next: number) {
			now = next;
		},
	});
}

/** Every port of the slice: one Project `project` in the Space `space`, on the Device `laptop`, at 1000. */
export function inMemoryStorePorts(): {
	store: InMemoryFlowStore;
	projects: InMemoryProjectSpaces;
	device: ThisDevice;
	clock: InMemoryClock;
} {
	const store = inMemoryFlowStore();
	store.seed("project");
	return {
		store,
		projects: inMemoryProjectSpaces({ project: "space" }),
		device: inMemoryThisDevice("laptop"),
		clock: inMemoryClock(1000),
	};
}
