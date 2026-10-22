import { optionProblem } from "@nightshift/flows";
import type { Actor, RunsPort, SpaceEngine } from "../contract";
import type { Runner } from "../graph";
import type { LoggedEvent, RunLog, RunRow } from "../log";
import { deriveOpenGate } from "../read";
import type { RunRelay } from "./relay";

type GateAnswer = Parameters<SpaceEngine["resolveGate"]>[0];

/**
 * An answer to a Gate that no longer waits: someone answered it, its run
 * moved on, or an answer is already on its way. An answer that is not valid
 * for the Gate is a plain Error.
 */
export class GateClosedError extends Error {}

/**
 * Throws when `answer` cannot answer the run's open Gate, as the log
 * says: no Gate is open, another step is, or the choice is not one of its
 * options.
 */
function refuseAnswer(
	events: readonly LoggedEvent[],
	{ stepId, choice }: GateAnswer,
): void {
	const gate = deriveOpenGate(events);
	if (!gate) throw new GateClosedError("This run does not wait at a Gate.");
	if (gate.stepId !== stepId) {
		throw new GateClosedError(
			`Step ${stepId} is not the open Gate of this run.`,
		);
	}
	const problem = optionProblem(gate.choices, choice);
	if (problem !== null) throw new Error(problem);
}

/**
 * Answers the open Gate of a run. Here, the answer is a Turn of the runner:
 * the thread continues at once with the answer, and this returns once the
 * Gate's step has ended. A full run cap refuses it and leaves the Gate
 * open. On a run another Device walks, the answer travels to its Walker as
 * a command, once.
 */
export async function resolveGate(
	deps: {
		log: Pick<RunLog, "events">;
		runner: Pick<Runner, "take">;
		relay: RunRelay;
		pendingCommands: RunsPort["pendingCommands"];
	},
	row: RunRow,
	actor: Actor | undefined,
	answer: GateAnswer,
): Promise<void> {
	const { log, runner, relay } = deps;
	const { stepId, choice, note } = answer;
	const runId = row.id;
	if (await relay.walkedElsewhere(row)) {
		refuseAnswer(await log.events(runId), answer);
		const pending = await deps.pendingCommands(runId);
		if (pending.some((c) => c.kind === "gate.resolve")) {
			throw new GateClosedError(
				"An answer to this Gate is already on its way to the device that runs it.",
			);
		}
		await relay.send(row, actor, {
			kind: "gate.resolve",
			payload: { stepId, choice, ...(note ? { note } : {}) },
		});
		return;
	}
	await runner.take(
		runId,
		{ kind: "answer", stepId, choice, note: note ?? "" },
		{ check: (events) => refuseAnswer(events, answer) },
	);
}
