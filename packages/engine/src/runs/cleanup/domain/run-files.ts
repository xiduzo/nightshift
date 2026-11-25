import { Refusal } from "@nightshift/refusal";
import { instant } from "@nightshift/time";
import type { RunStatus } from "../../../run-status";

/**
 * The files a run of a project without a folder left in its run folder on
 * this computer (ADR 22), and when they go. There is no git, so nothing
 * tells what is safe to keep: the sweep removes the folder of a run that
 * ended `cleanUpAfterDays` ago, whatever is in it. It never touches a run
 * that is still open, nor one that only another version can continue
 * (`keepsWork`). A folder of a run this computer does not know (the
 * folder of a step it ran for another Person's run) goes `cleanUpAfterDays`
 * after its last change. Each Device sweeps its own folders. Each removal
 * of a run this computer knows is logged as `WorktreeRemoved`.
 */

/** A file a run left in its folder (`RunFile` of `run-folders/`). */
export type RunFile = {
	/** Its path in the run's folder, with `/` between folders: `report/summary.md`. */
	path: string;
	size: number;
	/** When it last changed. */
	modifiedAt: number;
};

/** The files of a run in its run folder on this computer. */
export type RunFiles = {
	/** The run works in a run folder, and its folder is on this computer. */
	here: boolean;
	/** By path. Empty for a run that works in a copy of the project. */
	files: RunFile[];
	/** The folder holds more entries than the list shows. */
	more: boolean;
	/** When the scheduled cleanup removes the folder. Null when it never will on its own: the run goes on, or the cleanup is off. */
	cleanupAt: number | null;
	/** When this computer removed the folder, and who. Null while it is here. */
	removed: { at: number; by: "person" | "cleanup" } | null;
};

/** The answer for a run without a folder here. */
export const NO_FILES: RunFiles = {
	here: false,
	files: [],
	more: false,
	cleanupAt: null,
	removed: null,
};

/** Whether a run with this status is still open: at work, waiting at a Gate, or asleep. */
export function isOpenStatus(status: RunStatus): boolean {
	return status === "running" || status === "waiting" || status === "sleeping";
}

/**
 * Whether nothing removes the work of a run with this status: the run is
 * open, or Night Shift cut it short and cannot continue it, because this
 * version cannot read its flow. A version that reads it continues it.
 */
export async function keepsWork(
	runId: string,
	status: RunStatus,
	reads: { flowUnread(runId: string): Promise<boolean> },
): Promise<boolean> {
	return (
		isOpenStatus(status) ||
		(status === "interrupted" && (await reads.flowUnread(runId)))
	);
}

/** A run this computer knows: what the cleanup reads of it. */
export type KnownRun = {
	id: string;
	projectId: string;
	createdAt: number;
	endedAt: number | null;
	/** It goes on, or this version cannot continue it (`keepsWork`): nothing removes its folder. */
	keeps: boolean;
	runFolder: boolean;
};

/** What `knownRun` reads of a run: its row, then its state and whether its flow reads, and whether a step of it is at work here. */
export type KnownRunReads = {
	/** The run's row. Refuses (`not-found`) a run this computer does not know. */
	runRow(runId: string): Promise<{ projectId: string; createdAt: Date }>;
	runState(runId: string): Promise<{
		status: RunStatus;
		end: { at: number } | null;
		runFolder: boolean;
	}>;
	flowUnread(runId: string): Promise<boolean>;
	isActive(runId: string): boolean;
};

/** The run as this computer knows it, or null when it knows none of that id. */
export async function knownRun(
	runId: string,
	reads: KnownRunReads,
): Promise<KnownRun | null> {
	let row: { projectId: string; createdAt: Date };
	try {
		row = await reads.runRow(runId);
	} catch (error) {
		if (error instanceof Refusal && error.kind === "not-found") return null;
		throw error;
	}
	const state = await reads.runState(runId);
	return {
		id: runId,
		projectId: row.projectId,
		createdAt: instant(row.createdAt),
		endedAt: state.end?.at ?? null,
		keeps:
			reads.isActive(runId) || (await keepsWork(runId, state.status, reads)),
		runFolder: state.runFolder,
	};
}
