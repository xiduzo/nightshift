import type { WorktreeChangesEvent } from "@/shared/api";
import type { TranscriptItem, WaitReason } from "./transcript-items";

/** The transcript of one step. */
export type TranscriptState = {
	items: TranscriptItem[];
	/** Item key to index in `items`. */
	index: Map<string, number>;
	/** When the last entry came: where the next thought begins. */
	lastAt?: number;
	/** The key of the thought still streaming, if the last entry was one. */
	openThought?: string;
	/**
	 * Every file the step changed in the run's copy of the project, also by
	 * commands: its last `worktree-changes`. Absent when Night Shift could
	 * not tell.
	 */
	changes?: WorktreeChangesEvent;
};

export const emptyTranscript: TranscriptState = {
	items: [],
	index: new Map(),
};

/** The wait the run is in, if the latest wait has no wake after it. */
export type CurrentWait = {
	stepId: string;
	reason: WaitReason;
	until: number | null;
	message: string;
	/** The signal a Wait node waits for. */
	signal?: string;
	at: number;
};

/** The transcripts of a run, by step id. */
export type RunTranscript = {
	steps: ReadonlyMap<string, TranscriptState>;
	/** Highest seq folded so far; -1 when empty. */
	lastSeq: number;
	lastWait: CurrentWait | null;
};

export const emptyRunTranscript: RunTranscript = {
	steps: new Map(),
	lastSeq: -1,
	lastWait: null,
};
