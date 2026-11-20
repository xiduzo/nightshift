import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { FlowDocuments, SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import {
	createCloneImports,
	createFlowMigrations,
	createSpaceFlows,
	type ProjectFlows,
	wireEditing,
	wireStore,
} from "./flows";
import type { Git } from "./git";
import type { RunLog } from "./log";
import { forgetMemory, listMemory } from "./memory";
import type { Projects } from "./projects";
import { namesOf } from "./read";
import { listKeptValues, resetKeptValue } from "./variables";

/**
 * The flows block of the engine's composition (`wire.ts`): the flows and
 * schedules of every project in its flow document (`flows/`), what brings
 * a flow of an older format to the current one, and the import of a
 * Clone's folder from before it. Phase 3 of the hexagon series makes
 * `flows` a slice. It comes after the projects block
 * (`wire-projects.ts`), whose `projects` and `git` it takes.
 *
 * It gives `migrations`, `projectFlows` and `cloneImports`.
 */
export function wireEngineFlows(deps: {
	db: Database;
	log: RunLog;
	documents: SpaceDocuments;
	flowDocuments: FlowDocuments;
	directory: DeviceDirectory;
	projects: Pick<Projects, "find">;
	git: Git;
	/** This Device's name. */
	deviceName: string;
	options: Pick<EngineOptions, "profiles">;
	now(): number;
}) {
	const {
		db,
		log: runLog,
		documents,
		flowDocuments,
		directory,
		projects,
		git,
		now,
	} = deps;
	/** What brings a flow or a schedule of an older format to the current one: its nodes name a Device's profile, and their Device, by id. */
	const thisDevice = async () => ({
		id: await runLog.walkerId(),
		name: deps.deviceName,
	});
	const migrations = createFlowMigrations({
		db,
		device: thisDevice,
		profiles: deps.options.profiles,
		directory,
		spaces: documents,
	});
	/** The flows and schedules of every project: its flow document (ADR 2). */
	const projectFlows = wireStore({
		documents: flowDocuments,
		project: (projectId) => projects.find(projectId),
		deviceId: () => runLog.walkerId(),
		now,
		migrations,
	});
	/** The import on upgrade: each Clone's `.nightshift/` folder, once. */
	const cloneImports = createCloneImports({
		db,
		documents: flowDocuments,
		git,
		device: thisDevice,
		profiles: deps.options.profiles,
		migrations,
		now,
	});
	return { migrations, projectFlows, cloneImports };
}

/**
 * The flows part of the Space view (`space.ts`): what a Person does with
 * the flows of a Space (`flows/editing/`, bound here once), and the
 * `SpaceFlows` of each Space over it. It comes after `ready`, which each
 * use case waits for before it checks the project's Space.
 *
 * It gives `flows` (the `SpaceFlows` of a Space for an actor) and
 * `editing` (the kept values and the node memory).
 */
export function wireEngineSpaceFlows(deps: {
	db: Database;
	log: RunLog;
	ready: Promise<unknown>;
	directory: DeviceDirectory;
	projects: Pick<Projects, "find">;
	projectFlows: ProjectFlows;
	migrations: ReturnType<typeof createFlowMigrations>;
	options: Pick<EngineOptions, "usage">;
}) {
	const { db, ready, projects, projectFlows } = deps;
	const project = async (projectId: string, spaceId: string) => {
		await projects.find(projectId, spaceId);
	};
	const usage = deps.options.usage;
	const editing = wireEditing({
		projects: {
			async inSpace(projectId, spaceId) {
				await ready;
				await project(projectId, spaceId);
			},
		},
		flows: projectFlows,
		names: {
			persons: (ids) => namesOf(db, ids),
			devices: (ids) => deps.directory.names(ids),
		},
		...(usage ? { usage } : {}),
		kept: {
			list: (flow) => listKeptValues(db, flow),
			reset: (flow, name) => resetKeptValue(db, flow, name),
		},
		memory: {
			list: (flow) => listMemory(db, flow),
			forget: (flow, node, scope) => forgetMemory(db, flow, node, scope),
		},
	});
	const flows = createSpaceFlows({
		ready,
		flows: projectFlows,
		editing,
		...(usage ? { usage } : {}),
		project,
		migration: async (scope) =>
			deps.migrations.forDevice(await deps.log.walkerId(), scope),
	});
	return { flows, editing };
}
