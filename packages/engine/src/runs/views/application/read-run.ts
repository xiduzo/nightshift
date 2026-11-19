import type { Actor } from "../../../contract";
import type { RunDetail } from "../../../read";
import type { Access } from "../../access";
import type { PrivatePaths, RunViews } from "./ports";

export type ReadRunPorts = {
	views: Pick<RunViews, "getRun">;
	paths: PrivatePaths;
	openRun: Access["openRun"];
};

/** Which run, in which Space when the caller holds one. */
export type ReadRun = { runId: string; spaceId?: string };

/**
 * The run page, as the actor may see it: a run they may not see is not
 * found (`openRun`). The worktree path of a run on another Person's
 * Device is hidden.
 */
export const readRun =
	(ports: ReadRunPorts) =>
	async (actor: Actor, request: ReadRun): Promise<RunDetail> => {
		const { run } = await ports.openRun(actor, request);
		const shown = await ports.paths.for(run.spaceId, actor);
		return shown(await ports.views.getRun(run));
	};
