import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { wireSpaces as wireAuthSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { DeviceDirectory } from "./contract";
import type { SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import { createWorktrees, systemGit } from "./git";
import type { Runner } from "./graph";
import { type EventWrites, type RunLog, runIdsOfProject } from "./log";
import { type HostRelay, wireCatalog, wireClones, wireKeep } from "./projects";
import { wireSpaces } from "./spaces";

/**
 * The projects block of the engine's composition (`wire.ts`): the git
 * port (`git/`), the shared ports of the Projects (`projects/keep`), a
 * person's requests (`projects/catalog`), what Night Shift and the Host
 * ask (`projects/clones`, as `Projects`), and the policy of each Space
 * (`spaces/`). The flows of the projects are the next block
 * (`wire-flows.ts`).
 *
 * It gives `git`, `projects`, `catalog`, `cloneRows` (the peers' batch of
 * a Device's rows) and `spaces`.
 */
export function wireEngineProjects(deps: {
	db: Database;
	log: RunLog;
	documents: SpaceDocuments;
	directory: DeviceDirectory;
	/** The relay to the Hosts, when this computer has one. */
	hosts: HostRelay | undefined;
	options: Pick<EngineOptions, "git">;
	/** The runner, made after this block: whether a run runs a step here. */
	runner: () => Pick<Runner, "isActive">;
	/** Who may act in a Space (`access`). */
	access: Pick<Access, "openSpace">;
}) {
	const { db, log: runLog, documents, directory } = deps;
	const git = deps.options.git ?? systemGit();
	const { originUrl, resolveRepoTopLevel, listBranches } = createWorktrees(git);
	const thisDevice = { deviceId: () => runLog.walkerId() };
	const keep = wireKeep({ db, documents, thisDevice });
	const shared = {
		...keep,
		projectLog: {
			async append(fact: Parameters<RunLog["append"]>[0], before?: unknown) {
				await (before === undefined
					? runLog.append(fact)
					: runLog.append(fact, {
							before: before as EventWrites["before"],
						}));
			},
		},
		thisDevice,
		repos: {
			topLevel: resolveRepoTopLevel,
			origin: originUrl,
			branches: listBranches,
			exists: existsSync,
		},
		directory,
		ids: { projectId: () => randomUUID() },
	};
	const projects = wireClones({
		...shared,
		knownSpaces: {
			exists: (spaceId) => wireAuthSpaces({ db }).hasSpace({ spaceId }),
		},
	});
	const catalog = wireCatalog({
		...shared,
		access: deps.access,
		...(deps.hosts ? { relay: deps.hosts } : {}),
		runs: {
			runIds: (projectId) => runIdsOfProject(db, projectId),
			isActive: (runId) => deps.runner().isActive(runId),
			status: async (runId) => (await runLog.state(runId)).status,
		},
	});
	const cloneRows = {
		forget: keep.store.forgetClones,
		adopt: keep.store.adoptClones,
	};
	return {
		git,
		projects,
		catalog,
		cloneRows,
		spaces: wireSpaces({ documents, access: deps.access }),
	};
}
