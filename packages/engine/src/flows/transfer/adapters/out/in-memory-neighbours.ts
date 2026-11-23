import type { Permissions } from "@nightshift/auth";
import type {
	Flow,
	FlowMigration,
	FlowSources,
	Profile,
	Schedule,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../../contract";
import type { ProfileView } from "../../../../device-config";
import type { UsageMoment } from "../../../../usage";
import type { FlowMergePlan } from "../../../store";
import type {
	Clock,
	CloneDocuments,
	DeviceProfiles,
	DocumentMerges,
	FlowTransferAccess,
	FlowUsage,
	ImportMigrations,
	Migrations,
	SavedDocuments,
	SavedFlows,
	SpaceProjects,
	ThisDevice,
} from "../../application/ports";
import { createImportRuns } from "../../domain/import-runs";
import { inMemoryCloneFolders } from "./in-memory-clone-folders";
import { inMemoryClonesHere } from "./in-memory-clones-here";

/**
 * The in-memory adapters of the ports that another slice or package fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryTransferPorts`,
 * which gives a use-case test every port at once. Test code: production
 * code never imports this file.
 */

type ImportDocument = Awaited<ReturnType<CloneDocuments["open"]>>;

/** One flow document in memory, as the import of a Clone's folder sees it. */
export type InMemoryImportDocument = ImportDocument & {
	meta: Map<string, number>;
	stored: FlowSources;
	scheduleList: Schedule[];
	notices: { kind: string; message: string; deviceId: string; at: number }[];
	/** Every write, in order: one entry per change of the document. */
	writes: string[];
};

export type InMemoryCloneDocuments = CloneDocuments & {
	document(projectId: string): InMemoryImportDocument;
	/** Every Project opened, in order. */
	opened: string[];
};

export function inMemoryCloneDocuments(): InMemoryCloneDocuments {
	const documents = new Map<string, InMemoryImportDocument>();
	const documentOf = (projectId: string): InMemoryImportDocument => {
		const found = documents.get(projectId);
		if (found) return found;
		const made: InMemoryImportDocument = {
			meta: new Map(),
			stored: {},
			scheduleList: [],
			notices: [],
			writes: [],
			marked: (marker) => made.meta.has(marker),
			async mark(marker, at, notices = []) {
				made.writes.push(`mark ${marker}`);
				made.notices.push(...notices);
				made.meta.set(marker, at);
			},
			async addNotices(notices) {
				made.writes.push("notices");
				made.notices.push(...notices);
			},
			flows: () => made.stored,
			schedules: () => made.scheduleList,
			async saveFlow(save) {
				made.writes.push(`flow ${save.name}`);
				made.stored = {
					...made.stored,
					[save.name]: { json: save.flow, revision: save.kind },
				};
			},
			async saveSchedules(schedules) {
				made.writes.push("schedules");
				made.scheduleList = [...schedules];
			},
		};
		documents.set(projectId, made);
		return made;
	};
	const imports: InMemoryCloneDocuments = {
		opened: [],
		document: documentOf,
		async open(projectId) {
			imports.opened.push(projectId);
			return documentOf(projectId);
		},
	};
	return imports;
}

/** The merges of a test: each call, and the plan every call gives back. */
export type InMemoryDocumentMerges = DocumentMerges & {
	plan: FlowMergePlan;
	calls: { verb: string; source: string; destination: string; with: unknown }[];
};

export function inMemoryDocumentMerges(): InMemoryDocumentMerges {
	const merges: InMemoryDocumentMerges = {
		plan: { flows: {}, schedules: {} },
		calls: [],
		async planMerge(source, destination, persons) {
			merges.calls.push({ verb: "plan", source, destination, with: persons });
			return merges.plan;
		},
		async merge(source, destination, merge) {
			merges.calls.push({ verb: "merge", source, destination, with: merge });
			return merges.plan;
		},
	};
	return merges;
}

export type InMemorySavedDocuments = SavedDocuments & {
	flushes: number;
	/** From now on `flush` throws this. */
	fail(error: unknown): void;
};

export function inMemorySavedDocuments(): InMemorySavedDocuments {
	let failure: { error: unknown } | null = null;
	const saved: InMemorySavedDocuments = {
		flushes: 0,
		fail(error) {
			failure = { error };
		},
		async flush() {
			if (failure) throw failure.error;
			saved.flushes += 1;
		},
	};
	return saved;
}

/** This Device's profiles in memory. A profile saved without an id gets `profile-<n>`. */
export type InMemoryDeviceProfiles = DeviceProfiles & {
	profiles: ProfileView[];
};

export function inMemoryDeviceProfiles(): InMemoryDeviceProfiles {
	let counter = 0;
	const store: InMemoryDeviceProfiles = {
		profiles: [],
		list: () => store.profiles,
		async save(input: Profile, id?: string) {
			const view: ProfileView = {
				...input,
				id: id ?? `profile-${++counter}`,
				updatedAt: 1000,
			};
			store.profiles = [...store.profiles, view];
			return view;
		},
	};
	return store;
}

/** The migration that names nothing: each node keeps its names, to pick again. */
export function nameless(deviceId: string): FlowMigration {
	return {
		deviceId,
		deviceIdByName: () => null,
		profileIdByName: () => null,
	};
}

export type InMemoryMigrations = Migrations & {
	asked: { deviceId: string; spaceId: string | undefined }[];
};

export function inMemoryMigrations(): InMemoryMigrations {
	const migrations: InMemoryMigrations = {
		asked: [],
		async forDevice(deviceId, scope) {
			migrations.asked.push({ deviceId, spaceId: scope?.spaceId });
			return nameless(deviceId);
		},
	};
	return migrations;
}

export type InMemoryImportMigrations = ImportMigrations & {
	asked: { spaceId: string; personId: string | null }[];
};

export function inMemoryImportMigrations(): InMemoryImportMigrations {
	const migrations: InMemoryImportMigrations = {
		asked: [],
		async forScope(scope) {
			migrations.asked.push(scope);
			return nameless("laptop");
		},
	};
	return migrations;
}

export function inMemoryThisDevice(id: string, name: string): ThisDevice {
	return { device: async () => ({ id, name }) };
}

export function inMemoryClock(at: number): Clock {
	return () => at;
}

/** The projects of a test, by their Space. One of another Space is "not found". */
export type InMemorySpaceProjects = SpaceProjects & {
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

/** The saved flows of each project, as stored. A save finds no issue. */
export type InMemorySavedFlows = SavedFlows & {
	stored: Map<string, FlowSources>;
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
	const flows: InMemorySavedFlows = {
		stored: new Map(),
		saves: [],
		flows: async (projectId) => flows.stored.get(projectId) ?? {},
		async save(projectId, name, flow, options = {}) {
			flows.saves.push({
				projectId,
				name,
				flow,
				kind: options.kind,
				personId: options.personId,
			});
			flows.stored.set(projectId, {
				...(flows.stored.get(projectId) ?? {}),
				[name]: { json: flow, revision: options.kind ?? "save" },
			});
			return [];
		},
	};
	return flows;
}

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

/**
 * Every port of `flows/transfer` at once: the projects `project` and
 * `other` in the Space `space`, the Device `laptop` named `MacBook`, at
 * 1000.
 */

export type InMemoryFlowTransferAccess = FlowTransferAccess & {
	opened: { actor: Actor; spaceId: string; need?: Permissions }[];
	refuse(error: unknown): void;
};

export function inMemoryFlowTransferAccess(): InMemoryFlowTransferAccess {
	let refusal: { error: unknown } | null = null;
	const access: InMemoryFlowTransferAccess = {
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

export function inMemoryTransferPorts() {
	return {
		access: inMemoryFlowTransferAccess(),
		documents: inMemoryCloneDocuments(),
		folders: inMemoryCloneFolders(),
		saved: inMemorySavedDocuments(),
		device: inMemoryThisDevice("laptop", "MacBook"),
		clock: inMemoryClock(1000),
		profiles: inMemoryDeviceProfiles(),
		migrations: inMemoryMigrations(),
		importMigrations: inMemoryImportMigrations(),
		clones: inMemoryClonesHere(),
		runs: createImportRuns(),
		projects: inMemorySpaceProjects({ project: "space", other: "space" }),
		flows: inMemorySavedFlows(),
		usage: inMemoryFlowUsage(),
		merges: inMemoryDocumentMerges(),
	};
}
