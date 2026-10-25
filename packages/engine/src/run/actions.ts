import type { Database } from "@nightshift/db";
import { type Flow, optionProblem } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor, OwnDevice, PlacementPort, RunsPort } from "../contract";
import { type Runner, type RunWalks, rerunNodeRefusal } from "../graph";
import {
	applyWalkerMoves,
	type LoggedEvent,
	RUN_NOT_FOUND,
	type RunBus,
	type RunLog,
	type RunRow,
} from "../log";
import {
	deriveOpenGate,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
} from "../read";
import { RunRefusal, refuseUnless, whyNot } from "../run-status";
import type { RunRelay } from "./relay";

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

/** One action a person asks of a run. */
export type RunActionRequest =
	/** Now (the default), after its running step, or take a stop after the step back. */
	| { kind: "stop"; when?: "now" | "after-step" | "cancel-after-step" }
	| { kind: "answer"; stepId: string; choice: string; note?: string }
	| { kind: "signal"; name: string }
	/** Another of the Person's Devices walks the run from here on. */
	| { kind: "move"; to: string }
	| { kind: "resume"; prompt?: string }
	/** With `stepId`, only while that step runs. */
	| { kind: "restart"; stepId?: string; prompt?: string }
	| {
			kind: "rerun";
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  };

export type RunActionsDeps = {
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
 * no Gate is open, another step is, or the choice is not one of its options.
 */
function refuseAnswer(
	events: readonly LoggedEvent[],
	{ stepId, choice }: { stepId: string; choice: string },
): void {
	const why = whyNot("answer", deriveRunState(events).status, true);
	const gate = deriveOpenGate(events);
	if (why !== null || !gate) {
		throw new GateClosedError(why ?? "This run does not wait at a Gate.");
	}
	if (gate.stepId !== stepId) {
		throw new GateClosedError("That step is not the open Gate of this run.");
	}
	const problem = optionProblem(gate.choices, choice);
	if (problem !== null) throw new RunRefusal("invalid-answer", problem);
}

/** Throws unless the run sleeps in a Wait node that waits for the Signal `name`. */
function refuseSignal(events: readonly LoggedEvent[], name: string): void {
	refuseUnless("signal", deriveRunState(events).status, true);
	if (deriveSleep(events)?.signal !== name) {
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
function refuseRestart(
	events: readonly LoggedEvent[],
	stepId: string | undefined,
): void {
	refuseUnless("restart", deriveRunState(events).status, true);
	const open = deriveSteps(events).filter((s) => s.endedAt === null);
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
		const events = await log.events(row.id);
		const status = deriveRunState(events).status;
		switch (request.kind) {
			case "stop":
				// A run that has ended has nothing to stop.
				if (whyNot("stop", status, false) !== null) return;
				return relay.send(row, actor, {
					kind: "run.stop",
					payload: request.when ? { when: request.when } : {},
				});
			case "answer": {
				refuseAnswer(events, request);
				const pending = await deps.archive.pendingCommands(row.id);
				if (pending.some((c) => c.kind === "gate.resolve")) {
					throw new GateClosedError(
						"An answer to this Gate is already on its way to the device that runs it.",
					);
				}
				const { stepId, choice, note } = request;
				return relay.send(row, actor, {
					kind: "gate.resolve",
					payload: { stepId, choice, ...(note ? { note } : {}) },
				});
			}
			case "signal":
				refuseSignal(events, request.name);
				return relay.send(row, actor, {
					kind: "signal.send",
					payload: { name: request.name },
				});
			case "move":
				if (!actor) throw signedOut();
				refuseUnless("move", status, false);
				return relay.send(row, actor, {
					kind: "run.move",
					payload: { to: request.to },
				});
			default:
				refuseUnless(request.kind, status, false);
		}
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
		await runner.hold(row.id, async ({ events }) => {
			if (whyNot("stop", deriveRunState(events).status, true) !== null) return;
			if (deriveStopAfterStep(events) === request) return;
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
				"This computer walks the run already.",
			);
		}
		await runner.hold(runId, async ({ events, active }) => {
			// A Turn that holds a slot is in the middle of a step too.
			refuseUnless(
				"move",
				active ? "running" : deriveRunState(events).status,
				true,
			);
			// The plan stays: only the Walker changes. A Device that is
			// offline is the planner's refusal.
			if (!(await deps.placement.moveTo(row, actor, to))) {
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

	/** An action on a run this computer walks: a Turn of the runner. */
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
					},
					{ check: (events) => refuseAnswer(events, request) },
				);
				return;
			case "signal":
				// A wake a person asks for: a full run cap refuses it.
				await runner.take(
					runId,
					{ kind: "wake", early: true, signal: request.name },
					{ check: (events) => refuseSignal(events, request.name) },
				);
				return;
			case "move":
				if (!actor) throw signedOut();
				return move(row, actor, request.to);
			case "resume":
				// `RunResumed` before the thread moves; a sleeping run wakes.
				await runner.take(
					runId,
					{
						kind: "resume",
						by: "person",
						...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
					},
					{
						check: (events) =>
							refuseUnless("resume", deriveRunState(events).status, true),
					},
				);
				return;
			case "restart":
				// A stop now and a resume in one Turn: nothing comes in between,
				// and the run keeps its slot.
				await runner.take(
					runId,
					{
						kind: "restart",
						by: "person",
						...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
					},
					{ check: (events) => refuseRestart(events, request.stepId) },
				);
				return;
			case "rerun": {
				// Before the slot: a node the flow does not have is refused first.
				const refusal = rerunNodeRefusal(deps.flowOf(row), request.nodeId);
				if (refusal) throw new RunRefusal("unknown-node", refusal);
				const { kind: _, ...rerun } = request;
				await runner.take(
					runId,
					{ kind: "rerun", by: "person", ...rerun },
					{
						check: (events) =>
							refuseUnless("rerun", deriveRunState(events).status, true),
					},
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
