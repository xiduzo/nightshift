import type { Database } from "@nightshift/db";
import { step } from "@nightshift/db/schema";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import {
	openTranscriptWriter,
	type RunBus,
	type RunLog,
	readRunTranscript,
	type StepEvent,
	type TranscriptEntry,
} from "../../log";

/**
 * The transcript recorders of this computer's runs: one writer per step,
 * with one seq counter per run. The step runner opens one for each step
 * (`StepShared.recorders`), and the runner opens one for the wake of a
 * sleep.
 */

/** A step's transcript writer. Each entry is on disk, then on the bus, then returned. */
export type Recorder = {
	record(sessionId: string | null, event: StepEvent): TranscriptEntry;
	close(): void;
};

/**
 * Transcript recorders with one seq counter per run, shared by every step
 * of the run (ported from `openRecorder` and `lastSeqOf`). The runner makes
 * one per daemon and binds `StepContext.recorder` to the run.
 */
export type Recorders = ReturnType<typeof createRecorders>;

export function createRecorders(input: {
	db: Database;
	bus: RunBus;
	/** Names the files of a run's steps on this computer. */
	log: Pick<RunLog, "files">;
}) {
	const { db, bus, log } = input;
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();
	/** The last seq another Walker wrote of a run moved here: its files are not on this disk. */
	const movedSeqs = new Map<string, number>();

	async function lastSeqOf(runId: string): Promise<number> {
		const known = lastSeqs.get(runId);
		if (known !== undefined) return known;
		const rows = await db
			.select({ id: step.id, transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.runId, runId));
		const entries = await readRunTranscript(
			rows.map((r) =>
				log.files(runId).transcriptToRead(r.id, r.transcriptPath),
			),
		);
		const last = entries.at(-1)?.seq ?? 0;
		// A step of this run may have written meanwhile; keep the larger.
		const current = Math.max(
			last,
			lastSeqs.get(runId) ?? 0,
			movedSeqs.get(runId) ?? 0,
		);
		lastSeqs.set(runId, current);
		movedSeqs.delete(runId);
		return current;
	}

	return {
		/**
		 * A run another Device walked until now: its next entry comes after
		 * `seq`, the last one that Device wrote. A seq known here already
		 * (the run walked here before) is kept when it is larger.
		 */
		continueAfter(runId: string, seq: number): void {
			const known = lastSeqs.get(runId);
			if (known !== undefined) lastSeqs.set(runId, Math.max(known, seq));
			else movedSeqs.set(runId, Math.max(movedSeqs.get(runId) ?? 0, seq));
		},
		async open(runId: string, stepId: string): Promise<Recorder> {
			await lastSeqOf(runId);
			const writer = openTranscriptWriter(log.files(runId).transcript(stepId));
			return {
				record(sessionId, stepEvent) {
					const seq = (lastSeqs.get(runId) ?? 0) + 1;
					lastSeqs.set(runId, seq);
					const entry: TranscriptEntry = {
						seq,
						stepId,
						sessionId,
						at: now(),
						event: stepEvent,
					};
					// On disk first, then on the bus: watchRun depends on this order.
					writer.append(entry);
					bus.publish(runId, { kind: "transcript", entry });
					return entry;
				},
				close: () => writer.close(),
			};
		},
	};
}
