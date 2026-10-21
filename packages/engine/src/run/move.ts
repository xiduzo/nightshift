import type { Database } from "@nightshift/db";
import type { Actor, OwnDevice, RunsPort } from "../contract";
import type { Runner } from "../graph";
import {
	applyWalkerMoves,
	getRunRow,
	type RunBus,
	type RunLog,
	type RunRow,
} from "../log";
import { deriveRunState } from "../read";
import type { RunRelay } from "./relay";

/**
 * A run moves to another of the Person's Devices while it waits, sleeps or
 * has stopped: this computer puts its checkpoint and step files in the
 * archive and logs `WalkerMoved`; the new Walker takes it over from there.
 */
export async function moveRun(
	deps: {
		db: Database;
		log: RunLog;
		bus: RunBus;
		runner: Pick<Runner, "exclusive" | "isActive" | "forget">;
		relay: RunRelay;
		archive: Pick<RunsPort, "archiveForMove">;
		device: { id: string };
		/** This computer's owner as the Host that keeps the Space knows them (`Peers.personOnHost`). */
		personOnHost(spaceId: string): Promise<string | null>;
		/** The Person's own Devices that a run of the project can move to. */
		ownDevices(
			spaceId: string,
			personId: string,
			projectId: string,
		): Promise<OwnDevice[]>;
	},
	row: RunRow,
	actor: Actor | undefined,
	to: string,
): Promise<void> {
	const { db, log, bus, runner, relay } = deps;
	const runId = row.id;
	if (!actor) throw new Error("Sign in to move a run.");
	if (await relay.walkedElsewhere(row)) {
		await relay.send(row, actor, { kind: "run.move", payload: { to } });
		return;
	}
	const self = await log.walkerId();
	if (to === self || to === deps.device.id) {
		throw new Error("This computer walks the run already.");
	}
	await runner.exclusive(runId, async () => {
		const events = await log.events(runId);
		const status = deriveRunState(events).status;
		if (status === "running" || runner.isActive(runId)) {
			throw new Error(
				"The run is in the middle of a step. Move it when it waits, sleeps or has stopped.",
			);
		}
		if (status === "finished") {
			throw new Error("The run has ended. There is nothing to move.");
		}
		const personId = (await deps.personOnHost(row.spaceId)) ?? actor.personId;
		const target = (
			await deps.ownDevices(row.spaceId, personId, row.projectId)
		).find((d) => d.deviceId === to);
		if (!target || target.thisDevice) {
			throw new Error("That device is not one of yours.");
		}
		if (!target.online) {
			throw new Error(
				`${target.name} is offline. Move the run when it is online.`,
			);
		}
		await deps.archive.archiveForMove(row);
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
 * This computer walks a run another Device moved here (`WalkerMoved`):
 * its checkpoint comes from the archive (this Replica's, else the Host's)
 * into the checkpoint tables, and a sleeping run gets its wake timer. A
 * run at a Gate waits for its answer here; a stopped one for a resume.
 */
export async function takeOver(
	deps: {
		db: Database;
		log: Pick<RunLog, "events">;
		runner: Pick<Runner, "forget" | "sleeps">;
		archive: Pick<RunsPort, "restoreMoved">;
	},
	runId: string,
): Promise<void> {
	const row = await getRunRow(deps.db, runId);
	await deps.archive.restoreMoved(row);
	deps.runner.forget(runId);
	deps.runner.sleeps.restore(runId, await deps.log.events(runId));
}
