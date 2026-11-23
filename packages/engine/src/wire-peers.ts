import type { Database } from "@nightshift/db";
import type { RowBatch } from "./contract";
import { wireCopies } from "./device-config";
import { deviceDocumentName, documentRowDelete } from "./documents";
import type { EngineOptions } from "./engine-options";
import type { createRunWalks } from "./graph";
import { adoptLeaseRows } from "./leases";
import {
	adoptWalkerRows,
	copyStamps,
	type createLandedFeed,
	type createRunHistory,
	type RunLog,
} from "./log";
import type { DeviceRows, PeerContext, PeerProjects } from "./peers";
import { landedFacts } from "./read";

/** The statements of a Device's Clones (`ProjectStore` of `projects/keep`). They read nothing. */
type CloneRows = {
	forget(deviceId: string): RowBatch;
	adopt(from: string, to: string): RowBatch;
};

/**
 * The peers block of the engine's composition (`wire.ts`): the other
 * Devices and Hosts (`Peers`, which `EngineOptions.peers` makes): where
 * steps run, Offers, the Host that keeps a Space, and the runs walked
 * elsewhere. The peers are made before the pieces they call, so those
 * come as functions that `wire.ts` reads when they are called.
 *
 * It gives `peers`.
 */
export function wireEnginePeers(deps: {
	db: Database;
	log: RunLog;
	options: Pick<EngineOptions, "peers" | "profileFor">;
	device: PeerContext["device"];
	ownerId(): string | null;
	/** Settles as the engine's `ready` does. */
	ready: Promise<void>;
	now(): number;
	documents: PeerContext["documents"];
	history: ReturnType<typeof createRunHistory>;
	landed: Pick<ReturnType<typeof createLandedFeed>, "subscribe">;
	walks: Pick<ReturnType<typeof createRunWalks>, "exportWalk" | "ownFile">;
	runFolders: PeerContext["runFolders"];
	/** The Projects, made after the peers: the Projects record a Clone through the peers' relay. */
	projects(): PeerProjects;
	/** The statements of a Device's Clones (`projects/keep`), made after the peers. */
	cloneRows(): CloneRows;
	flows: PeerContext["flows"];
	/** The other end of a move (`move.arrive`, R5). */
	takeOver: PeerContext["runs"]["takeOver"];
	/** The stop of a run by Night Shift (`recovery.stopForNightShift`, R7). */
	stop: PeerContext["runs"]["stop"];
}) {
	const { db, log: runLog, history, landed, walks } = deps;
	const copies = wireCopies({ db });
	const projects = deps.projects;
	return deps.options.peers({
		device: deps.device,
		walkerId: () => runLog.walkerId(),
		ownerId: deps.ownerId,
		ready: deps.ready,
		now: deps.now,
		documents: deps.documents,
		projects: {
			find: (projectId, spaceId) => projects().find(projectId, spaceId),
			ofSpace: (spaceId) => projects().ofSpace(spaceId),
			matching: (input) => projects().matching(input),
			clones: (spaceId, projectId) => projects().clones(spaceId, projectId),
			clonePath: (projectId, spaceId) =>
				projects().clonePath(projectId, spaceId),
			recordClone: (spaceId, record) => projects().recordClone(spaceId, record),
			setClones: (spaceId, input) => projects().setClones(spaceId, input),
			clonedHere: (spaceId) => projects().clonedHere(spaceId),
			forgetDevice: (deviceId) => projects().forgetDevice(deviceId),
			addFromRemote: (spaceId, input) =>
				projects().addFromRemote(spaceId, input),
			defineWithoutFolder: (spaceId, input) =>
				projects().defineWithoutFolder(spaceId, input),
			take: (spaceId, taken) => projects().take(spaceId, taken),
			spaceOf: (projectId) => projects().spaceOf(projectId),
		},
		runFolders: deps.runFolders,
		flows: deps.flows,
		profiles: {
			here: deps.options.profileFor ?? (() => null),

			lastKnown: (deviceId) => copies.readLastKnownProfiles({ deviceId }),
		},
		keptDevice: (deviceId) => copies.readKeptDeviceCopy({ deviceId }),
		history: {
			...history,
			onLanded: (listener, scope) =>
				landed.subscribe((events) => {
					if (landedFacts(events).some((f) => f.changes !== "spend")) {
						listener();
					}
				}, scope),
		},
		runs: {
			exportWalk: walks.exportWalk,
			ownFile: walks.ownFile,
			// Every open step's reader asks on each change of the run: the run
			// log derives the stamps once per append for all of them.
			stepStamp: async ({ runId, stepId }) =>
				(await runLog.derive([runId], copyStamps)).get(runId)?.get(stepId) ??
				null,
			takeOver: deps.takeOver,
			// The Offer the run's step ran under ended: Night Shift stops it, not a person.
			stop: deps.stop,
		},
		async logFact(fact, writes) {
			await runLog.append(fact, writes);
		},
		deviceRows: deviceRowsOf(db, () => deps.cloneRows()),
	});
}

/**
 * The engine's rows of a Device on this database (`PeerContext.deviceRows`):
 * the Clones (`projects`), the Device document (`documents`), the runs,
 * steps and events (`log`) and the leases (`leases`). The statements leave
 * as the opaque batch the port names (G2).
 */
export function deviceRowsOf(
	db: Database,
	clones: () => CloneRows,
): DeviceRows {
	return {
		forget: (deviceId) =>
			[
				...clones().forget(deviceId),
				documentRowDelete(db, deviceDocumentName(deviceId)),
			] as unknown as RowBatch,
		adopt: (move) =>
			[
				...clones().adopt(move.from, move.to),
				...adoptWalkerRows(db, move),
				adoptLeaseRows(db, move.from, move.to),
			] as unknown as RowBatch,
	};
}
