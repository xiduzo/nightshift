import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../contract";
import { STILL_RUNNING } from "../domain/move";
import { type MoveProjectsPorts, moveProjects } from "./move-projects";
import type { MoveLog, ProjectLookup, ProjectRuns } from "./ports";

export type MoveProjectPorts = MoveProjectsPorts & {
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
 * as one Space move. The door checks the person's role in both Spaces
 * first. A move to its own Space does nothing. A move while a run of the
 * project runs a step is refused under the hold.
 */
export const moveProject =
	(ports: MoveProjectPorts) =>
	async (_actor: Actor, request: MoveProject): Promise<void> => {
		const { spaceId, projectId, toSpaceId } = request;
		await ports.projectLookup.find(projectId, spaceId);
		if (toSpaceId === spaceId) return;
		await ports.projectLookup.refuseMove(projectId, spaceId, toSpaceId);
		await moveProjects(ports)({
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
