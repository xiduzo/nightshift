import type { Database } from "@nightshift/db";
import type { Actor, OwnDevice, RunsPort, SpaceEngine } from "../contract";
import type { Runner, RunWalks } from "../graph";
import type { RunBus, RunLog, RunRow } from "../log";
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
	relay: RunRelay;
	archive: Pick<RunsPort, "keepWalk" | "archived">;
	/** The walk state of this computer's runs: what a move keeps, and what a take-over imports. */
	walks: Pick<RunWalks, "exportWalk" | "importWalk" | "importTranscript">;
	pendingCommands: RunsPort["pendingCommands"];
	device: { id: string };
	/** This computer's owner as the Host that keeps the Space knows them (`Peers.personOnHost`). */
	personOnHost(spaceId: string): Promise<string | null>;
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
