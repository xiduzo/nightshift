import type { FlowMigration } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { UsageMoment } from "../../../../usage";
import type { FlowMergePlan, FlowMerges } from "../../../store";
import { inMemoryFlows } from "../../../store/adapters/out/in-memory-flows";
import type {
	Clock,
	FlowUsage,
	ImportMigrations,
	SpaceProjects,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another slice or package fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryTransferPorts`,
 * which gives a use-case test every port at once. Test code: production
 * code never imports this file.
 */

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

/** The migration that names nothing: each node keeps its names, to pick again. */
export function nameless(deviceId: string): FlowMigration {
	return {
		deviceId,
		deviceIdByName: () => null,
		profileIdByName: () => null,
	};
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
 * `other` in the Space `space`, at 1000. `ada` is a member of the Spaces
 * `space` and `elsewhere`.
 */
export function inMemoryTransferPorts() {
	const access = inMemoryAccess();
	access.members.join("space", "ada", "member");
	access.members.join("elsewhere", "ada", "member");
	const spaces = { project: "space", other: "space" };
	return {
		access,
		clock: inMemoryClock(1000),
		importMigrations: inMemoryImportMigrations(),
		projects: inMemorySpaceProjects(spaces),
		flows: inMemoryFlows(spaces),
		usage: inMemoryFlowUsage(),
		merges: inMemoryDocumentMerges(),
	};
}
