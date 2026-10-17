import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { type CallNode, runsEach } from "@nightshift/flows";

import type { InputValues, LoggedEvent, StepOutputs } from "../../events";
import { renderBindings, resolveInputs } from "../../inputs";
import {
	beginStep,
	messageOf,
	type NodeAction,
	type StepContext,
	type StepStart,
	stopAtOf,
	uncommittedStep,
} from "../context";
import { route, scopeOf } from "../route";
import type { RunStateValues } from "../state";
import {
	type BodyGraph,
	bodyGraph,
	bodyOutputs,
	continueStep,
	endedLabel,
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
 * death (rule 4), so it is idempotent: the step the log has for this node
 * that the graph never committed is continued (open) or reopened (ended:
 * stopped, or `interrupted` by recovery) with its `FlowCalled` inputs, and
 * the body resumes under the same namespace. A run parked at this node's
 * own park node (no edge on `fail`) resumes as a new visit, as today.
 */
export function callNode(node: CallNode, ctx: StepContext): NodeAction {
	if (runsEach(node)) return callEachNode(node, ctx);
	let graph: BodyGraph | null = null;
	return async (state, config) => {
		const runId = ctx.run.id;
		const events = await ctx.log.events(runId);
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			entryOf(node, state, events, config),
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
			case "stopped":
				await end("stopped", {}, null);
				throw ended.interrupt;
			case "aborted":
				await end("error", {}, ended.reason);
				throw ended.interrupt;
			case "failed": {
				const outputs = await bodyOutputs(ctx, body);
				const result = await end("fail", outputs, ended.reason);
				return route(ctx, state, node, result, config);
			}
			case "finished": {
				const outputs = await bodyOutputs(ctx, body, ended.nodes);
				const result = await end(
					"pass",
					{ ...outputs, ended: endedLabel(ended.node, ended.outcome) },
					null,
				);
				return route(ctx, state, node, result, config);
			}
		}
	};
}

/**
 * A run parked at this node (its step ended `fail` with no edge) starts a
 * new visit; else the step the log has that the graph never committed is
 * continued or reopened; else a new visit.
 */
function entryOf(
	node: CallNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	config: LangGraphRunnableConfig,
): StepStart {
	if (state.pending?.nodeId === node.id) return { kind: "new" };
	return continueStep(uncommittedStep(node, state, events, scopeOf(config)));
}
