import {
	type Actor,
	commandOf,
	permissionOf,
	type RunActionRequest,
} from "../../contract";
import type { askAnswerProblem } from "../../graph";
import type { Access, Walk } from "../../runs";
import {
	ANSWER_ON_ITS_WAY,
	closedWhy,
	GATE_GONE,
	GateClosedError,
	type GatedRun,
	refuseAnswer,
} from "../domain/answer";
import { lockScreenRefusal, NeedsApp } from "../domain/lock-screen";
import type { AnswerFiles, GateLists } from "./ports";

export type AnswerGatePorts = {
	/** Opens the run for the actor (`runs/access`). */
	openRun: Access["openRun"];
	facts: Pick<Walk["facts"], "state">;
	turns: Pick<Walk["turns"], "take">;
	walkers: Pick<Walk["walkers"], "send" | "pending">;
	/** The open Gates of the run's Space: what the lock-screen rule reads. */
	gates: Pick<GateLists, "open">;
	files: AnswerFiles;
	/** Why the data does not fill an Ask's form, or null (`graph/`). */
	askProblem: typeof askAnswerProblem;
	/**
	 * Whether this binding applies the lock-screen rule. Only the door of
	 * the API does: an answer that came as a Command does not meet it
	 * (D3 of the run path plan).
	 */
	checksLockScreen: boolean;
};

/** The form of an Ask (ADR 10), as `askProblem` reads it. */
type AskForm = Parameters<typeof askAnswerProblem>[0];

/** Which run, in which Space when the caller holds one, and the answer in the person's words. */
export type AnswerGate = { runId: string; spaceId?: string } & Omit<
	Extract<RunActionRequest, { kind: "answer" }>,
	"kind"
>;

/**
 * Answers the run's open Gate with one of its choices, as the actor. The
 * actor's role must allow `gate.resolve` in the run's Space.
 *
 * An answer from the lock screen (`via: "lock_screen"`) goes only to a Gate
 * its author marked for it, with one of its own choices (`NeedsApp`), and
 * only while the Gate is open with no answer on its way
 * (`GateClosedError`), when the binding checks it (`checksLockScreen`).
 *
 * On a run another Device walks, the answer travels to the Walker as a
 * Command, once the log here says the Gate takes it and no other answer is
 * on its way. On a run this computer walks, the answer's files are kept
 * first, then the answer is a Turn of the runner, with the rule inside it.
 */
export const answerGate =
	(ports: AnswerGatePorts) =>
	async (actor: Actor, request: AnswerGate): Promise<void> => {
		const { facts, turns, walkers } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("answer"),
		});
		const runId = run.id;
		if (ports.checksLockScreen && fields.via === "lock_screen") {
			const open = await ports.gates.open(run.spaceId);
			const refusal = lockScreenRefusal(open, { runId, ...fields });
			if (refusal === "needs-app") throw new NeedsApp();
			if (refusal === "gate-closed") {
				// The run's own words when its log says why, as an answer from the app gets them.
				const why = closedWhy(await facts.state(runId), fields.stepId);
				throw new GateClosedError(why ?? GATE_GONE);
			}
		}
		const refuse = (state: GatedRun<AskForm>) =>
			refuseAnswer(state, fields, ports.askProblem);
		if (!walkedHere) {
			refuse(await facts.state(runId));
			if ((await walkers.pending(runId)).includes("gate.resolve")) {
				throw new GateClosedError(ANSWER_ON_ITS_WAY);
			}
			const command = commandOf({ kind: "answer", ...fields });
			if (command) await walkers.send(run, actor, command);
			return;
		}
		// The files first, so the session the answer starts has them.
		// An answer the Turn refuses leaves them as artifacts of the run.
		if (fields.files && fields.files.length > 0) {
			refuse(await facts.state(runId));
			await ports.files.save({
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
			{ check: (runState) => refuse(runState) },
		);
	};
