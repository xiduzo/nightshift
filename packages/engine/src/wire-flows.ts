import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { FlowDocuments, SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import {
	createCloneImports,
	createFlowMigrations,
	createProjectFlows,
} from "./flows";
import type { Git } from "./git";
import type { RunLog } from "./log";
import type { Projects } from "./projects";

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
	const projectFlows = createProjectFlows({
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
