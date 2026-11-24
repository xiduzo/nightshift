import type { Permissions } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../access";
import type { Actor } from "../../contract";
import { STILL_RUNNING } from "../domain/move";
import { type MoveProjectsPorts, moveProjects } from "./move-projects";
import type { MoveHolds, MoveLog, ProjectLookup, ProjectRuns } from "./ports";

const MOVE_PROJECTS: Permissions = { project: ["move"] };

export type MoveProjectPorts = MoveProjectsPorts & {
	holds: MoveHolds;
	access: Pick<Access, "openSpace">;
	projectLookup: ProjectLookup;
	projectRuns: ProjectRuns;
	moveLog: MoveLog;
};

export type MoveProject = {
	spaceId: string;
	projectId: string;
	/** The Space the project goes to. */
	toSpaceId: string;
};

/**
 * A person moves a Project of a Space to another Space, with its runs,
 * as one Space move. Refuses a Person who may not move projects in both Spaces
 * (`access.openSpace`). A move to its own Space does nothing. A move while a run of the
 * project runs a step is refused under the hold, and so is a move into a
 * Space that a move out of it holds.
 */
export const moveProject =
	(ports: MoveProjectPorts) =>
	async (actor: Actor, request: MoveProject): Promise<void> => {
		const { spaceId, projectId, toSpaceId } = request;
		await ports.access.openSpace(actor, { spaceId, need: MOVE_PROJECTS });
		await ports.access.openSpace(actor, {
			spaceId: toSpaceId,
			need: MOVE_PROJECTS,
		});
		await ports.projectLookup.find(projectId, spaceId);
		if (toSpaceId === spaceId) return;
		await ports.projectLookup.refuseMove(projectId, spaceId, toSpaceId);
		const { moveStore, holds } = ports;
		await moveProjects({
			...ports,
			moveStore: {
				...moveStore,
				// Only the batch: two moves across wait for neither's holds.
				commit: (batches) =>
					holds.unlessHeld(toSpaceId, () => moveStore.commit(batches)),
			},
		})({
			from: spaceId,
			plan: async () => {
				const runIds = await ports.projectRuns.runIds(projectId);
				if (runIds.some((id) => ports.projectRuns.isActive(id))) {
					throw new Refusal("conflict", STILL_RUNNING);
				}
				return {
					projects: { [projectId]: { spaceId: toSpaceId, projectId } },
				};
			},
		});
		await ports.moveLog.projectMoved({
			projectId,
			from: spaceId,
			to: toSpaceId,
		});
	};
