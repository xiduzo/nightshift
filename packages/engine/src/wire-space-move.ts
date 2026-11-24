import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { SpaceDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import type { ProjectFlows } from "./flows";
import type { Runner } from "./graph";
import { type RunLog, runIdsOfProject } from "./log";
import type { Projects } from "./projects";
import type { StartHolds } from "./runs";
import { wireSpaceMove } from "./space-move";

/**
 * The Space-move block of the engine's composition (`wire.ts`): Projects
 * that go from one Space to others, as one operation (`space-move/`). Lane
 * SM of the hexagon series owns this file.
 *
 * It gives `moveProjects` and `forgetSpace` (the engine) and `moveProject`
 * (the Space view).
 */
export function wireEngineSpaceMove(deps: {
	db: Database;
	documents: Pick<SpaceDocuments, "open" | "remove">;
	startHolds: Pick<StartHolds, "hold" | "start">;
	/** Holds every schedule of this computer: resolves with the release. */
	holdSchedules(): Promise<() => void>;
	log: Pick<RunLog, "walkerId" | "forget" | "append">;
	/** The landed feed reads the moved runs again. */
	landed: { reread(): void };
	flows: Pick<ProjectFlows, "schedules" | "saveSchedules">;
	projects: Pick<Projects, "find" | "refuseMove">;
	runner: Pick<Runner, "isActive">;
	options: Pick<EngineOptions, "moveRows" | "projectsMoved">;
	access: Pick<Access, "openSpace">;
}) {
	const { db, log, options } = deps;
	return wireSpaceMove({
		db,
		access: deps.access,
		documents: deps.documents,
		holds: {
			holdStarts: (spaceId) => deps.startHolds.hold(spaceId),
			unlessHeld: (spaceId, work) => deps.startHolds.start(spaceId, work),
			holdSchedules: () => deps.holdSchedules(),
		},
		walker: { walkerId: () => log.walkerId() },
		movedSchedules: deps.flows,
		moveRows: options.moveRows ?? [],
		// Their rows moved under the run log, in a batch that logged nothing.
		reread: {
			reread: (runIds) => {
				log.forget(runIds);
				deps.landed.reread();
			},
		},
		projectsMoved: options.projectsMoved
			? { moved: options.projectsMoved }
			: {},
		projectLookup: deps.projects,
		projectRuns: {
			runIds: (projectId) => runIdsOfProject(db, projectId),
			isActive: (runId) => deps.runner.isActive(runId),
		},
		moveLog: {
			projectMoved: async (payload) => {
				await log.append({ type: "ProjectMoved", payload });
			},
		},
	});
}
