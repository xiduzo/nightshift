import { Refusal } from "@nightshift/refusal";
import type { LoggedEvent } from "../../../../log";
import type { WalkHandover } from "../../application/ports";

/** The walk state of a run on one computer: its Checkpoint, and the seqs of each step's transcript entries. */
export type WalkState = {
	checkpoint: string;
	transcripts: Record<string, readonly number[]>;
};

/**
 * The hand-over of runs' walk state in memory: this computer's walk
 * state of each run, the archive of its Space, and the Walker of each
 * run. A test puts a run's walk state here (`walkState`) or in the
 * archive (`archive`), and takes the Host away (`failNextKeep`). It
 * records each run it kept and each move it followed. Like the archive
 * of a Space, it keeps only the walk of a run this computer walks.
 */
export function inMemoryWalkHandover(here = "this-computer") {
	const walkers = new Map<string, string>();
	const arriving = new Set<string>();
	let keepFails = false;

	const lastOf = (seqs: readonly number[] | undefined) => seqs?.at(-1) ?? 0;

	const twin = {
		/** This computer's walk state of each run. */
		walkState: new Map<string, WalkState>(),
		/** The archive of the runs' Space: the walk state their Walker kept. */
		archive: new Map<string, WalkState>(),
		/** The runs `keep` kept, in order. */
		kept: [] as string[],
		/** The moves `moved` followed, in order. */
		moves: [] as LoggedEvent[],
		/** The run's Walker. Default: this computer. */
		walkerOf(runId: string): string {
			return walkers.get(runId) ?? here;
		},
		/** The next `keep` throws: the Host that keeps the Space cannot be reached. */
		failNextKeep() {
			keepFails = true;
		},
		/** This computer wrote `WalkerArrived` to the run: it arrived. */
		arrived(runId: string) {
			arriving.delete(runId);
		},

		async keep(runId: string) {
			if (keepFails) {
				keepFails = false;
				throw new Refusal(
					"unavailable",
					"The Host of this Space cannot be reached.",
				);
			}
			if (twin.walkerOf(runId) !== here) return;
			// A run that walked no step yet still has a Checkpoint.
			const state = twin.walkState.get(runId) ?? {
				checkpoint: "",
				transcripts: {},
			};
			twin.archive.set(runId, structuredClone(state));
			twin.kept.push(runId);
		},
		async moved(event: LoggedEvent) {
			if (event.type !== "WalkerMoved" || !event.runId) return;
			twin.moves.push(event);
			walkers.set(event.runId, event.payload.to);
			if (event.payload.to === here) arriving.add(event.runId);
			else arriving.delete(event.runId);
		},
		async arriving(runId: string) {
			return arriving.has(runId);
		},
		async takeCheckpoint(run: { id: string }) {
			const kept = twin.archive.get(run.id);
			if (!kept) return false;
			const own = twin.walkState.get(run.id);
			twin.walkState.set(run.id, {
				checkpoint: kept.checkpoint,
				transcripts: own?.transcripts ?? {},
			});
			return true;
		},
		async takeTranscripts(run: { id: string }) {
			const kept = twin.archive.get(run.id);
			if (!kept) return 0;
			const own = twin.walkState.get(run.id) ?? {
				checkpoint: "",
				transcripts: {},
			};
			const transcripts = { ...own.transcripts };
			let lastSeq = 0;
			for (const [stepId, seqs] of Object.entries(kept.transcripts)) {
				// A step that went on here already goes further: it stays.
				if (lastOf(transcripts[stepId]) < lastOf(seqs)) {
					transcripts[stepId] = [...seqs];
				}
				lastSeq = Math.max(lastSeq, ...seqs);
			}
			twin.walkState.set(run.id, { ...own, transcripts });
			return lastSeq;
		},
	};
	return twin satisfies WalkHandover;
}

export type InMemoryWalkHandover = ReturnType<typeof inMemoryWalkHandover>;
