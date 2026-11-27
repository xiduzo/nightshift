import type { FlowNode } from "@nightshift/flows";
import type { Device } from "../../device";
import type { HandOffFailure, RunState } from "../../log";
import { deriveWorktrees } from "../../read";
import { type StepContext, stepFailure } from "../context";
import {
	makeRunWorktree,
	readyRunFolder,
	restoreRunCopy,
} from "./run-worktree";
import type { BodyResult, OpenStep } from "./step-handle";

/**
 * The Device a step works on, before its body runs (`readyDevice`): the
 * move to a backup, the worktree or the folder of the run there, and the
 * Hand-off of the work of the run.
 */

/** Whether a Device id the log names is `device` (this computer has two ids: its own and the Walker's). */
function isDevice(ctx: StepContext, id: string, device: Device): boolean {
	return ctx.placement.deviceById(id, ctx.run).id === device.id;
}

/** The run's worktree on `device`, from the log, or null when the run has none there. */
export function worktreeOn(
	ctx: StepContext,
	runState: RunState,
	device: Device,
): string | null {
	for (const [id, path] of deriveWorktrees(runState, ctx.run).paths) {
		if (isDevice(ctx, id, device)) return path;
	}
	return null;
}

/**
 * What a step's Device must be before the body runs, or null when it is
 * ready. A step that needs a computer (`NodeKind.works`) moves to a
 * fallback that can take it (`StepPlacement.moveStep`, ADR 17), else
 * sleeps while its Device is offline (`device-offline`). A step that works in the worktree
 * of a run that has none yet (its Device was offline at the start) makes
 * it on the run's Device first, and sleeps while that Device is offline.
 * A step that works in the worktree on another Device than the one that has the
 * run's work gets it by a Hand-off first: the Device that has it pushes
 * the branch (a worktree with uncommitted changes fails the step: nothing
 * is committed for you), this one fetches it into its own worktree of the
 * run, and the Walker logs `HandedOff`. When the copy on the Device that
 * has the work is gone (the cleanup removes it a day after the run
 * ended), that Device makes it again first (`restoreRunCopy`, ADR 28).
 * A step that follows the work
 * (`NodeKind.followsWork`) needs none: `beginStep` placed it on the Device
 * that has the work, and it sleeps while that Device is offline. A run of
 * a project without a folder has no Hand-off: the step works in the run
 * folder of its own Device (`readyRunFolder`, ADR 22).
 */
export async function readyDevice(
	ctx: StepContext,
	node: FlowNode,
	step: OpenStep,
): Promise<BodyResult | null> {
	const works = ctx.kindOf(node).works(node);
	if (works === null) return null;
	const offline = (at: Device): BodyResult => ({
		kind: "offline",
		reason: "device-offline",
		deviceId: at.id,
		name: at.name,
	});
	if (!(await step.device.state()).online) {
		const moved = await ctx.placement.moveStep({
			log: ctx.log,
			node,
			run: ctx.run,
			stepId: step.stepId,
			from: step.device,
			hasSession: (step.existing?.sessions.length ?? 0) > 0,
			inWorktree: works === "worktree",
		});
		if (!moved) return offline(step.device);
		step.device = moved;
	}
	if (works !== "worktree") return null;
	const fail = (error: string, handOffFailed?: HandOffFailure): BodyResult => ({
		kind: "end",
		outcome: "error",
		outputs: { visit: step.visit },
		error,
		...(handOffFailed ? { handOffFailed } : {}),
	});
	const { device } = step;
	let runState = await ctx.log.state(ctx.run.id);
	if (runState.runFolder) {
		const notReady = await readyRunFolder(ctx, step, runState);
		if (notReady?.kind === "offline") return offline(notReady.at);
		if (notReady?.kind === "refused") {
			return fail(
				`${notReady.at.name} could not make the run's folder. ${stepFailure(notReady.error, `the run folder of run ${ctx.run.id}`)}`,
			);
		}
		return null;
	}
	const made = await makeRunWorktree(ctx, runState);
	if (made?.kind === "offline") return offline(made.at);
	if (made?.kind === "refused") {
		return fail(
			`${made.at.name} could not make the run's copy of the project. ${stepFailure(made.error, `the worktree of run ${ctx.run.id}`)}`,
		);
	}
	if (made?.kind === "made") {
		runState = await ctx.log.state(ctx.run.id);
		step.tctx.run.worktree = made.worktree.worktreePath;
		step.tctx.run.base_ref = made.worktree.baseRef;
		if (step.tctx.run.branch === "")
			step.tctx.run.branch = made.worktree.branch;
	}
	const { holder, paths } = deriveWorktrees(runState, ctx.run);
	// A resume or a rerun after the cleanup: the copy that has the work is made again first.
	const notBack = (at: Device, error: unknown): BodyResult =>
		fail(
			`${at.name} could not make the run's copy of the project again. ${stepFailure(error, `the worktree of run ${ctx.run.id}`)}`,
		);
	if (isDevice(ctx, holder, device)) {
		const cwd = paths.get(holder) ?? step.worktree;
		const back = await restoreRunCopy(ctx, device, cwd, runState);
		if (back.kind === "refused") return notBack(device, back.error);
		step.worktree = back.kind === "made" ? back.worktreePath : cwd;
		return null;
	}
	const from = ctx.placement.deviceById(holder, ctx.run);
	if (!(await from.state()).online) return offline(from);
	const cwd = paths.get(holder) ?? ctx.run.worktreePath;
	const back = await restoreRunCopy(ctx, from, cwd, runState);
	if (back.kind === "refused") return notBack(from, back.error);
	let sent: { commit: string; branch: string };
	try {
		sent = await from.handOff({
			cwd: back.kind === "made" ? back.worktreePath : cwd,
			runBranch: ctx.run.branch,
		});
	} catch (error) {
		return fail(
			`The run's work on ${from.name} cannot move to ${device.name}. ${stepFailure(error, `the hand-off of run ${ctx.run.id}`)}`,
			"send",
		);
	}
	const author = ctx.run.startedBy
		? await ctx.gitAuthor(ctx.run.startedBy)
		: null;
	let worktree: { worktreePath: string };
	try {
		worktree = await device.receiveHandOff({
			run: {
				id: ctx.run.id,
				projectId: ctx.run.projectId,
				...(author ? { author } : {}),
			},
			branch: sent.branch,
			commit: sent.commit,
		});
	} catch (error) {
		return fail(
			`${device.name} could not take the run's work from ${from.name}. ${stepFailure(error, `the hand-off of run ${ctx.run.id}`)}`,
			"receive",
		);
	}
	await ctx.log.append({
		type: "HandedOff",
		runId: ctx.run.id,
		stepId: step.stepId,
		payload: {
			from: from.id,
			to: device.id,
			commit: sent.commit,
			branch: sent.branch,
			worktreePath: worktree.worktreePath,
		},
	});
	step.worktree = worktree.worktreePath;
	return null;
}
