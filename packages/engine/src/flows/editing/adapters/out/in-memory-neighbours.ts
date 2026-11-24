import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { MemoryFlow, NodeMemory as Remembered } from "../../../../memory";
import type { UsageMoment } from "../../../../usage";
import type { KeptFlow, KeptValue } from "../../../../variables";
import {
	type InMemoryFlowStore,
	inMemoryFlowStore,
} from "../../../store/adapters/out/in-memory-flow-store";
import type {
	FlowUsage,
	KeptValues,
	Names,
	NodeMemory,
	SavedFlows,
	SpaceProjects,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another slice fills (every
 * port of `application/ports.ts`), and `inMemoryEditingPorts`, which
 * gives a use-case test every port at once. Test code: production code
 * never imports this file.
 */

/** The projects of a test, by their Space. One of another Space is "not found". */
export type InMemorySpaceProjects = SpaceProjects & {
	/** Every check, in order. */
	checked: { projectId: string; spaceId: string }[];
};

export function inMemorySpaceProjects(
	spaces: Record<string, string>,
): InMemorySpaceProjects {
	const projects: InMemorySpaceProjects = {
		checked: [],
		async inSpace(projectId, spaceId) {
			projects.checked.push({ projectId, spaceId });
			if (spaces[projectId] !== spaceId) {
				throw new Refusal("not-found", "This project does not exist.");
			}
		},
	};
	return projects;
}

/** The saved flows over the in-memory `FlowStore`, on the Device `laptop` at 1000. A save finds no issue. */
export type InMemorySavedFlows = SavedFlows & {
	store: InMemoryFlowStore;
	/** Every save, in order. */
	saves: {
		projectId: string;
		name: string;
		flow: Flow;
		kind: string | undefined;
		personId: string | undefined;
	}[];
};

export function inMemorySavedFlows(): InMemorySavedFlows {
	const store = inMemoryFlowStore();
	const here = { deviceId: "laptop", spaceId: undefined };
	const flows: InMemorySavedFlows = {
		store,
		saves: [],
		flows: (projectId) => store.read(projectId, here),
		async save(projectId, name, flow, options = {}) {
			flows.saves.push({
				projectId,
				name,
				flow,
				kind: options.kind,
				personId: options.personId,
			});
			await store.save(projectId, {
				name,
				flow,
				kind: options.kind ?? "save",
				personId: options.personId ?? null,
				deviceId: "laptop",
				at: 1000,
			});
			return [];
		},
		remove: (projectId, name) => store.remove(projectId, name),
		revisions: (projectId, name) => store.revisions(projectId, name, undefined),
		notices: (projectId) => store.notices(projectId),
		dismissNotice: (projectId, noticeId) =>
			store.dismissNotice(projectId, noticeId),
	};
	return flows;
}

export function inMemoryNames(
	persons: Record<string, string> = {},
	devices: Record<string, string> = {},
): Names {
	const pick = (names: Record<string, string>, ids: readonly string[]) =>
		new Map(ids.flatMap((id) => (names[id] ? [[id, names[id]] as const] : [])));
	return {
		persons: async (ids) => pick(persons, ids),
		devices: async (ids) => pick(devices, ids),
	};
}

/** The kept values of a test, with every reset. */
export type InMemoryKeptValues = KeptValues & {
	values: KeptValue[];
	resets: { flow: KeptFlow; name: string }[];
};

export function inMemoryKeptValues(
	values: KeptValue[] = [],
): InMemoryKeptValues {
	const kept: InMemoryKeptValues = {
		values,
		resets: [],
		list: async () => [...kept.values],
		async reset(flow, name) {
			kept.resets.push({ flow, name });
		},
	};
	return kept;
}

/** What the nodes of a test remember, with every forget. */
export type InMemoryNodeMemory = NodeMemory & {
	remembered: Remembered[];
	forgets: { flow: MemoryFlow; node: string; scope?: string }[];
};

export function inMemoryNodeMemory(
	remembered: Remembered[] = [],
): InMemoryNodeMemory {
	const memory: InMemoryNodeMemory = {
		remembered,
		forgets: [],
		list: async () => [...memory.remembered],
		async forget(flow, node, scope) {
			memory.forgets.push({
				flow,
				node,
				...(scope !== undefined ? { scope } : {}),
			});
		},
	};
	return memory;
}

/** The usage notes of a test. */
export type InMemoryFlowUsage = FlowUsage & { notes: UsageMoment[] };

export function inMemoryFlowUsage(): InMemoryFlowUsage {
	const usage: InMemoryFlowUsage = {
		notes: [],
		note(moment) {
			usage.notes.push(moment);
		},
	};
	return usage;
}

/** Every port: the projects `project` and `other` in the Space `space`, `elsewhere` in another Space. */

/** Every port in memory at once. `ada` is a member of the Spaces `space` and `elsewhere`. */
export function inMemoryEditingPorts() {
	const access = inMemoryAccess();
	access.members.join("space", "ada", "member");
	access.members.join("elsewhere", "ada", "member");
	return {
		access,
		projects: inMemorySpaceProjects({
			project: "space",
			other: "space",
			elsewhere: "another-space",
		}),
		flows: inMemorySavedFlows(),
		names: inMemoryNames({ ada: "Ada" }, { laptop: "Laptop" }),
		usage: inMemoryFlowUsage(),
		kept: inMemoryKeptValues(),
		memory: inMemoryNodeMemory(),
	};
}
