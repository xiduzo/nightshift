import type { Database } from "@nightshift/db";
import { type Flow, type JsonValue, optionProblem } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor, OwnDevice } from "../contract";
import {
	askAnswerProblem,
	type Runner,
	type RunWalks,
	rerunNodeRefusal,
} from "../graph";
import {
	applyWalkerMoves,
	placedRun,
	RUN_NOT_FOUND,
	type RunBus,
	type RunLog,
	type RunRow,
	type RunState,
} from "../log";
import {
	deriveOpenGate,
	deriveRunState,
	deriveSleep,
	deriveSteps,
} from "../read";
import { RunRefusal, refuseUnless, whyNot } from "../run-status";
import type { PlacementPort, RunsPort } from "./peers";
import type { RunRelay } from "./relay";
import type { StartHolds } from "./start-holds";

/**
 * What a person does to a run: stop it, answer its Gate, send its Signal,
 * move it, resume it, restart its step, or run it again from a node. One
 * entry, `act`. It reads the run's row once (its Space and its Walker),
 * then either hands the action to the run's Walker as a Command
 * (`relay.ts`) or takes it here as a Turn of the runner (`runner.take`,
 * or `runner.hold` for an action that drives nothing).
 *
 * Which actions a run allows is one rule (`run-status/`, which the screens
 * read too). Each refusal is a `RunRefusal` with one named rule and one
 * message. The checks that read the log run inside the Turn, so no other
 * Turn of the run comes between the check and the action.
 *
 * On a run another Device walks, this computer writes nothing: the Walker
 * is the only writer of its run's events. A stop, an answer, a Signal and
 * a move travel to it. Only the Walker resumes, restarts or reruns.
 */

/** One action a person asks of a run (`SpaceEngine.act`). */
export type RunActionRequest =
	/**
	 * `now` (default): aborts the running step, closes an open Gate or ends
	 * a sleep, and ends the run as `stopped`. `after-step`: lets the running
	 * step finish, then ends the run as `stopped` before the next step.
	 * `cancel-after-step`: withdraws an `after-step` stop. No-op when
	 * nothing runs, waits or sleeps.
	 */
	| { kind: "stop"; when?: "now" | "after-step" | "cancel-after-step" }
	/**
	 * Answers an open Gate with one of its choices and continues the walk
	 * on that outcome. Fails when the step is not an open Gate or the
	 * choice is not one of its choices. An Ask (ADR 10) takes `data`, the
	 * data of its form: it fails when the data does not match the form.
	 */
	| {
			kind: "answer";
			stepId: string;
			choice: string;
			note?: string;
			data?: JsonValue;
	  }
	/**
	 * A signal to a run whose Wait node waits for it: the step ends `done`
	 * and the walk goes on. Fails when the run does not wait for a signal
	 * of that name.
	 */
	| { kind: "signal"; name: string }
	/**
	 * Moves the run's Walk to another of the actor's Devices
	 * (`WalkerMoved`): this computer archives the run's checkpoint and
	 * files and stops walking it; the new Walker resumes from the archive.
	 * Only a run that is not in the middle of a step.
	 */
	| { kind: "move"; to: string }
	/**
	 * Lets go of the lease `name` that the run holds (ADR 7): the next run
	 * that waits for it takes it. The run goes on, and does not take it
	 * again. Fails when the run does not hold it.
	 */
	| { kind: "release-lease"; name: string }
	/**
	 * Continues a stopped, failed or interrupted run at its last step's
	 * node (inside a Call with `each`, at the same item). A finished run
	 * reopens its last step. A sleeping run wakes at once. An Agent node
	 * with a harness session continues that session with the prompt
	 * (default "Continue where you left off."). Any other node runs again.
	 * Edge counts carry over. Fails while the run is running.
	 */
	| { kind: "resume"; prompt?: string }
	/**
	 * Stops the running step and continues it at once, as a stop now and a
	 * resume would, with nothing in between. Only while a step runs; with
	 * `stepId`, only while that step runs.
	 */
	| { kind: "restart"; stepId?: string; prompt?: string }
	/**
	 * Walks a run that is not going (failed, stopped, interrupted or
	 * finished) again from `nodeId`, a node of the run's own flow, with a
	 * new visit of it; the steps after it follow as the flow routes.
	 * Inputs, outputs and edge counts carry over. An Agent node continues
	 * the session of its step `stepId` (default: its latest) with the
	 * prompt, or with `fresh` starts a new session with its own prompt.
	 */
	| {
			kind: "rerun";
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  };

