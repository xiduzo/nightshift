import type { FlowNodeType } from "@nightshift/flows";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import {
	runRecord,
	THIS_COMPUTER,
} from "../../../../access/adapters/out/in-memory-run-records";
import type { RunRecord } from "../../../../access/application/open-run";
import { rerunNodeRefusal } from "../../../../graph";
import { foldRun, type RunState } from "../../../../log";
import {
	deriveSteps,
	lastHarnessSession,
	parseRunFlow,
	takesPrompt,
} from "../../../../read";
import { runEvents } from "../../../../testing/run-events";
import { inMemoryRunFacts } from "../../../walk/adapters/out/in-memory-run-facts";
import { inMemoryTurns } from "../../../walk/adapters/out/in-memory-turns";
import { inMemoryWalkers } from "../../../walk/adapters/out/in-memory-walkers";
import { createStartHolds } from "../../../walk/domain/start-holds";
import { inMemoryRunLeases } from "./in-memory-run-leases";

/** The Space every run of a test is in, unless it says another. */
export const SPACE = "space-1";
/** A Person who is a Member of `SPACE`, and one who only views it. */
export const ADA = { personId: "person-ada", door: "session" as const };
export const VIC = { personId: "person-vic", door: "session" as const };
/** The Device that walks a run walked elsewhere. */
export const FAR = "device-far";

/** A run's state for a test: the fold of an empty log, with the fields the test names. */
export function stateOf(fields: Partial<RunState>): RunState {
	return { ...foldRun([]), ...fields };
}

/** A step of a node of `nodeType`. An Agent's session has a name. */
function inStep(nodeType: FlowNodeType) {
	const log = runEvents().runStarted();
	log.stepStarted("s1", "n1", 1, { nodeType });
	if (nodeType !== "agent") return log;
	return log
		.sessionStarted("s1", "x")
		.push(
			"HarnessSessionAssigned",
			{ harnessSessionId: "h1", model: null },
			{ stepId: "s1", sessionId: "x" },
		);
}
/** The state of a run that a person stopped in a step of `nodeType`. */
export const endedIn = (nodeType: FlowNodeType): RunState =>
	inStep(nodeType)
		.stepEnded("s1", "stopped")
		.push("RunEnded", {
			status: "stopped",
			reason: null,
			endReason: "stopped_by_person",
		})
		.state();
/** The state of a run that sleeps in a step of `nodeType`. */
export const asleep = (nodeType: FlowNodeType): RunState =>
	inStep(nodeType).waitStarted("s1").state();

/**
 * Every port of the actions in memory at once, with the pure functions of
 * the mechanisms they take: where each use-case test starts. `ADA` is a
 * member of `SPACE`, `VIC` a viewer. A test puts a run in (`put`) with its
 * state: the run's facts read that state, and its Turns check it.
 */
export function inMemoryActionPorts(options: { reachable?: boolean } = {}) {
	const access = inMemoryAccess(THIS_COMPUTER);
	access.members.join(SPACE, ADA.personId, "member");
	access.members.join(SPACE, VIC.personId, "viewer");
	const states = new Map<string, RunState>();
	const twin = inMemoryRunFacts(THIS_COMPUTER);
	const facts = {
		...twin,
		/** The state `put` set, else the fold of what was appended. */
		state: async (runId: string) => states.get(runId) ?? twin.state(runId),
	};
	const turns = inMemoryTurns();
	return {
		...access,
		facts,
		turns,
		walkers: inMemoryWalkers(options),
		leases: inMemoryRunLeases(),
		holds: createStartHolds(),
		deriveSteps,
		takesPrompt,
		lastHarnessSession,
		flowOf: parseRunFlow,
		rerunNodeRefusal,
		/**
		 * Puts a run in: its row (walked here unless `walkerId` says
		 * another Device), its state, and whether a drive holds it.
		 */
		put(
			run: Pick<RunRecord, "id"> & Partial<RunRecord>,
			state: RunState = stateOf({ status: "waiting" }),
			active = false,
		): RunRecord {
			const row = runRecord({ spaceId: SPACE, ...run });
			access.runs.add(row);
			states.set(row.id, state);
			turns.set(row.id, { row, runState: state, active });
			return row;
		},
	};
}

export type InMemoryActionPorts = ReturnType<typeof inMemoryActionPorts>;
