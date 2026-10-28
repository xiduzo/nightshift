import type { Device } from "../device";
import type { LoggedEvent } from "../log";
import {
	awaitsWorktree,
	gitAuthorOf,
	type RunWorktree,
	runWorktree,
} from "../read";
import type { StepContext } from "./context";

/**
 * The run's worktree when its Device was offline at the start (ADR 1,
 * decision 11). The run starts without one, and its first step that works
 * in the worktree makes it, when the run's Device is back. `WorktreeCreated`
 * is the fact: a run row is never updated, so every Replica reads the
 * worktree from the event.
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
export function withLoggedWorktree(
	ctx: StepContext,
	events: readonly LoggedEvent[],
): void {
	if (ctx.run.branch !== "") return;
	ctx.run = { ...ctx.run, ...runWorktree(ctx.run, events) };
}

/**
 * Makes the run's worktree on the run's Device, unless the run has one.
 * Logs `WorktreeCreated` and puts the worktree on `ctx.run`.
 */
export async function makeRunWorktree(
	ctx: StepContext,
	events: readonly LoggedEvent[],
): Promise<MadeWorktree | null> {
	if (!awaitsWorktree(ctx.run, events)) return null;
	const runId = ctx.run.id;
	let pending = making.get(runId);
	if (!pending) {
		pending = make(ctx).finally(() => making.delete(runId));
		making.set(runId, pending);
	}
	const made = await pending;
	if (made.kind === "made") ctx.run = { ...ctx.run, ...made.worktree };
	return made;
}

async function make(ctx: StepContext): Promise<MadeWorktree> {
	const row = ctx.run;
	const at = ctx.deviceById(row.deviceId ?? row.walkerId, row);
	if (!(await at.state()).online) return { kind: "offline", at };
	const author = row.startedBy
		? await gitAuthorOf(ctx.db, row.startedBy)
		: null;
	let worktree: RunWorktree;
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
	} catch (error) {
		return { kind: "refused", at, error };
	}
	await ctx.log.append({
		type: "WorktreeCreated",
		runId: row.id,
		payload: worktree,
	});
	return { kind: "made", worktree };
}
