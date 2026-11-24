import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { RunStreamItem } from "../../../read";
import type { RunViews } from "./ports";

export type WatchRunPorts = {
	views: Pick<RunViews, "watch">;
	openRun: Access["openRun"];
};

/** Which run, from which transcript entry on, until `signal` aborts. */
export type WatchRun = {
	runId: string;
	spaceId?: string;
	/** Transcript entries up to this seq are skipped. Default: none. */
	afterSeq?: number;
	signal: AbortSignal;
};

/**
 * Opens the watch of a run for the actor: its status, its steps and its
 * transcript, then every change. The run is opened first, so a run they
 * may not see is not found before the stream begins.
 */
export const watchRun =
	(ports: WatchRunPorts) =>
	async (
		actor: Actor,
		request: WatchRun,
	): Promise<AsyncGenerator<RunStreamItem>> => {
		const { afterSeq, signal, ...which } = request;
		const { run } = await ports.openRun(actor, which);
		return ports.views.watch(run, signal, afterSeq ?? 0);
	};
