import type { WaitReason } from "../../../log";
import type { RunStatus } from "../../../run-status";
import type { RunViews } from "./ports";

/** A run's status and whether it is on this computer. */
export type RunHere = {
	id: string;
	status: RunStatus;
	wakeAt: number | null;
	/** What a sleeping run waits for: a time, the network, an offline Device. Null while it does not sleep. */
	waitReason: WaitReason | null;
	/** This computer walks it. */
	walkedHere: boolean;
	/** Its steps run on this computer (its Device, as its row says). */
	stepsHere: boolean;
};

export type ReadRunHerePorts = { views: Pick<RunViews, "runHere"> };

/**
 * Where a run is and what it does, cheap, in any Space of this Replica,
 * for Night Shift itself (keep this computer awake). Null for a run this
 * Replica does not have.
 */
export const readRunHere =
	(ports: ReadRunHerePorts) =>
	(request: { runId: string }): Promise<RunHere | null> =>
		ports.views.runHere(request.runId);
