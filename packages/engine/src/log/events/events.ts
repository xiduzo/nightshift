import type { RunPayloads } from "./run";
import type { SpacePayloads } from "./space-payloads";
import type { StepPayloads } from "./step";
import type { WaitPayloads } from "./wait-payloads";

/**
 * Every fact the engine appends to the event log. The run log appends and
 * reads one (`run-log/append.ts`). One fold of a run's log gives its state
 * (`state/run-state.ts`). Status, reasons, step summaries, edge counts and
 * node outputs are never stored anywhere else.
 *
 * Checkpoint rule: a fact goes into the log as soon as it happens, and a step
 * is closed (`StepEnded` with its outcome and outputs) before the walk picks
 * the next node. A daemon that dies can always continue from the log.
 *
 * Transcript chunks (text deltas, tool calls, command output) never go here:
 * they live in the NDJSON transcript files.
 */

/**
 * The payload of each event, by its type. Its parts follow what an event is
 * about: a Space (`space-payloads.ts`), a run (`run-payloads.ts`), a step
 * (`step-payloads.ts`), and a wait or a hold (`wait-payloads.ts`).
 */
export type EnginePayloads = SpacePayloads &
	RunPayloads &
	StepPayloads &
	WaitPayloads;

export type EngineEventType = keyof EnginePayloads;

/**
 * One event as this Replica's log has it. Any payload may also carry
 * `commandId`: the Command whose first event of its run this is
 * (`command-stamp.ts`). Readers of the payloads above never need it.
 */
export type LoggedEvent = {
	[T in EngineEventType]: {
		seq: number;
		runId: string | null;
		stepId: string | null;
		sessionId: string | null;
		type: T;
		payload: EnginePayloads[T];
		at: number;
	};
}[EngineEventType];

export type EventInput<T extends EngineEventType> = {
	type: T;
	payload: EnginePayloads[T];
	runId?: string | null;
	stepId?: string | null;
	sessionId?: string | null;
	/** The Space of a fact of no run and no project (a Device's). */
	spaceId?: string;
};

/** Groups events by run id. Events without a run are dropped. */
export function groupByRun(
	events: readonly LoggedEvent[],
): Map<string, LoggedEvent[]> {
	const grouped = new Map<string, LoggedEvent[]>();
	for (const e of events) {
		if (!e.runId) continue;
		const list = grouped.get(e.runId) ?? [];
		list.push(e);
		grouped.set(e.runId, list);
	}
	return grouped;
}
