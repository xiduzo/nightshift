import { END, START, StateGraph } from "@langchain/langgraph";
import type { Flow } from "@nightshift/flows";

import type { NodeAction, StepContext } from "./context";
import { agentNode } from "./nodes/agent";
import { callNode } from "./nodes/call";
import { gateAskNode } from "./nodes/choosers/person";
import { commandNode } from "./nodes/command";
import { decisionNode } from "./nodes/decision";
import { valueNode } from "./nodes/value";
import { askNodeId, parkNode, parkNodeId, waitNodeId } from "./route";
import { RunState } from "./state";
import { waitNode } from "./wait";

/**
 * Compiles a Night Shift flow (the run's snapshot) into a LangGraph
 * StateGraph. Every flow node is one graph node named by its id, with a
 * park node `park__<id>` (design rule 2: a failed or stopped step parks
 * the run there, and only a chosen end reaches END); an Agent node, a
 * Decision decided by a model or a Value made by a model also has a wait
 * node `wait__<id>` (rule 8),
 * the shared `waitNode`; a Decision decided by a person (a Gate) has an
 * ask node `ask__<id>` that interrupts with the Gate the node opened. No
 * static edges besides START → `flow.start`: every node returns `new
 * Command({ update, goto })`, built by `route()`.
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
		const park = parkNodeId(node.id);
		let action: NodeAction;
		let own: string[] = [park];
		switch (node.type) {
			case "agent": {
				action = agentNode(node, ctx);
				const wait = waitNodeId(node.id);
				own = [park, wait];
				graph.addNode(wait, waitNode(node.id), { ends: [node.id] });
				break;
			}
			case "command":
				action = commandNode(node, ctx);
				break;
			case "decision": {
				action = decisionNode(node, ctx);
				if (node.by === "model") {
					const wait = waitNodeId(node.id);
					own = [park, wait];
					graph.addNode(wait, waitNode(node.id), { ends: [node.id] });
				}
				if (node.by === "person") {
					// The ask node interrupts and, on the answer, routes like the
					// node itself; a reopen sends it back to the node.
					const ask = askNodeId(node.id);
					own = [park, ask];
					graph.addNode(ask, gateAskNode(node, ctx), {
						ends: [...ends, park, node.id],
					});
				}
				break;
			}
			case "call":
				action = callNode(node, ctx);
				break;
			case "value": {
				action = valueNode(node, ctx);
				if (node.by === "model") {
					const wait = waitNodeId(node.id);
					own = [park, wait];
					graph.addNode(wait, waitNode(node.id), { ends: [node.id] });
				}
				break;
			}
		}
		graph.addNode(node.id, action, { ends: [...ends, ...own] });
		graph.addNode(park, parkNode(node), { ends: [node.id] });
	}
	graph.addEdge(START, flow.start as typeof START);
	return graph;
}

export type FlowGraph = ReturnType<typeof compileFlow>;
