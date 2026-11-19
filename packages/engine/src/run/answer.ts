import {
	type AnswerFile,
	answerFilesProblem,
	type JsonValue,
	optionProblem,
} from "@nightshift/flows";
import type { ArtifactStore } from "../artifacts";
import {
	type Actor,
	commandOf,
	permissionOf,
	type RunActionRequest,
} from "../contract";
import { askAnswerProblem } from "../graph";
import type { RunState } from "../log";
import { RunRefusal, whyNot } from "../run-status";
import type { Access, Walk } from "../runs";

/**
 * The answer to a Gate, as a person acts on a run (`SpaceEngine.act`
 * hands it here through `runs/actions`). It moved out of `run/actions.ts`
 * as it was. Lane R6 of the hexagon series makes it the use case
 * `answerGate` of `gates/`, with the lock-screen rule the API runs today.
 *
 * On a run another Device walks, the answer travels to the Walker as a
 * Command, once the log here says the Gate takes it and no other answer is
 * on its way. On a run this computer walks, the answer's files are kept
 * first, then the answer is a Turn of the runner, with the rule inside it.
 */

/**
 * An answer to a Gate that no longer waits: someone answered it, its run
 * moved on, or an answer is already on its way.
 */
export class GateClosedError extends RunRefusal {
	constructor(message: string) {
		super("gate-closed", message);
		this.name = "GateClosedError";
	}
}

/**
 * Throws when `answer` cannot answer the run's open Gate, as the log says:
 * no Gate is open, another step is, the choice is not one of its options,
 * the choice needs a note and has none (the answer to an Agent), or the
 * data does not match the form of an Ask.
 */
function refuseAnswer(
	runState: RunState,
	{
		stepId,
		choice,
		note,
		data,
		files,
	}: {
		stepId: string;
		choice: string;
		note?: string;
		data?: JsonValue;
		files?: readonly AnswerFile[];
	},
): void {
	const why = whyNot("answer", runState.status, true);
	const { gate } = runState;
	if (why !== null || !gate) {
		throw new GateClosedError(why ?? "This run does not wait at a Gate.");
	}
	if (gate.stepId !== stepId) {
		throw new GateClosedError("That step is not the open Gate of this run.");
	}
	const problem = optionProblem(gate.choices, choice);
	if (problem !== null) throw new RunRefusal("invalid-answer", problem);
	const picked = gate.choices.find((c) => c.name === choice);
	if (picked?.needsNote && (note ?? "").trim() === "") {
		throw new RunRefusal(
			"invalid-answer",
			`Write a note to choose "${choice}". The agent continues with it.`,
		);
	}
	if (gate.form !== null) {
		const wrong = askAnswerProblem(gate.form, data);
		if (wrong !== null) throw new RunRefusal("invalid-answer", wrong);
	}
	const tooMany = answerFilesProblem(files ?? []);
	if (tooMany !== null) throw new RunRefusal("invalid-answer", tooMany);
}

export type AnswerPathDeps = {
	/** Opens the run for the actor (`runs/access`). */
	openRun: Access["openRun"];
	/** The run's facts, its Turns and its Walker elsewhere (`runs/walk`). */
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	/** Where the Walker keeps the files of an answer. */
	artifacts: Pick<ArtifactStore, "saveAnswer">;
};

/** Which run, in which Space when the caller holds one, and the answer in the person's words. */
export type AnswerOnRun = { runId: string; spaceId?: string } & Omit<
	Extract<RunActionRequest, { kind: "answer" }>,
	"kind"
>;

/** The answer path: one function, as `runs/actions` takes it. */
export function createAnswerPath(deps: AnswerPathDeps) {
	const { facts, turns, walkers } = deps.walk;

	/**
	 * Answers the run's open Gate with one of its choices, as the actor. The
	 * actor's role must allow `gate.resolve` in the run's Space.
	 */
	return async function answer(
		actor: Actor,
		request: AnswerOnRun,
	): Promise<void> {
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await deps.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("answer"),
		});
		const runId = run.id;
		if (!walkedHere) {
			refuseAnswer(await facts.state(runId), fields);
			if ((await walkers.pending(runId)).includes("gate.resolve")) {
				throw new GateClosedError(
					"An answer to this Gate is already on its way to the device that runs it.",
				);
			}
			const command = commandOf({ kind: "answer", ...fields });
			if (command) await walkers.send(run, actor, command);
			return;
		}
		// The files first, so the session the answer starts has them.
		// An answer the Turn refuses leaves them as artifacts of the run.
		if (fields.files && fields.files.length > 0) {
			refuseAnswer(await facts.state(runId), fields);
			await deps.artifacts.saveAnswer({
				runId,
				stepId: fields.stepId,
				files: fields.files,
			});
		}
		// The thread continues at once with the answer. The Turn ends
		// once the Gate's step ended. A full run cap leaves it open.
		await turns.take(
			runId,
			{
				kind: "answer",
				stepId: fields.stepId,
				choice: fields.choice,
				note: fields.note ?? "",
				...(fields.data !== undefined ? { data: fields.data } : {}),
				...(fields.via ? { via: fields.via } : {}),
			},
			{ check: (runState) => refuseAnswer(runState, fields) },
		);
	};
}
