import type { Database } from "@nightshift/db";
import { FLOW_VERSION } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import {
	type Actor,
	commandOf,
	NIGHT_SHIFT,
	type OwnDevice,
	type PersonActor,
	permissionOf,
} from "../contract";
import type { RunWalks } from "../graph";
import { applyWalkerMoves, placedRun, type RunRow } from "../log";
import type { RunsPort } from "../peers";
import {
	olderNightShift,
	type PlacementPort,
	UNADVERTISED_FLOW_VERSION,
} from "../placement";
import { isTestRun, RunRefusal, refuseUnless } from "../run-status";
import type { Access, Walk } from "../runs";

/**
 * The move of a run to another of the Person's Devices, and the Devices it
 * can move to, as a person acts on a run (`SpaceEngine.act` hands a move
 * here through `runs/actions`). It moved out of `run/actions.ts` as it
 * was. Lane R5 of the hexagon series makes it the use cases `moveRun` and
 * `listMoveTargets` of `runs/move/`.
 *
 * On a run another Device walks, the move travels to the Walker as a
 * Command. On a run this computer walks, this computer keeps the run's
 * walk state in the archive and logs `WalkerMoved`, in a Turn. The new
 * Walker takes it over from there (`take-over.ts`).
 */

export type MovePathDeps = {
	/** Opens the run for the actor (`runs/access`). */
	openRun: Access["openRun"];
	/** The run's facts, its Turns and its Walker elsewhere (`runs/walk`). */
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	db: Database;
	archive: Pick<RunsPort, "keepWalk">;
	walks: Pick<RunWalks, "exportWalk">;
	/** This computer as a Device. */
	device: { id: string };
	/**
	 * Where the walk may move (`moveTo`: one of the Person's own Devices,
	 * online), and the Person's Devices to offer for it (`devicesFor`).
	 */
	placement: Pick<PlacementPort, "moveTo" | "devicesFor" | "deviceById">;
};

/** Which run, in which Space when the caller holds one, and the Device it moves to. */
export type MoveOnRun = { runId: string; spaceId?: string; to: string };

/** The move path: `move` as `runs/actions` takes it, and the targets the Space view lists. */
export type MovePath = ReturnType<typeof createMovePath>;

const signedOut = () =>
	new RunRefusal("signed-out", "Sign in to act on this run.");

/**
 * The newest flow format of a run's flows, as its row keeps them: the
 * format a Walker must read to walk it. A snapshot that does not read
 * counts as this build's format.
 */
function snapshotVersion(row: Pick<RunRow, "flow" | "bodyFlows">): number {
	try {
		const flow = JSON.parse(row.flow) as { version?: unknown };
		const called = Object.values(
			JSON.parse(row.bodyFlows) as Record<string, { version?: unknown }>,
		);
		const versions = [flow, ...called].map((f) =>
			typeof f?.version === "number" ? f.version : FLOW_VERSION,
		);
		return Math.max(...versions);
	} catch {
		return FLOW_VERSION;
	}
}

export function createMovePath(deps: MovePathDeps) {
	const { db } = deps;
	const { facts, turns, walkers } = deps.walk;

	/**
	 * A run moves to another of the Person's Devices while it waits, sleeps
	 * or has stopped: this computer keeps the run's walk state (its
	 * Checkpoint and its steps' files) in the archive and logs
	 * `WalkerMoved`, in a Turn (`hold`), so no answer, wake or resume comes
	 * in between. The run's plan stays: its steps run on the Devices it
	 * planned, for the same Person.
	 */
	async function here(row: RunRow, actor: PersonActor, to: string) {
		const runId = row.id;
		const self = await facts.walkerId();
		if (to === self || to === deps.device.id) {
			throw new RunRefusal(
				"walks-here",
				"This run already runs on this computer.",
			);
		}
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
			const target = await deps.placement.moveTo(placedRun(row), actor, to);
			if (!target) {
				throw new RunRefusal(
					"not-your-device",
					"That device is not one of yours.",
				);
			}
			// The new Walker reads the run's flows: an older Night Shift may not.
			// Nor may it walk a test run: it would run every node for real.
			const has = await deps.placement
				.deviceById(target.id, placedRun(row), target.name)
				.capabilities();
			if (
				(has.flowVersion ?? UNADVERTISED_FLOW_VERSION) < snapshotVersion(row) ||
				(isTestRun(runState) && has.testRuns !== true)
			) {
				throw new Refusal("conflict", olderNightShift(target.name));
			}
			await deps.archive.keepWalk(await deps.walks.exportWalk(runId));
			turns.forget(runId);
			const moved = await facts.append({
				type: "WalkerMoved",
				runId,
				payload: { from: self, to, by: actor.personId },
			});
			await applyWalkerMoves(db, [moved]);
			facts.changed(runId);
		});
	}

	return {
		/**
		 * Moves the run's walk to another of the actor's Devices. The actor's
		 * role must allow `run.move` in the run's Space, and a move needs a
		 * Person. A run another Device walks: the move travels to its Walker
		 * as a Command, once the status rule allows it.
		 */
		async move(actor: Actor, request: MoveOnRun): Promise<void> {
			const { runId: _, spaceId, ...fields } = request;
			const { run, walkedHere } = await deps.openRun(actor, {
				runId: request.runId,
				spaceId,
				need: permissionOf("move"),
			});
			if (!("personId" in actor)) throw signedOut();
			if (!walkedHere) {
				const runState = await facts.state(run.id);
				refuseUnless(
					"move",
					runState.status,
					false,
					runState.end?.result ?? null,
				);
				const command = commandOf({ kind: "move", ...fields });
				if (command) await walkers.send(run, actor, command);
				return;
			}
			return here(run, actor, fields.to);
		},

		/**
		 * The Person's own Devices the run can move to: online, and not its
		 * Walker. From the run's own Space, whichever Space the person works
		 * in. Another Person's Device takes steps through its Offers, never a
		 * walk. The run is opened as before the move path left
		 * `run/actions.ts`: in the Space, with no role read.
		 */
		async moveTargets(
			spaceId: string,
			actor: PersonActor | undefined,
			runId: string,
		): Promise<OwnDevice[]> {
			const { run: row, walkedHere } = await deps.openRun(NIGHT_SHIFT, {
				runId,
				spaceId,
			});
			if (!actor) throw signedOut();
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
