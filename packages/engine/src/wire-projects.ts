import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { FlowDocuments, SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import {
	createCloneImports,
	createFlowMigrations,
	createProjectFlows,
} from "./flows";
import { createWorktrees, systemGit } from "./git";
import type { RunLog } from "./log";
import { createProjects } from "./projects";

type ProjectsDeps = Parameters<typeof createProjects>[0];

/**
 * The projects and flows block of the engine's composition (`wire.ts`):
 * projects by remote and their Clones on this computer (`projects/`), the
 * flows and schedules of every project in its flow document (`flows/`),
 * what brings a flow of an older format to the current one, and the
 * import of a Clone's folder from before it. Phase 3 of the hexagon
 * series makes them slices.
 *
 * It gives `git` and `listBranches`, `projects`, `migrations`,
 * `projectFlows` and `cloneImports`.
 */
export function wireEngineProjects(deps: {
	db: Database;
	log: RunLog;
	documents: SpaceDocuments;
	flowDocuments: FlowDocuments;
	directory: DeviceDirectory;
	/** The relay to the Hosts, when this computer has one. */
	hosts: ProjectsDeps["relay"] | undefined;
	/** This Device's name. */
	deviceName: string;
	options: Pick<EngineOptions, "git" | "profiles">;
	now(): number;
}) {
	const { db, log: runLog, documents, flowDocuments, directory, now } = deps;
	const git = deps.options.git ?? systemGit();
	const { listBranches } = createWorktrees(git);
	const projects = createProjects({
		db,
		log: runLog,
		deviceId: runLog.walkerId,
		documents,
		directory,
		git,
		...(deps.hosts ? { relay: deps.hosts } : {}),
	});
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
	return {
		git,
		listBranches,
		projects,
		migrations,
		projectFlows,
		cloneImports,
	};
}
