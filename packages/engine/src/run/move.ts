import type { Database } from "@nightshift/db";
import type { Actor, OwnDevice, RunsPort } from "../contract";
import type { Runner, RunWalks } from "../graph";
import {
	applyWalkerMoves,
	parseTranscript,
	type RunBus,
	type RunLog,
	type RunRow,
	stepIdsOfRun,
} from "../log";
import { deriveRunState } from "../read";
import type { RunRelay } from "./relay";

/**
 * A run moves to another of the Person's Devices while it waits, sleeps or
 * has stopped: this computer keeps the run's walk state (its Checkpoint
 * and its steps' files) in the archive and logs `WalkerMoved`, in a Turn
 * of the runner (`hold`), so no answer, wake or resume comes in between.
 * The new Walker takes it over from there.
 */
export async function moveRun(
	deps: {
		db: Database;
		log: RunLog;
		bus: RunBus;
		runner: Pick<Runner, "hold" | "forget">;
		relay: RunRelay;
		archive: Pick<RunsPort, "keepWalk">;
		walks: Pick<RunWalks, "exportWalk">;
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
	await runner.hold(runId, async ({ events, active }) => {
		const status = deriveRunState(events).status;
		if (status === "running" || active) {
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
 * This computer walks a run another Device moved here (`WalkerMoved`):
 * its Checkpoint comes from the archive (this Replica's, else the Host's)
 * into the checkpoint tables, its transcript continues after the entries
 * the archive keeps, and a sleeping run gets its wake timer. A run at a
 * Gate waits for its answer here; a stopped one for a resume.
 *
 * It ends with `WalkerArrived`, in a Turn of the runner, so no answer,
 * wake or resume comes in between. Until that is in the log the run still
 * arrives: a take-over that fails, or that a restart cuts short, is done
 * again, and every step of it repeats safely. One of a run that already
 * arrived does nothing.
 */
export async function takeOver(
	deps: {
		db: Database;
		log: Pick<RunLog, "events" | "append">;
		runner: Pick<
			Runner,
			"hold" | "forget" | "restore" | "continueTranscriptAfter"
		>;
		archive: Pick<RunsPort, "archived">;
		walks: Pick<RunWalks, "importWalk" | "importTranscript">;
	},
	runId: string,
): Promise<void> {
	await deps.runner.hold(runId, async ({ row, events }) => {
		const moved = events.findLast((e) => e.type === "WalkerMoved");
		if (
			moved?.type !== "WalkerMoved" ||
			events.some((e) => e.type === "WalkerArrived" && e.seq > moved.seq)
		) {
			return;
		}
		const checkpoint = await deps.archive.archived({
			kind: "checkpoint",
			spaceId: row.spaceId,
			runId,
		});
		if (checkpoint === null) {
			throw new Error("The archive has no checkpoint of the run.");
		}
		await deps.walks.importWalk(runId, checkpoint);
		// The old Walker's transcript files are on its disk, not here: each
		// step's file starts as the archive's copy (a step reopened or
		// answered here goes on in it), and the next entry is numbered after
		// the last one the old Walker archived.
		let lastSeq = 0;
		for (const stepId of await stepIdsOfRun(deps.db, runId)) {
			const text = await deps.archive.archived({
				kind: "transcript",
				spaceId: row.spaceId,
				runId,
				stepId,
			});
			if (text === null) continue;
			await deps.walks.importTranscript(runId, stepId, text);
			for (const entry of parseTranscript(text)) {
				lastSeq = Math.max(lastSeq, entry.seq);
			}
		}
		await deps.log.append({
			type: "WalkerArrived",
			runId,
			payload: { from: moved.payload.from },
		});
		deps.runner.continueTranscriptAfter(runId, lastSeq);
		deps.runner.forget(runId);
		deps.runner.restore(runId, await deps.log.events(runId));
	});
}
