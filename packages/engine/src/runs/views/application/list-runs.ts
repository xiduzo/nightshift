import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { RunPage, RunSummary } from "../../../read";
import type { PrivatePaths, RunViews } from "./ports";

export type ListRunsPorts = {
	views: Pick<RunViews, "listRuns">;
	paths: PrivatePaths;
	openSpace: Access["openSpace"];
};

/** The runs of one Space, of one project when it names one, a page at a time. */
export type ListRuns = { spaceId: string; projectId?: string } & RunPage;

/**
 * The runs of a Space as the actor may see them, newest first: a Space
 * the Person is not a Member of is not found. The worktree path of a run
 * on another Person's Device is hidden.
 */
export const listRuns =
	(ports: ListRunsPorts) =>
	async (actor: Actor, request: ListRuns): Promise<RunSummary[]> => {
		const { spaceId, projectId, limit, cursor, statuses, order } = request;
		await ports.openSpace(actor, { spaceId });
		const runs = await ports.views.listRuns(spaceId, projectId, {
			...(limit !== undefined ? { limit } : {}),
			...(cursor !== undefined ? { cursor } : {}),
			...(statuses !== undefined ? { statuses } : {}),
			...(order !== undefined ? { order } : {}),
		});
		const shown = await ports.paths.for(spaceId, actor);
		return Promise.all(runs.map(shown));
	};
