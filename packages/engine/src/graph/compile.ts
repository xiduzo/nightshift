import {
	Command,
	END,
	type LangGraphRunnableConfig,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { type Flow, initialVariables } from "@nightshift/flows";
import { type StepContext, templateContext } from "./context";
import { dataProblem } from "./output-schema";
import {
	askNodeId,
	parkCommand,
	parkNode,
	parkNodeId,
	scopeOf,
	waitNodeId,
} from "./route";
import { waitNode } from "./sleep";
import { RunState } from "./state";

/**
 * Compiles a Night Shift flow (the run's snapshot) into a LangGraph
 * StateGraph. Every flow node is one graph node named by its id, made by
 * its kind's factory (`ctx.kindOf(node).make`), with a park node `park__<id>`
 * (design rule 2: a failed or stopped step parks the run there, and only a
 * chosen end reaches END) and the auxiliary graph nodes its kind asks for
 * (`ctx.kindOf(node).aux`): a wait node `wait__<id>` (rule 8), the sleep
 * module's `waitNode`, or an ask node `ask__<id>` that interrupts and
 * routes on the answer (the Gate). This module knows no node type: adding a
 * kind is adding its descriptor to the registry (`node-kinds.ts`). No
 * static edges besides START → `flow.start`: every node returns `new
 * Command({ update, goto })`, built by `route()`. A flow with variables
 * starts at `vars__init` instead (`variablesNode`), which sets them and
 * goes on to `flow.start`.
 *
 * The runner compiles once per run (`compileFlow(flow, ctx).compile({
 * checkpointer })`) with the thread id set to the run id. A Call node
 * compiles its called flow the same way, with `ctx.flow` and `ctx.flowName`
 * replaced, and invokes it with the config passed through (rule 6).
 */

export function compileFlow(flow: Flow, ctx: StepContext) {
	const nodeIds = flow.nodes.map((n) => n.id);
	const ends = [...nodeIds, END];
	const graph = new StateGraph(RunState);

	for (const node of flow.nodes) {
		const kind = ctx.kindOf(node);
		const park = parkNodeId(node.id);
		const own = [park];
		for (const aux of kind.aux(node)) {
			switch (aux.kind) {
				case "wait": {
					const wait = waitNodeId(node.id);
					own.push(wait);
					graph.addNode(wait, waitNode(node.id), { ends: [node.id] });
					break;
				}
				case "ask": {
					// The ask node interrupts and, on the answer, routes like the
					// node itself; a reopen sends it back to the node.
					const ask = askNodeId(node.id);
					own.push(ask);
					graph.addNode(ask, aux.make(node, ctx), {
						ends: [...ends, park, node.id],
					});
					break;
				}
			}
		}
		graph.addNode(node.id, kind.make(node, ctx), { ends: [...ends, ...own] });
		graph.addNode(park, parkNode(node), { ends: [node.id] });
	}
	if ((flow.variables ?? []).length > 0) {
		graph.addNode(VARIABLES_NODE, variablesNode(flow, ctx), {
			ends: [flow.start, parkNodeId(flow.start)],
		});
		graph.addEdge(START, VARIABLES_NODE as typeof START);
	} else {
		graph.addEdge(START, flow.start as typeof START);
	}
	return graph;
}

/** The graph node that sets a flow's variables before its first step. */
export const VARIABLES_NODE = "vars__init";

/**
 * Sets the flow's variables to their initial values (each `initial`
 * rendered over the inputs and `run`), logs them (`VariablesSet`, in the
 * flow's scope) and goes on to the start node. An initial value that does
 * not fit parks the run as failed at the start node, before its step.
 */
function variablesNode(flow: Flow, ctx: StepContext) {
	return async (
		state: Parameters<typeof templateContext>[1],
		config: LangGraphRunnableConfig,
	): Promise<Command> => {
		const result = initialVariables(
			flow,
			templateContext(ctx, state, config),
			dataProblem,
		);
		const start = flow.nodes.find((node) => node.id === flow.start);
		if (!result.ok) {
			if (!start) throw new Error(result.error);
			return parkCommand({
				node: start,
				status: "failed",
				reason: result.error,
				step: null,
			});
		}
		await ctx.log.append({
			type: "VariablesSet",
			runId: ctx.run.id,
			payload: { values: result.values, scope: scopeOf(config) },
		});
		return new Command({
			update: { vars: result.values },
			goto: flow.start,
		});
	};
}

export type FlowGraph = ReturnType<typeof compileFlow>;
