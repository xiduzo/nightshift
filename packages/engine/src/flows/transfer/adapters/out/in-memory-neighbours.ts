import type { FlowMigration, FlowSources, Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryProfiles } from "../../../../settings/profiles/adapters/out/in-memory-profiles";
import type { UsageMoment } from "../../../../usage";
import type { FlowMigrations } from "../../../migrations";
import type { FlowImports, FlowMergePlan, FlowMerges } from "../../../store";
import { inMemoryFlows } from "../../../store/adapters/out/in-memory-flows";
import type {
	Clock,
	FlowUsage,
	ImportMigrations,
	SavedDocuments,
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

type ImportDocument = Awaited<ReturnType<FlowImports["open"]>>;

/** One flow document in memory, as the import of a Clone's folder sees it. */
export type InMemoryImportDocument = ImportDocument & {
	meta: Map<string, number>;
	stored: FlowSources;
	scheduleList: Schedule[];
	notices: { kind: string; message: string; deviceId: string; at: number }[];
	/** Every write, in order: one entry per change of the document. */
	writes: string[];
};

export type InMemoryCloneDocuments = FlowImports & {
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
export type InMemoryDocumentMerges = FlowMerges & {
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

/** The migration that names nothing: each node keeps its names, to pick again. */
export function nameless(deviceId: string): FlowMigration {
	return {
		deviceId,
		deviceIdByName: () => null,
		profileIdByName: () => null,
	};
}

export type InMemoryMigrations = Pick<FlowMigrations, "forDevice"> & {
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

/** Every port in memory at once. `ada` is a member of the Spaces `space` and `elsewhere`. */
export function inMemoryTransferPorts() {
	const access = inMemoryAccess();
	access.members.join("space", "ada", "member");
	access.members.join("elsewhere", "ada", "member");
	const spaces = { project: "space", other: "space" };
	return {
		access,
		documents: inMemoryCloneDocuments(),
		folders: inMemoryCloneFolders(),
		saved: inMemorySavedDocuments(),
		device: inMemoryThisDevice("laptop", "MacBook"),
		clock: inMemoryClock(1000),
		profiles: inMemoryProfiles(),
		migrations: inMemoryMigrations(),
		importMigrations: inMemoryImportMigrations(),
		clones: inMemoryClonesHere(),
		runs: createImportRuns(),
		projects: inMemorySpaceProjects(spaces),
		flows: inMemoryFlows(spaces),
		usage: inMemoryFlowUsage(),
		merges: inMemoryDocumentMerges(),
	};
}
