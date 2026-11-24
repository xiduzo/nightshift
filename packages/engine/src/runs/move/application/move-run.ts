import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import {
	type Actor,
	commandOf,
	type PersonActor,
	permissionOf,
} from "../../../contract";
import type { RunRow } from "../../../log";
import { isTestRun, refuseUnless } from "../../../run-status";
import type { RunFacts, Turns, Walkers } from "../../walk";
import {
	notYourDevice,
	refuseMoveHere,
	signedOut,
	snapshotVersion,
	walksThere,
} from "../domain/move-rules";
import type { MoveDevices, WalkHandover } from "./ports";

export type MoveRunPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state" | "append" | "changed" | "walkerId">;
	turns: Pick<Turns, "hold" | "forget">;
	walkers: Pick<Walkers, "send">;
	devices: Pick<MoveDevices, "target" | "capabilities">;
	handover: Pick<WalkHandover, "keep" | "moved">;
	/** This computer as a Device. */
	device: { id: string };
	/** Why a Device of an older Night Shift cannot take the run's walk (`placement/`). */
	olderNightShift(name: string): string;
};

/** Which run, in which Space when the caller holds one, and the Device it moves to. */
export type MoveRun = { runId: string; spaceId?: string; to: string };

/**
 * Moves the run's walk to another of the actor's Devices. The actor's role
 * must allow `run.move` in the run's Space, and a move needs a Person. A
 * run another Device walks: the move travels to its Walker as a Command,
 * once the status rule allows it.
 *
 * A run this computer walks moves while it waits, sleeps or has stopped:
 * this computer keeps the run's walk state (its Checkpoint and its steps'
 * files) in the archive and logs `WalkerMoved`, in a Turn that drives
 * nothing, so no answer, wake or resume comes in between. The run's plan
 * stays: its steps run on the Devices it planned, for the same Person.
 * The new Walker takes it over from there (`arriveRun`).
 */
export const moveRun =
	(ports: MoveRunPorts) =>
	async (actor: Actor, request: MoveRun): Promise<void> => {
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("move"),
		});
		if (!("personId" in actor)) throw signedOut();
		if (!walkedHere) {
			const runState = await ports.facts.state(run.id);
			refuseUnless(
				"move",
				runState.status,
				false,
				runState.end?.result ?? null,
			);
			const command = commandOf({ kind: "move", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		await moveHere(ports, run, actor, fields.to);
	};

/** The move of a run this computer walks, in a Turn. */
async function moveHere(
	ports: MoveRunPorts,
	run: RunRow,
	actor: PersonActor,
	to: string,
): Promise<void> {
	const { facts, turns } = ports;
	const runId = run.id;
	const self = await facts.walkerId();
	refuseMoveHere(to, { walkerId: self, deviceId: ports.device.id });
	await turns.hold(runId, async ({ runState, active }) => {
		// A Turn that holds a slot is in the middle of a step too.
		refuseUnless(
			"move",
			active ? "running" : runState.status,
			true,
			runState.end?.result,
		);
		// The plan stays: only the Walker changes. A Device that is
		// offline is the planner's refusal.
		const target = await ports.devices.target(run, actor, to);
		if (!target) throw notYourDevice();
		// The new Walker reads the run's flows: an older Night Shift may not.
		// Nor may it walk a test run: it would run every node for real.
		const has = await ports.devices.capabilities(target, run);
		const walked = {
			flowVersion: snapshotVersion(run),
			test: isTestRun(runState),
		};
		if (!walksThere(has, walked)) {
			throw new Refusal("conflict", ports.olderNightShift(target.name));
		}
		await ports.handover.keep(runId);
		turns.forget(runId);
		const moved = await facts.append({
			type: "WalkerMoved",
			runId,
			payload: { from: self, to, by: actor.personId },
		});
		await ports.handover.moved(moved);
		facts.changed(runId);
	});
}
