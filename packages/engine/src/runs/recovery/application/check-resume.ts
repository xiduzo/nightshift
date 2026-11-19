import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import type { RunRow, RunState } from "../../../log";
import type { awaitsWorktree, runWorktree } from "../../../read";
import type { Access } from "../../access";
import { type ResumeSettings, resumeBlock } from "../domain/resume-block";
import type { Workplaces } from "./ports";

export type CheckResumePorts = {
	/** Opens the run as Night Shift: its row, or not found. */
	openRun: Access["openRun"];
	workplaces: Workplaces;
	/** False when the engine was made with `scheduler: false`: a dev daemon. */
	schedulerOn: boolean;
	settings(): ResumeSettings;
	now(): number;
	/** The run's flow, from its snapshot. */
	flowOf(row: RunRow): Flow;
	/** Whether the run's steps run on another Device. Without it: every run's are on this computer. */
	placedElsewhere?(row: RunRow): boolean;
	/** Where the run's worktree is, from its row and its log (`read`). */
	worktreeOf: typeof runWorktree;
	/** Whether the run waits for its worktree (`read`). */
	awaitsWorktree: typeof awaitsWorktree;
};

/**
 * Why Night Shift must not continue an interrupted run on its own, or
 * null (`resumeBlock`). It reads the run's record as Night Shift, and the
 * folder of its worktree, only when the rule comes to them. Startup
 * recovery and the resume after the grace both ask it.
 */
export const checkResume =
	(ports: CheckResumePorts) =>
	(runId: string, runState: RunState): Promise<string | null> =>
		resumeBlock({
			schedulerOn: ports.schedulerOn,
			settings: ports.settings,
			now: ports.now,
			run: runState,
			async record() {
				const row = await ports.openRun(NIGHT_SHIFT, { runId }).then(
					({ run }) => run,
					(error: unknown) => {
						if (error instanceof Refusal && error.kind === "not-found") {
							return null;
						}
						throw error;
					},
				);
				if (!row) return null;
				return {
					ownResume: () => ports.flowOf(row).policy?.resumeInterruptedRuns,
					placedElsewhere: () => ports.placedElsewhere?.(row) ?? false,
					awaitsWorktree: () => ports.awaitsWorktree(row, runState),
					worktreeThere: () =>
						ports.workplaces.there(
							ports.worktreeOf(row, runState).worktreePath,
						),
				};
			},
		});
