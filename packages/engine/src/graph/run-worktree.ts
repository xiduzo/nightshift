import type { TemplateContext } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Device, RunFolder, RunRef } from "../device";
import type { RunRow, RunState } from "../log";
import { awaitsWorktree, type RunWorktree, runWorktree } from "../read";
import { noRunFolders } from "../run-folders";
import type { StepContext } from "./context";

/**
 * The run's worktree when its Device was offline at the start (ADR 1,
 * decision 11). The run starts without one, and its first step that works
 * in the worktree makes it, when the run's Device is back. `WorktreeCreated`
 * is the fact: a run row is never updated, so every Replica reads the
 * worktree from the event.
 *
 * A run of a project without a folder (ADR 22) has a run folder instead:
 * one on each Device that runs a step that works in a folder, made when
 * that step starts there (`readyRunFolder`). It does not move: no
 * Hand-off. `WorktreeCreated` names the folder on the run's Device only,
 * with no branch and no base.
 */

/** What making the worktree did: made, the run's Device is still offline, or it refused. */
export type MadeWorktree =
	| { kind: "made"; worktree: RunWorktree }
	| { kind: "offline"; at: Device }
	| { kind: "refused"; at: Device; error: unknown };

/** The worktrees being made, by run: two branches of a run make it once. */
const making = new Map<string, Promise<MadeWorktree>>();

/**
 * The run as the log has it: a step reads the worktree another step made
 * after the run's row was read. Keeps the row when it has its worktree.
 */
export function withLoggedWorktree(ctx: StepContext, runState: RunState): void {
	if (ctx.run.branch !== "") return;
	ctx.run = { ...ctx.run, ...runWorktree(ctx.run, runState) };
}

/**
 * Makes the run's worktree on the run's Device, unless the run has one.
 * Logs `WorktreeCreated` and puts the worktree on `ctx.run`.
 */
export async function makeRunWorktree(
	ctx: StepContext,
	runState: RunState,
): Promise<MadeWorktree | null> {
	if (!awaitsWorktree(ctx.run, runState)) return null;
	const runId = ctx.run.id;
	let pending = making.get(runId);
	if (!pending) {
		pending = make(ctx, runState).finally(() => making.delete(runId));
		making.set(runId, pending);
	}
	const made = await pending;
	if (made.kind === "made") ctx.run = { ...ctx.run, ...made.worktree };
	return made;
}

/** The run's own folder on `device`; refused by a Device that makes none. */
export async function runFolderOn(
	device: Device,
	run: RunRef,
): Promise<RunFolder> {
	if (!device.runFolder) {
		throw new Refusal("conflict", noRunFolders(device.name));
	}
	return device.runFolder({ id: run.id, projectId: run.projectId });
}

/** The run's Device: where its worktree, or its first run folder, is. */
function runDeviceOf(ctx: StepContext, row: RunRow): Device {
	return ctx.placement.deviceById(row.deviceId ?? row.walkerId, row);
}

async function make(
	ctx: StepContext,
	runState: RunState,
): Promise<MadeWorktree> {
	const row = ctx.run;
	const at = runDeviceOf(ctx, row);
	if (!(await at.state()).online) return { kind: "offline", at };
	if (runState.runFolder) {
		try {
			const { worktreePath } = await runFolderOn(at, row);
			return created(ctx, { worktreePath, branch: "", baseRef: "" });
		} catch (error) {
			return { kind: "refused", at, error };
		}
	}
	const author = row.startedBy ? await ctx.gitAuthor(row.startedBy) : null;
	let worktree: RunWorktree;
	let warning: string | undefined;
	try {
		const made = await at.worktree({
			id: row.id,
			projectId: row.projectId,
			// The row keeps the base the person asked for until the worktree has one.
			...(row.baseRef !== "" ? { baseRef: row.baseRef } : {}),
			...(author ? { author } : {}),
		});
		worktree = {
			worktreePath: made.worktreePath,
			branch: made.branch,
			baseRef: made.baseRef,
		};
		warning = made.warning;
	} catch (error) {
		return { kind: "refused", at, error };
	}
	return created(ctx, worktree, warning);
}

/** Logs the run's worktree (`WorktreeCreated`), and why it does not start from the newest commit. */
async function created(
	ctx: StepContext,
	worktree: RunWorktree,
	warning?: string,
): Promise<MadeWorktree> {
	const runId = ctx.run.id;
	await ctx.log.append({ type: "WorktreeCreated", runId, payload: worktree });
	if (warning) {
		await ctx.log.append({
			type: "RunWarned",
			runId,
			payload: { kind: "base-ref", message: warning },
		});
	}
	return { kind: "made", worktree };
}

/** What a step that works in a folder has of it: its Device, and where it works. */
export type FolderStep = {
	device: Device;
	worktree: string;
	tctx: TemplateContext;
};

/**
 * Readies the run folder of a step that works in a folder (ADR 22), on the
 * step's Device: makes it when it is not there, and has the step work in
 * it (`{{run.worktree}}` too). No Hand-off: each Device has its own folder.
 * On the run's Device, the first folder is logged (`WorktreeCreated`), and
 * a folder made again because it was gone logs a warning: its files are
 * lost. Null when the step can work there.
 */
export async function readyRunFolder(
	ctx: StepContext,
	step: FolderStep,
	runState: RunState,
): Promise<Exclude<MadeWorktree, { kind: "made" }> | null> {
	const { device } = step;
	const onRunDevice = runDeviceOf(ctx, ctx.run).id === device.id;
	if (onRunDevice) {
		const made = await makeRunWorktree(ctx, runState);
		if (made && made.kind !== "made") return made;
	}
	let folder: RunFolder;
	try {
		folder = await runFolderOn(device, ctx.run);
	} catch (error) {
		return { kind: "refused", at: device, error };
	}
	if (onRunDevice && folder.made) {
		await ctx.log.append({
			type: "RunWarned",
			runId: ctx.run.id,
			payload: {
				kind: "base-ref",
				message: `The folder of this run on ${device.name} was gone. Night Shift made a new, empty one.`,
			},
		});
	}
	step.worktree = folder.worktreePath;
	step.tctx.run.worktree = folder.worktreePath;
	return null;
}
