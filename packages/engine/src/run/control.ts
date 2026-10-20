import type { Database } from "@nightshift/db";
import type { Actor, SpaceEngine } from "../contract";
import type { Runner } from "../graph";
import type { RunBus, RunLog, RunRow } from "../log";
import type { EngineExchange, OwnDevice, RunArchive } from "../peers";
import type { ReadModel } from "../read";
import { resolveGate } from "./gate";
import { moveRun, takeOver } from "./move";
import type { RunRelay } from "./relay";
import { stopRun } from "./stop";
import { signalRun, wakeOfflineSleeps } from "./wake";

/**
 * The actions on one run that write a run-level fact each (`stop.ts`,
 * `move.ts`, `gate.ts`, `wake.ts`), over the modules they need. On a run
 * another Device walks they travel to its Walker (`relay.ts`).
 */
export function createRunControl(deps: {
	db: Database;
	log: RunLog;
	bus: RunBus;
	runner: Runner;
	reads: Pick<ReadModel, "untilLogged">;
	relay: RunRelay;
	archive: RunArchive;
	commands: Pick<EngineExchange["commands"], "pendingOf">;
	device: { id: string };
	/** The Person's own Devices that a run of the project can move to. */
	ownDevices(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]>;
}) {
	return {
		stop: (
			row: RunRow,
			actor: Actor | undefined,
			options: Parameters<SpaceEngine["stopRun"]>[1],
		) => stopRun(deps, row, actor, options),
		move: (row: RunRow, actor: Actor | undefined, to: string) =>
			moveRun(deps, row, actor, to),
		resolveGate: (
			row: RunRow,
			actor: Actor | undefined,
			input: Parameters<SpaceEngine["resolveGate"]>[0],
		) => resolveGate(deps, row, actor, input),
		signal: (row: RunRow, actor: Actor | undefined, name: string) =>
			signalRun(deps, row, actor, name),
		/** This computer walks a run another Device moved here. */
		takeOver: (runId: string) => takeOver(deps, runId),
		/** A Device is back: the runs that sleep because a Device was offline look again. */
		wakeOfflineSleeps: () => wakeOfflineSleeps(deps),
	};
}

export type RunControl = ReturnType<typeof createRunControl>;
