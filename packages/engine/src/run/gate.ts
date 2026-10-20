import { optionProblem } from "@nightshift/flows";
import type { Actor, SpaceEngine } from "../contract";
import type { Runner } from "../graph";
import type { RunLog, RunRow } from "../log";
import type { EngineExchange } from "../peers";
import { deriveOpenGate, deriveSteps, type ReadModel } from "../read";
import type { RunRelay } from "./relay";

type GateAnswer = Parameters<SpaceEngine["resolveGate"]>[0];

/**
 * Answers the open Gate of a run. Here, the thread continues at once with
 * the answer, and this returns once the Gate's step has ended. On a run
 * another Device walks, the answer travels to its Walker as a command,
 * once.
 */
export async function resolveGate(
	deps: {
		log: Pick<RunLog, "events">;
		runner: Pick<
			Runner,
			"exclusive" | "reserveSlot" | "resume" | "releaseStartingSlot"
		>;
		reads: Pick<ReadModel, "untilLogged">;
		relay: RunRelay;
		commands: Pick<EngineExchange["commands"], "pendingOf">;
	},
	row: RunRow,
	actor: Actor | undefined,
	{ stepId, choice, note }: GateAnswer,
): Promise<void> {
	const { log, runner, reads, relay } = deps;
	const runId = row.id;
	if (await relay.walkedElsewhere(row)) {
		const gate = deriveOpenGate(await log.events(runId));
		if (!gate) throw new Error("This run does not wait at a Gate.");
		if (gate.stepId !== stepId) {
			throw new Error(`Step ${stepId} is not the open Gate of this run.`);
		}
		const problem = optionProblem(gate.choices, choice);
		if (problem !== null) throw new Error(problem);
		const pending = await deps.commands.pendingOf(runId);
		if (pending.some((c) => c.kind === "gate.resolve")) {
			throw new Error(
				"An answer to this Gate is already on its way to the device that runs it.",
			);
		}
		await relay.send(row, actor, {
			kind: "gate.resolve",
			payload: { stepId, choice, ...(note ? { note } : {}) },
		});
		return;
	}
	await runner.exclusive(runId, async () => {
		const events = await log.events(runId);
		const gate = deriveOpenGate(events);
		if (!gate) throw new Error("This run does not wait at a Gate.");
		if (gate.stepId !== stepId) {
			throw new Error(`Step ${stepId} is not the open Gate of this run.`);
		}
		const problem = optionProblem(gate.choices, choice);
		if (problem !== null) throw new Error(problem);
		// The thread continues at once, so it needs a slot. A full cap
		// leaves the Gate open.
		runner.reserveSlot(runId);
		try {
			// The Gate node ends the step on the answer. Return once it has,
			// so the run no longer waits when the caller looks again.
			const answered = reads.untilLogged(
				runId,
				(events) =>
					deriveSteps(events).find((s) => s.id === stepId)?.endedAt !== null,
			);
			runner.resume(row, { kind: "gate", choice, note: note ?? "" });
			await answered;
		} finally {
			runner.releaseStartingSlot(runId);
		}
	});
}
