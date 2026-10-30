import type { FlowNode } from "@nightshift/flows";

import type { Device } from "../device";
import { readTranscriptFile, transcriptToRead } from "../log";
import { type DerivedStep, deriveSteps } from "../read";
import { messageOf, type StepContext } from "./context";
import type { OpenStep } from "./step-runner";

/**
 * What a step changed in the run's worktree, as git sees it: every file,
 * also those a shell command, a formatter, codegen or an install changed,
 * and for a Command step too (it has no tool calls). The step runner takes
 * a snapshot of the worktree before the body (`watchChanges`) and records
 * what changed since before the step ends or pauses (`record`). The
 * transcript keeps both (`worktree-snapshot`, `worktree-changes`): the
 * last `worktree-changes` of a step is what it changed.
 *
 * - Only a step that works in the worktree (`NodeKind.works`) and runs
 *   through `runStep`. A Call and a Gate open their step around a
 *   subflow or an interrupt: the steps inside count their own changes.
 * - A reopened or continued step keeps the snapshot it recorded first, so
 *   it shows all it changed since its start, also across a restart.
 * - Parallel branches share one worktree. When another step that works
 *   in it was active meanwhile, the changes say so (`overlapped`): they
 *   can hold that step's changes too.
 * - A snapshot never fails a step. A Device that takes none (a test's, an
 *   older Night Shift's) or a worktree too large for one: the step shows
 *   its agent's own edits only, and the log says why.
 */

/** How long a snapshot may take before the step goes on without it. */
const SNAPSHOT_MS = 60_000;
/** The same, at the end of a step a stop or a time limit cut short: it should end soon. */
const STOPPED_SNAPSHOT_MS = 10_000;

/** The step's changes since its snapshot, recorded on demand. */
export type ChangesWatch = {
	/** Records `worktree-changes`, unless nothing changed since the last record. Never throws. */
	record(): Promise<void>;
};

/**
 * Starts watching what `step` changes in the run's worktree: finds the
 * snapshot its transcript has, else takes one and records it. Null when
 * the step does not work in the worktree, or no snapshot can be had.
 * Never throws.
 */
export async function watchChanges(
	ctx: StepContext,
	node: FlowNode,
	step: OpenStep,
): Promise<ChangesWatch | null> {
	if (ctx.kindOf(node).works(node) !== "worktree") return null;
	const { device } = step;
	const { snapshotWorktree, worktreeChanges } = device;
	if (!snapshotWorktree || !worktreeChanges) return null;
	const where = `step ${step.stepId} of run ${ctx.run.id}`;
	const cwd = step.worktree;

	const known = step.existing ? await recorded(ctx, step) : null;
	let start = known?.start ?? null;
	let last = known?.last ?? null;
	if (!start) {
		try {
			const { tree } = await snapshotWorktree({
				cwd,
				signal: AbortSignal.timeout(SNAPSHOT_MS),
			});
			start = { tree, at: Date.now() };
			step.record(null, { type: "worktree-snapshot", tree });
		} catch (error) {
			console.warn(
				`[engine] no snapshot of the worktree for ${where} on ${device.name}: ${messageOf(error)}`,
			);
			return null;
		}
	}
	const from = start;

	return {
		async record() {
			try {
				const changes = await worktreeChanges({
					cwd,
					from: from.tree,
					signal: AbortSignal.timeout(
						step.signal.aborted ? STOPPED_SNAPSHOT_MS : SNAPSHOT_MS,
					),
				});
				// Nothing new since the last record (a wait that changed nothing).
				if (changes.tree === (last ?? from.tree)) return;
				const overlapped = await othersActive(ctx, step, from.at);
				step.record(null, {
					type: "worktree-changes",
					from: from.tree,
					to: changes.tree,
					files: changes.files,
					...(changes.omitted ? { omitted: changes.omitted } : {}),
					...(overlapped ? { overlapped: true } : {}),
				});
				last = changes.tree;
			} catch (error) {
				console.warn(
					`[engine] what ${where} changed in the worktree is not known: ${messageOf(error)}`,
				);
			}
		},
	};
}

/**
 * The snapshot a step's transcript holds, with when it was taken, and the
 * snapshot its last `worktree-changes` ended at. Null when it holds none:
 * the step started before Night Shift took snapshots, or on another
 * Walker.
 */
async function recorded(
	ctx: StepContext,
	step: Pick<OpenStep, "stepId" | "existing">,
): Promise<{
	start: { tree: string; at: number } | null;
	last: string | null;
} | null> {
	try {
		const entries = await readTranscriptFile(
			transcriptToRead(
				ctx.dataDir,
				ctx.run.id,
				step.stepId,
				step.existing?.transcriptPath ?? "",
			),
		);
		let start: { tree: string; at: number } | null = null;
		let last: string | null = null;
		for (const { event, at } of entries) {
			if (event.type === "worktree-snapshot") start = { tree: event.tree, at };
			else if (event.type === "worktree-changes") last = event.to;
		}
		return { start, last };
	} catch {
		return null;
	}
}

/**
 * Whether another step that works in the run's worktree on the same Device
 * was active since `from`: open, not asleep and not waiting for a person.
 */
async function othersActive(
	ctx: StepContext,
	step: Pick<OpenStep, "stepId" | "device">,
	from: number,
): Promise<boolean> {
	const to = Date.now();
	const steps = deriveSteps(await ctx.log.events(ctx.run.id));
	return steps.some(
		(other) =>
			other.id !== step.stepId &&
			activeBetween(other, from, to) &&
			sharesWorktree(ctx, other, step.device),
	);
}

/** Whether a step of the log works in the run's worktree on `device`. */
function sharesWorktree(
	ctx: StepContext,
	other: DerivedStep,
	device: Device,
): boolean {
	// A Call is open around its subflow: the steps inside count themselves.
	if (other.nodeType === "call") return false;
	if (
		other.deviceId !== null &&
		ctx.deviceById(other.deviceId, ctx.run).id !== device.id
	) {
		return false;
	}
	const node = [ctx.flow, ...Object.values(ctx.flows)]
		.flatMap((flow) => flow.nodes)
		.find((n) => n.id === other.nodeId && n.type === other.nodeType);
	if (node) return ctx.kindOf(node).works(node) === "worktree";
	return other.nodeType === "agent" || other.nodeType === "command";
}

/** Whether a step was active at some time between `from` and `to`: open, not asleep, not at a Gate. */
export function activeBetween(
	step: Pick<DerivedStep, "startedAt" | "endedAt" | "sleeps" | "gateWaits">,
	from: number,
	to: number,
): boolean {
	const start = Math.max(step.startedAt, from);
	const end = Math.min(step.endedAt ?? to, to);
	if (start >= end) return false;
	const pauses = [...step.sleeps, ...step.gateWaits]
		.map((pause) => [pause.from, pause.to ?? to] as const)
		.sort((a, b) => a[0] - b[0]);
	let covered = start;
	for (const [pauseFrom, pauseTo] of pauses) {
		if (pauseFrom > covered) return true;
		covered = Math.max(covered, pauseTo);
		if (covered >= end) return false;
	}
	return covered < end;
}
