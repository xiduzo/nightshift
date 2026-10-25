import { type CallNode, type Outcome, runsEach } from "@nightshift/flows";
import type { InputValues, StepOutputs } from "../../log";
import {
	endedAtReason,
	messageOf,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
	stopAtOf,
} from "../context";
import { eachOutputs } from "../each";
import { renderBindings, resolveInputs } from "../inputs";
import { entryOf, RESUME_RULES, resumePoint } from "../resume-point";
import { route, routeDone, scopeOf } from "../route";
import { beginStep } from "../step-runner";
import {
	type BodyGraph,
	bodyGraph,
	bodyOutputs,
	hasStoppedEdge,
	runBody,
} from "./body";
import { callEachNode } from "./call-each";

/**
 * The Call node: runs another flow as a subgraph of the node (design rule
 * 6). With `each` it runs the flow once per element of a list, one element
 * per super-step (`callEachNode`); without, once, as below.
 *
 * Once: binds the called flow's inputs (`FlowCalled`), runs the flow in the
 * scope `{ parentStepId: stepId, itemId: null }` and ends `pass` with the
 * flow's declared outputs, `ended` and `visit` when it finished on a chosen
 * end, `fail` with the reason when it failed.
 *
 * Everything before the body runs again on a resume and after a daemon
 * death (rule 4), so it is idempotent: the resume point (`resumePoint`,
 * `RESUME_RULES.call`) continues the step the log has for this node that
 * the graph never committed (open) or reopens it (ended: stopped, or
 * `interrupted` by recovery) with its `FlowCalled` inputs, and the body
 * resumes under the same namespace. A run parked at this node's own park
 * node (no edge on `fail`) resumes as a new visit, as today.
 *
 * The node opens its step through the step runner's lower seam
 * (`beginStep`, `OpenStep`), not `runStep`: its step stays open while the
 * called flow runs as a subgraph and rethrows that flow's interrupts.
 */
export function callNode(node: CallNode, ctx: StepContext): NodeAction {
	if (runsEach(node)) return callEachNode(node, ctx);
	let graph: BodyGraph | null = null;
	return async (state, config) => {
		const runId = ctx.run.id;
		const events = await ctx.log.events(runId);
		const point = resumePoint(
			node,
			state,
			events,
			scopeOf(config),
			CALL.resumeRules(node),
		);
		if (point.kind === "done") {
			return routeDone(ctx, state, node, point, config);
		}
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			entryOf(point),
			events,
		);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;
		const { stepId, visit } = step;

		const end = async (
			outcome: "pass" | "fail" | "error" | "stopped",
			outputs: StepOutputs,
			error: string | null,
		) =>
			step.end(
				outcome,
				{ ...outputs, ended: outputs.ended ?? "", outcome, visit },
				error,
			);

		const called = ctx.flows[node.flow];
		if (!called) {
			const result = await end(
				"error",
				{},
				`The flow "${node.flow}" is not in the run's snapshot.`,
			);
			return route(ctx, state, node, result, config);
		}

		let inputs: InputValues;
		if (step.existing?.call) {
			inputs = step.existing.call.inputs;
		} else {
			try {
				inputs = resolveInputs(
					called.inputs ?? [],
					renderBindings(node.inputs, step.tctx),
					{ what: `The flow "${node.flow}"`, jsonText: "lenient" },
				);
			} catch (error) {
				const result = await end("error", {}, messageOf(error));
				return route(ctx, state, node, result, config);
			}
			await ctx.log.append({
				type: "FlowCalled",
				runId,
				stepId,
				payload: { flow: node.flow, inputs },
			});
		}

		graph ??= bodyGraph(ctx, called, node.flow);
		const body = {
			called,
			flowName: node.flow,
			inputs,
			scope: { parentStepId: stepId, itemId: null },
			run: { branch: step.tctx.run.branch, base_branch: "", index: "" },
		};
		const ended = await runBody({
			graph,
			config,
			stopAt: stopAtOf(state, config),
			...body,
		});
		switch (ended.kind) {
			case "paused":
				// The step stays open: the called flow continues after the wait.
				step.leaveOpen();
				throw ended.interrupt;
			case "stopped": {
				if (ended.atStopTime && hasStoppedEdge(ctx.flow, node)) {
					// The stop time ended the called flow: wrap the run up along the edge.
					const outputs = await bodyOutputs(ctx, body);
					const result = await end("stopped", outputs, null);
					return route(ctx, state, node, result, config, {
						wrappingUp: true,
					});
				}
				await end("stopped", {}, null);
				throw ended.interrupt;
			}
			case "aborted":
				await end("error", {}, ended.reason);
				throw ended.interrupt;
			case "failed": {
				const outputs = await bodyOutputs(ctx, body);
				const result = await end("fail", outputs, ended.reason);
				return route(ctx, state, node, result, config);
			}
			case "finished": {
				const outputs = await bodyOutputs(ctx, body, ended);
				const result = await end(
					"pass",
					{
						...outputs,
						ended: ctx.kindOf(ended.node).endedLabel(ended.node, ended.outcome),
					},
					null,
				);
				return route(ctx, state, node, result, config);
			}
		}
	};
}

/** A chosen end of a Call: `pass` once, and whatever outcome a Call with `each` ends on. */
function isChosenCallEnd(node: CallNode, outcome: Outcome): boolean {
	return outcome === "pass" || runsEach(node);
}

/**
 * The Call kind. Its facts follow `node.each`: a Call with `each` takes up
 * a cut-short loop, every outcome is a chosen end and `done` the plain
 * end, a command source writes the command log, and a cut-short step
 * counts its items; a Call once reports `pass` as the plain end and an
 * empty `ended` when cut short. The one kind that may follow a `stopped` edge
 * (`hasStoppedEdge`, `wrappingUp`).
 */
export const CALL: NodeKind<CallNode> = {
	...PLAIN_KIND,
	type: "call",
	make: callNode,
	// A Call with each works in the worktree: its item branches, its files
	// or command source. Its body's nodes run where they are placed.
	works: (node) =>
		node.each !== undefined &&
		((node.each.branch ?? "per-item") === "per-item" ||
			node.each.source.kind !== "json")
			? "worktree"
			: null,
	resumeRules: (node) =>
		runsEach(node) ? RESUME_RULES.callEach : RESUME_RULES.call,
	isChosenEnd: isChosenCallEnd,
	endReason: (node, outcome) =>
		outcome === (runsEach(node) ? "done" : "pass")
			? null
			: endedAtReason(node, outcome),
	logsCommandOutput: (node) => node.each?.source.kind === "command",
	cutShortOutputs: (open, node, outcome) => {
		const each = node ? runsEach(node) : open.items.length > 0;
		return each
			? eachOutputs({
					items: open.items,
					visit: open.visit,
					outcome,
					waiting: [],
				})
			: { outcome, ended: "", visit: open.visit };
	},
};