export type RunActionsDeps = {
	/** Lets go of a run's leases (`LeaseKeeper.release`). */
	leases: { release(runId: string, names: readonly string[]): Promise<void> };
	db: Database;
	log: RunLog;
	bus: RunBus;
	runner: Pick<Runner, "take" | "hold" | "forget">;
	relay: RunRelay;
	archive: Pick<RunsPort, "keepWalk" | "pendingCommands">;
	walks: Pick<RunWalks, "exportWalk">;
	/** This computer as a Device. */
	device: { id: string };
	/** The run's row, or "not found". */
	runRow(runId: string): Promise<RunRow>;
	/** The run's flow, from its snapshot. */
	flowOf(row: RunRow): Flow;
	/**
	 * Where the walk may move (`moveTo`: one of the Person's own Devices,
	 * online), and the Person's Devices to offer for it (`devicesFor`).
	 */
	placement: Pick<PlacementPort, "moveTo" | "devicesFor">;
	/** A resume, a restart and a run again make the run active: refused while its Space's Projects move. */
	holds: Pick<StartHolds, "start">;
};

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

const signedOut = () =>
	new RunRefusal("signed-out", "Sign in to act on this run.");

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
	}: { stepId: string; choice: string; note?: string; data?: JsonValue },
): void {
	const why = whyNot("answer", deriveRunState(runState).status, true);
	const gate = deriveOpenGate(runState);
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
}

/** Throws unless the run holds the lease `name` now: a run that ended holds none. */
function refuseRelease(runState: RunState, name: string): void {
	if (
		!runState.holds.some((hold) => hold.kind === "lease" && hold.name === name)
	) {
		throw new RunRefusal(
			"not-now",
			`This run does not hold the lease "${name}" now.`,
		);
	}
}

/** Throws unless the run sleeps in a Wait node that waits for the Signal `name`. */
function refuseSignal(runState: RunState, name: string): void {
	refuseUnless("signal", deriveRunState(runState).status, true);
	if (deriveSleep(runState)?.signal !== name) {
		throw new RunRefusal(
			"wrong-signal",
			"This run does not wait for that signal.",
		);
	}
}

/**
 * Throws why a restart is refused, from the run's log: the run runs no
 * step, or `stepId` is not the step that runs.
 */
function refuseRestart(runState: RunState, stepId: string | undefined): void {
	const { status, result } = deriveRunState(runState);
	refuseUnless("restart", status, true, result);
	const open = deriveSteps(runState).filter((s) => s.endedAt === null);
	if (open.length === 0) {
		throw new RunRefusal(
			"no-step",
			"No step runs right now. Try again when the next step starts.",
		);
	}
	if (stepId !== undefined && !open.some((s) => s.id === stepId)) {
		throw new RunRefusal(
			"step-ended",
			"That step has ended. Restart the step that runs now.",
		);
	}
}

export type RunActions = ReturnType<typeof createRunActions>;

