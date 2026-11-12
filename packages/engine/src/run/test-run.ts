import {
	type Flow,
	type FlowNodeType,
	NODE_TYPE_LABEL,
	type Outcome,
	standInOutcomes,
	standsIn,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { TestRunRequest } from "../contract";
import type { PinnedOutput, RunLog, TestRun } from "../log";

/**
 * A test run (ADR 27): a person's start of a saved flow with pins and
 * skips. The start carries refs only (`TestRunRequest`): this Walker
 * resolves each pin from its own log, and `RunStarted.test` records the
 * output each pin gives (`TestRun`). The flow itself never holds them.
 *
 * Two checks, each with the words a person sees:
 *
 * - `resolveTestRun`, before the plan: each pin names a step of a run of
 *   the same project in the same Space, at the top level, for the same
 *   node, that ended, and that was not skipped itself. A pin of a pinned
 *   step pins the output it gave, from the step it came from. A pinned
 *   output holds at most 1 MiB of JSON.
 * - `checkTestRun`, once the plan has the flow, before any check of a
 *   Device: each node is in the flow, may stand in (`standsIn`: not an End,
 *   a Join, a Lease or a Service), has the type of the pinned step, and
 *   has the outcome it gives.
 */

/** The most JSON one pinned output may hold. */
export const PIN_MAX_BYTES = 1024 * 1024;

/** A start that is not a person's start of a saved flow cannot be a test run. */
export const TEST_RUN_FROM_EDITOR =
	"A test run starts only from the editor of a saved flow.";

/** The ending of each refusal of a pin that is no longer right. */
const NEWER = "Pin a newer output.";

/** A test run's pins and skips as this Walker resolved them. */
export type ResolvedTestRun = {
	/** What `RunStarted.test` records. */
	test: TestRun;
	/** The node type of each pinned step, by node id. */
	types: Record<string, FlowNodeType>;
};

/** An outcome the engine gives a step that did not finish. */
const unfinished = (outcome: string) =>
	outcome === "error" || outcome === "stopped" || outcome === "interrupted";

/** The size of a value as JSON, in bytes. */
const jsonBytes = (value: unknown) =>
	Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * Resolves a test run's pins from this Walker's log, and checks each one
 * and each skip as far as the log can tell. Null when the start pins and
 * skips nothing: every node runs. Throws the refusal a person sees.
 */
export async function resolveTestRun(
	request: TestRunRequest | undefined,
	project: { id: string; spaceId: string },
	log: Pick<RunLog, "row" | "state">,
): Promise<ResolvedTestRun | null> {
	const pins = Object.entries(request?.pinned ?? {});
	const skipped = { ...request?.skipped };
	if (pins.length === 0 && Object.keys(skipped).length === 0) return null;
	const pinned: Record<string, PinnedOutput> = {};
	const types: Record<string, FlowNodeType> = {};
	for (const [nodeId, ref] of pins) {
		if (Object.hasOwn(skipped, nodeId)) {
			throw new Refusal(
				"invalid",
				`You pinned and skipped "${nodeId}". Choose one of the two.`,
			);
		}
		const lost = new Refusal(
			"invalid",
			`Night Shift cannot find the output you pinned on "${nodeId}". ${NEWER}`,
		);
		const row = await log.row(ref.runId).catch((error: unknown) => {
			if (error instanceof Refusal && error.kind === "not-found") return null;
			throw error;
		});
		// A run of another project or Space is as good as gone: its output stays there.
		if (
			row === null ||
			row.spaceId !== project.spaceId ||
			row.projectId !== project.id
		) {
			throw lost;
		}
		const source = await log.state(ref.runId);
		const step = source.steps.get(ref.stepId);
		if (!step) throw lost;
		if (step.nodeId !== nodeId) {
			throw new Refusal(
				"invalid",
				`The output you pinned on "${nodeId}" is from another node. ${NEWER}`,
			);
		}
		if (step.scope !== null) {
			throw new Refusal(
				"invalid",
				`The output you pinned on "${nodeId}" is from a step inside a Subflow. ${NEWER}`,
			);
		}
		if (step.endedAt === null || step.outcome === null) {
			throw new Refusal(
				"conflict",
				`The step you pinned on "${nodeId}" has not ended yet. Pin its output when it ends.`,
			);
		}
		if (step.test === "skipped") {
			throw new Refusal(
				"invalid",
				`"${nodeId}" was skipped in that run, so it has no output. ${NEWER}`,
			);
		}
		// A pinned step gave the output it was pinned to: pin that one.
		const pin: PinnedOutput | undefined =
			step.test === "pinned"
				? source.test?.pinned[nodeId]
				: {
						runId: ref.runId,
						stepId: step.id,
						endedAt: step.endedAt,
						outcome: step.outcome,
						outputs: step.outputs,
					};
		if (!pin) throw lost;
		if (jsonBytes(pin.outputs) > PIN_MAX_BYTES) {
			throw new Refusal(
				"invalid",
				`The output you pinned on "${nodeId}" is larger than 1 MiB. Let the node run instead.`,
			);
		}
		pinned[nodeId] = pin;
		types[nodeId] = step.nodeType;
	}
	return { test: { pinned, skipped }, types };
}

/**
 * Checks a resolved test run against the flow the run starts from: every
 * pinned and skipped node is in it at the top level, may stand in, and
 * gives an outcome it has. Throws the refusal a person sees.
 */
export function checkTestRun(flow: Flow, resolved: ResolvedTestRun): void {
	const { pinned, skipped } = resolved.test;
	const nodeOf = (nodeId: string) => flow.nodes.find((n) => n.id === nodeId);
	const marks: [string, "pinned" | "skipped", Outcome][] = [
		...Object.entries(pinned).map(
			([id, pin]) => [id, "pinned", pin.outcome] as [string, "pinned", Outcome],
		),
		...Object.entries(skipped).map(
			([id, outcome]) =>
				[id, "skipped", outcome] as [string, "skipped", Outcome],
		),
	];
	for (const [nodeId, mark, outcome] of marks) {
		const node = nodeOf(nodeId);
		if (!node) {
			throw new Refusal(
				"invalid",
				mark === "pinned"
					? `The flow has no node "${nodeId}" now. Unpin its output.`
					: `The flow has no node "${nodeId}" now. Stop skipping it.`,
			);
		}
		if (!standsIn(node)) {
			const label = NODE_TYPE_LABEL[node.type];
			throw new Refusal(
				"invalid",
				`"${nodeId}" is ${/^[AEIOU]/.test(label) ? "an" : "a"} ${label} node. A test run always runs it, so you cannot pin or skip it.`,
			);
		}
		const outcomes = standInOutcomes(node);
		if (mark === "skipped") {
			if (!outcomes.includes(outcome)) {
				throw new Refusal(
					"invalid",
					`"${nodeId}" has no outcome "${outcome}". Skip it with one of its outcomes.`,
				);
			}
			continue;
		}
		if (resolved.types[nodeId] !== node.type) {
			throw new Refusal(
				"invalid",
				`"${nodeId}" is another type of node than in the run you pinned. ${NEWER}`,
			);
		}
		if (!outcomes.includes(outcome)) {
			throw new Refusal(
				"invalid",
				unfinished(outcome)
					? `The step you pinned on "${nodeId}" did not finish. Pin the output of a step that finished.`
					: `"${nodeId}" has no outcome "${outcome}" now. ${NEWER}`,
			);
		}
	}
}
