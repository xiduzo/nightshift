import type { Database } from "@nightshift/db";
import {
	checkpointSnapshot,
	type LoggedEvent,
	parseTranscript,
	type RunLog,
	type RunRow,
	type RunWalker,
	readTranscriptFile,
	restoreCheckpoint,
	stepIdsOfRun,
	type TranscriptEntry,
} from "@nightshift/engine";
import type { HostRelay } from "../relay";
import {
	type ArchiveRef,
	ownStepFiles,
	readArchive,
	writeArchive,
} from "./archive";

/**
 * A run in the archive of the Replica that keeps its Space (this one, or
 * its Host): what moves with a run to a new Walker, what the new Walker
 * takes from it, and the transcripts of steps walked elsewhere.
 */
export type RunArchiveDeps = {
	db: Database;
	dataDir: string;
	log: Pick<RunLog, "walkerId">;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	relay?: Pick<HostRelay, "archive" | "archivePut">;
};

export type RunArchive = ReturnType<typeof createRunArchive>;

export function createRunArchive(deps: RunArchiveDeps) {
	const { db, dataDir, relay } = deps;

	/**
	 * What a new Walker needs of a run this computer walks: its latest
	 * checkpoint and its steps' transcripts and command logs, in the archive
	 * of the Replica that keeps the Space (this one, or its Host).
	 */
	async function archiveForMove(row: RunRow): Promise<void> {
		const keptHere = (await deps.hostOf(row.spaceId)) === null;
		const put = async (ref: ArchiveRef, content: string) => {
			if (keptHere) await writeArchive(dataDir, ref, content);
			else if (relay) await relay.archivePut(ref, content);
			else
				throw new Error("This computer cannot reach the Host of this Space.");
		};
		const self = await deps.log.walkerId();
		for (const stepId of await stepIdsOfRun(db, row.id)) {
			const files = await ownStepFiles(db, dataDir, stepId, self);
			if (!files) continue;
			const at = { spaceId: row.spaceId, runId: row.id, stepId };
			if (files.transcript !== null) {
				await put({ kind: "transcript", ...at }, files.transcript);
			}
			if (files.log !== null) await put({ kind: "log", ...at }, files.log);
		}
		await put(
			{ kind: "checkpoint", spaceId: row.spaceId, runId: row.id },
			await checkpointSnapshot(db, row.id),
		);
	}

	/**
	 * The checkpoint of a run another Device moved here, from the archive
	 * (this Replica's, else the Host's), into the checkpoint tables.
	 */
	async function restoreMoved(row: RunRow): Promise<void> {
		const ref: ArchiveRef = {
			kind: "checkpoint",
			spaceId: row.spaceId,
			runId: row.id,
		};
		const snapshot =
			(await readArchive(dataDir, ref)) ??
			(relay ? await relay.archive(ref) : null);
		if (snapshot === null) {
			throw new Error("The archive has no checkpoint of the run.");
		}
		await restoreCheckpoint(db, snapshot);
	}

	/**
	 * A step's transcript: this Replica's own file, or for a run walked
	 * elsewhere the archive's copy, fetched from the Host when this
	 * Replica lacks it. A copy is kept once the step has ended.
	 */
	async function stepTranscript(
		row: { id: string; runId: string; spaceId: string; transcriptPath: string },
		walker: RunWalker,
		ended: boolean,
	): Promise<TranscriptEntry[]> {
		if (walker.thisDevice) {
			// A step of a run walked here before it moved here is in the archive.
			const own = await readTranscriptFile(row.transcriptPath);
			if (own.length > 0 || !ended) return own;
		}
		const ref: ArchiveRef = {
			kind: "transcript",
			spaceId: row.spaceId,
			runId: row.runId,
			stepId: row.id,
		};
		let text = await readArchive(dataDir, ref);
		if (text === null && relay) {
			text = await relay.archive(ref).catch(() => null);
			if (text !== null && ended) await writeArchive(dataDir, ref, text);
		}
		return text === null ? [] : parseTranscript(text);
	}

	return { archiveForMove, restoreMoved, stepTranscript };
}

/** The runs that new events moved to this computer (`WalkerMoved` to one of its ids). */
export function runsMovedHere(
	added: readonly LoggedEvent[],
	here: readonly string[],
): string[] {
	const runIds: string[] = [];
	for (const e of added) {
		if (e.type !== "WalkerMoved" || !e.runId) continue;
		if (!here.includes(e.payload.to)) continue;
		runIds.push(e.runId);
	}
	return runIds;
}
