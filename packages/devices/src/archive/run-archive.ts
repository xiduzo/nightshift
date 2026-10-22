import {
	type LoggedEvent,
	parseTranscript,
	type RunWalker,
	readTranscriptFile,
	type TranscriptEntry,
	type WalkFile,
	type WalkRef,
} from "@nightshift/engine";
import type { ArchiveRef, HostRelay } from "../contract";
import { readArchive, writeArchive } from "./archive";

/**
 * A run in the archive of the Replica that keeps its Space (this one, or
 * its Host): the walk files a run takes to a new Walker, and the
 * transcripts of steps walked elsewhere. The engine writes and reads the
 * files. The archive only keeps and carries them.
 */
export type RunArchiveDeps = {
	dataDir: string;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	relay?: Pick<HostRelay, "archive" | "archivePut">;
};

export type RunArchive = ReturnType<typeof createRunArchive>;

export function createRunArchive(deps: RunArchiveDeps) {
	const { dataDir, relay } = deps;

	/**
	 * Keeps a run's walk files in the archive of the Replica that keeps
	 * its Space: this one, or its Host. Throws when that Host cannot be
	 * reached.
	 */
	async function keepWalk(files: readonly WalkFile[]): Promise<void> {
		for (const { ref, content } of files) {
			if ((await deps.hostOf(ref.spaceId)) === null) {
				await writeArchive(dataDir, ref, content);
			} else if (relay) await relay.archivePut(ref, content);
			else {
				throw new Error("This computer cannot reach the Host of this Space.");
			}
		}
	}

	/** A file of the archive: this Replica's copy, else its Host's. Null when neither has it. */
	async function archived(ref: WalkRef): Promise<string | null> {
		return (
			(await readArchive(dataDir, ref)) ??
			(relay ? await relay.archive(ref) : null)
		);
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

	return { keepWalk, archived, stepTranscript };
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