export function createRunActions(deps: RunActionsDeps) {
	const { db, log, bus, runner, relay } = deps;

	/** The run's row when it is in the Space, else "not found": the action's one read of it. */
	async function rowIn(spaceId: string, runId: string): Promise<RunRow> {
		const row = await deps.runRow(runId);
		if (row.spaceId !== spaceId) throw new Refusal("not-found", RUN_NOT_FOUND);
		return row;
	}

	/**
	 * An action on a run another Device walks: a stop, an answer, a Signal
	 * or a move travels to the Walker as a Command, once the run's log here
	 * allows it. Only the Walker takes the rest.
	 */
	async function onWalker(
		row: RunRow,
		actor: Actor | undefined,
		request: RunActionRequest,
	): Promise<void> {
		const runState = await log.state(row.id);
		const { status, result } = deriveRunState(runState);
		switch (request.kind) {
			case "stop":
				// A run that has ended has nothing to stop.
				if (whyNot("stop", status, false) !== null) return;
				return relay.send(row, actor, {
					kind: "run.stop",
					payload: request.when ? { when: request.when } : {},
				});
			case "answer": {
				refuseAnswer(runState, request);
				const pending =
					(await deps.archive.pendingCommands([row.id])).get(row.id) ?? [];
				if (pending.some((c) => c.kind === "gate.resolve")) {
					throw new GateClosedError(
						"An answer to this Gate is already on its way to the device that runs it.",
					);
				}
				const { stepId, choice, note, data } = request;
				return relay.send(row, actor, {
					kind: "gate.resolve",
					payload: {
						stepId,
						choice,
						...(note ? { note } : {}),
						...(data !== undefined ? { data } : {}),
					},
				});
			}
			case "signal":
				refuseSignal(runState, request.name);
				return relay.send(row, actor, {
					kind: "signal.send",
					payload: { name: request.name },
				});
			case "move":
				if (!actor) throw signedOut();
				refuseUnless("move", status, false, result);
				return relay.send(row, actor, {
					kind: "run.move",
					payload: { to: request.to },
				});
			case "release-lease":
				refuseRelease(runState, request.name);
				return relay.send(row, actor, {
					kind: "lease.release",
					payload: { name: request.name },
				});
			default:
				refuseUnless(request.kind, status, false, result);
		}
	}

	/**
	 * Lets go of a lease the run holds, in a Turn that drives nothing: the
	 * log says so first (`LeaseReleased`, why `person`), so a resume does
	 * not take it back, then its keeper frees it.
	 */
	async function releaseLease(row: RunRow, name: string): Promise<void> {
		await runner.hold(row.id, async ({ runState }) => {
			refuseRelease(runState, name);
			await log.append({
				type: "LeaseReleased",
				runId: row.id,
				payload: { name, why: "person" },
			});
			bus.publish(row.id, { kind: "status-changed" });
		});
		await deps.leases.release(row.id, [name]);
	}

	/** Stops the run now, or after its running step (`hold`: a Turn that drives nothing). */
	async function stop(
		row: RunRow,
		when: "now" | "after-step" | "cancel-after-step" | undefined,
	): Promise<void> {
		if (when !== "after-step" && when !== "cancel-after-step") {
			await runner.take(row.id, { kind: "stop" });
			return;
		}
		const request = when === "after-step";
		await runner.hold(row.id, async ({ runState }) => {
			if (whyNot("stop", deriveRunState(runState).status, true) !== null)
				return;
			if (runState.stopAfterStep === request) return;
			await log.append({
				type: request ? "StopAfterStepRequested" : "StopAfterStepCancelled",
				runId: row.id,
				payload: {},
			});
			bus.publish(row.id, { kind: "status-changed" });
		});
	}

	/**
	 * A run moves to another of the Person's Devices while it waits, sleeps
	 * or has stopped: this computer keeps the run's walk state (its
	 * Checkpoint and its steps' files) in the archive and logs
	 * `WalkerMoved`, in a Turn (`hold`), so no answer, wake or resume comes
	 * in between. The new Walker takes it over from there (`take-over.ts`).
	 * The run's plan stays: its steps run on the Devices it planned, for the
	 * same Person.
	 */
	async function move(row: RunRow, actor: Actor, to: string): Promise<void> {
		const runId = row.id;
		const self = await log.walkerId();
		if (to === self || to === deps.device.id) {
			throw new RunRefusal(
				"walks-here",
				"This run already runs on this computer.",
			);
		}
		await runner.hold(runId, async ({ runState, active }) => {
			// A Turn that holds a slot is in the middle of a step too.
			const { status, result } = deriveRunState(runState);
			refuseUnless("move", active ? "running" : status, true, result);
			// The plan stays: only the Walker changes. A Device that is
			// offline is the planner's refusal.
			if (!(await deps.placement.moveTo(placedRun(row), actor, to))) {
				throw new RunRefusal(
					"not-your-device",
					"That device is not one of yours.",
				);
			}
			await deps.archive.keepWalk(await deps.walks.exportWalk(runId));
			runner.forget(runId);
			const moved = await log.append({
				type: "WalkerMoved",
				runId,
				payload: { from: self, to, by: actor.personId },
			});
			await applyWalkerMoves(db, [moved]);
			bus.publish(runId, { kind: "status-changed" });
		});
	}

	/**
	 * An action on a run this computer walks: a Turn of the runner. One
	 * that makes the run active (a resume, a restart, a run again) is a
	 * start: refused, as a new run is, while its Space's Projects move.
	 */
	async function here(
		row: RunRow,
		actor: Actor | undefined,
		request: RunActionRequest,
	): Promise<void> {
		const runId = row.id;
		switch (request.kind) {
			case "stop":
				return stop(row, request.when);
			case "answer":
				// The thread continues at once with the answer. The Turn ends
				// once the Gate's step ended. A full run cap leaves it open.
				await runner.take(
					runId,
					{
						kind: "answer",
						stepId: request.stepId,
						choice: request.choice,
						note: request.note ?? "",
						...(request.data !== undefined ? { data: request.data } : {}),
					},
					{ check: (runState) => refuseAnswer(runState, request) },
				);
				return;
			case "signal":
				// A wake a person asks for: a full run cap refuses it.
				await runner.take(
					runId,
					{ kind: "wake", early: true, signal: request.name },
					{ check: (runState) => refuseSignal(runState, request.name) },
				);
				return;
			case "move":
				if (!actor) throw signedOut();
				return move(row, actor, request.to);
			case "release-lease":
				return releaseLease(row, request.name);
			case "resume":
				// `RunResumed` before the thread moves; a sleeping run wakes.
				await deps.holds.start(row.spaceId, () =>
					runner.take(
						runId,
						{
							kind: "resume",
							by: "person",
							...(request.prompt !== undefined
								? { prompt: request.prompt }
								: {}),
						},
						{
							check: (runState) => {
								const { status, result } = deriveRunState(runState);
								refuseUnless("resume", status, true, result);
							},
						},
					),
				);
				return;
			case "restart":
				// A stop now and a resume in one Turn: nothing comes in between,
				// and the run keeps its slot.
				await deps.holds.start(row.spaceId, () =>
					runner.take(
						runId,
						{
							kind: "restart",
							by: "person",
							...(request.prompt !== undefined
								? { prompt: request.prompt }
								: {}),
						},
						{ check: (runState) => refuseRestart(runState, request.stepId) },
					),
				);
				return;
			case "rerun": {
				// Before the slot: a node the flow does not have is refused first.
				const refusal = rerunNodeRefusal(deps.flowOf(row), request.nodeId);
				if (refusal) throw new RunRefusal("unknown-node", refusal);
				const { kind: _, ...rerun } = request;
				await deps.holds.start(row.spaceId, () =>
					runner.take(
						runId,
						{ kind: "rerun", by: "person", ...rerun },
						{
							check: (runState) =>
								refuseUnless("rerun", deriveRunState(runState).status, true),
						},
					),
				);
				return;
			}
		}
	}

	return {
		/**
		 * Does what `request` asks of the run, as `actor`, in the Space: here
		 * as a Turn of the runner, or on another Walker as a Command. Throws
		 * a `RunRefusal` when the run does not allow it, and "not found" for
		 * a run of another Space.
		 */
		async act(
			spaceId: string,
			actor: Actor | undefined,
			runId: string,
			request: RunActionRequest,
		): Promise<void> {
			const row = await rowIn(spaceId, runId);
			if (row.walkerId !== (await log.walkerId())) {
				return onWalker(row, actor, request);
			}
			return here(row, actor, request);
		},

		/**
		 * The Person's own Devices the run can move to: online, and not its
		 * Walker. From the run's own Space, whichever Space the person works
		 * in. Another Person's Device takes steps through its Offers, never a
		 * walk.
		 */
		async moveTargets(
			spaceId: string,
			actor: Actor | undefined,
			runId: string,
		): Promise<OwnDevice[]> {
			const row = await rowIn(spaceId, runId);
			if (!actor) throw signedOut();
			const walkedHere = row.walkerId === (await log.walkerId());
			return (
				await deps.placement.devicesFor(
					row.spaceId,
					actor.personId,
					row.projectId,
				)
			).filter(
				(d) =>
					d.offers === undefined &&
					d.online &&
					d.deviceId !== row.walkerId &&
					!(walkedHere && d.thisDevice),
			);
		},
	};
}
