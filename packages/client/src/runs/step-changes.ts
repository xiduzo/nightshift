import { type ChangedFile, changedFiles } from "./changed-files";
import type { TranscriptEntry, WorktreeChangesEvent } from "./types";

/**
 * What each step of a run changed in the run's copy of the project, by
 * step id: its last `worktree-changes`, as its transcript carries it.
 */
export type StepChanges = ReadonlyMap<string, WorktreeChangesEvent>;

/** The last `worktree-changes` of `entries`: what the step changed, the latest count. */
export function lastWorktreeChanges(
	entries: readonly Pick<TranscriptEntry, "event">[],
): WorktreeChangesEvent | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const event = entries[i]?.event;
		if (event?.type === "worktree-changes") return event;
	}
	return undefined;
}

/**
 * Lays transcript entries over what each step changed: a newer
 * `worktree-changes` of a step takes the place of the one before. Returns
 * the same map when nothing changed.
 */
export function applyStepChanges(
	kept: StepChanges,
	entries: readonly Pick<TranscriptEntry, "stepId" | "event">[],
): StepChanges {
	let next: Map<string, WorktreeChangesEvent> | null = null;
	for (const { stepId, event } of entries) {
		if (event.type !== "worktree-changes") continue;
		next ??= new Map(kept);
		next.set(stepId, event);
	}
	return next ?? kept;
}

/** The files one step changed, with the lines added and removed over all of them. */
export type StepChangedFiles = {
	stepId: string;
	files: ChangedFile[];
	added: number;
	removed: number;
	/** Files left out of the list because it was too long. */
	omitted: number;
	/** Other steps ran at the same time: the list can hold their changes. */
	overlapped: boolean;
};

/**
 * The files each step changed, in the order of `stepIds`. A step that
 * changed nothing is left out. No diffs: a glance, with line counts.
 */
export function stepChangedFiles(
	changes: StepChanges,
	stepIds: readonly string[],
): StepChangedFiles[] {
	const groups: StepChangedFiles[] = [];
	for (const stepId of stepIds) {
		const event = changes.get(stepId);
		if (!event) continue;
		const omitted = event.omitted ?? 0;
		if (event.files.length === 0 && omitted === 0) continue;
		const files = changedFiles([], undefined, event);
		groups.push({
			stepId,
			files,
			added: files.reduce((sum, file) => sum + (file.lines?.added ?? 0), 0),
			removed: files.reduce((sum, file) => sum + (file.lines?.removed ?? 0), 0),
			omitted,
			overlapped: event.overlapped === true,
		});
	}
	return groups;
}

/** How many files the steps changed together: a file two steps changed counts once. */
export function changedFileCount(groups: readonly StepChangedFiles[]): number {
	return new Set(groups.flatMap((group) => group.files.map((f) => f.path)))
		.size;
}

/** "+12 −3": the lines of a change. Nothing for a file without line counts (a binary file). */
export function linesLabel(
	lines: { added: number; removed: number } | undefined,
): string | null {
	if (!lines) return null;
	return `+${lines.added} −${lines.removed}`;
}
