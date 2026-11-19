import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import { createWorktrees, systemGit } from "./git";
import type { RunLog } from "./log";
import { createProjects } from "./projects";

type ProjectsDeps = Parameters<typeof createProjects>[0];

/**
 * The projects block of the engine's composition (`wire.ts`): the git
 * port (`git/`), and projects by remote with their Clones on this
 * computer (`projects/`). Phase 3 of the hexagon series makes `projects`
 * a slice. The flows of the projects are the next block
 * (`wire-flows.ts`).
 *
 * It gives `git` and `listBranches`, and `projects`.
 */
export function wireEngineProjects(deps: {
	db: Database;
	log: RunLog;
	documents: SpaceDocuments;
	directory: DeviceDirectory;
	/** The relay to the Hosts, when this computer has one. */
	hosts: ProjectsDeps["relay"] | undefined;
	options: Pick<EngineOptions, "git">;
}) {
	const { db, log: runLog, documents, directory } = deps;
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
	return { git, listBranches, projects };
}
