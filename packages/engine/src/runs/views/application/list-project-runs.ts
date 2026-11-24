import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectRuns } from "../../../read";
import type { RunViews } from "./ports";

export type ListProjectRunsPorts = {
	views: Pick<RunViews, "projectRuns">;
	openSpace: Access["openSpace"];
};

/** The Space, and the reader's clock for the day ranges. Default: now, in UTC. */
export type ListProjectRuns = {
	spaceId: string;
	read?: { now: number; timeZone: string };
};

/**
 * How the runs of each project of a Space stand, by project id, for the
 * actor: a Space the Person is not a Member of is not found.
 */
export const listProjectRuns =
	(ports: ListProjectRunsPorts) =>
	async (
		actor: Actor,
		request: ListProjectRuns,
	): Promise<Map<string, ProjectRuns>> => {
		await ports.openSpace(actor, { spaceId: request.spaceId });
		return ports.views.projectRuns(request.spaceId, request.read);
	};
