import { END, START, StateGraph } from "@langchain/langgraph";
import type { Flow } from "@nightshift/flows";

import type { NodeAction, StepContext } from "./context";
import { agentNode, agentWaitNode } from "./nodes/agent";
import { commandNode } from "./nodes/command";
import { decisionNode, decisionWaitNode } from "./nodes/decision";
import { forEachNode } from "./nodes/foreach";
import { gateNode } from "./nodes/gate";
import { subflowNode } from "./nodes/subflow";
import { parkNode, parkNodeId, waitNodeId } from "./route";
import { RunState } from "./state";

/**
 * Compiles a Night Shift flow (the run's snapshot) into a LangGraph
 * StateGraph. Every flow node is one graph node named by its id, with a
 * park node `park__<id>` (design rule 2: a failed or stopped step parks
 * the run there, and only a chosen end reaches END); an Agent or a
 * Decision node also has a wait node `wait__<id>` (rule 8). No static
 * edges besides START → `flow.start`: every node returns `new Command({
 * update, goto })`, built by `route()`.
 *
 * The runner compiles once per run (`compileFlow(flow, ctx).compile({
 * checkpointer })`) with the thread id set to the run id. A Subflow or For
 * Each node compiles its called flow the same way, with `ctx.flow` and
 * `ctx.flowName` replaced, and invokes it with the config passed through
 * (rule 6).
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
				graph.addNode(wait, agentWaitNode(node, ctx), { ends: [node.id] });
				break;
			}
			case "command":
				action = commandNode(node, ctx);
				break;
			case "decision": {
				action = decisionNode(node, ctx);
				const wait = waitNodeId(node.id);
				own = [park, wait];
				graph.addNode(wait, decisionWaitNode(node, ctx), { ends: [node.id] });
				break;
			}
			case "gate":
				action = gateNode(node, ctx);
				break;
			case "subflow":
				action = subflowNode(node, ctx);
				break;
			case "foreach":
				action = forEachNode(node, ctx);
				break;
		}
		graph.addNode(node.id, action, { ends: [...ends, ...own] });
		graph.addNode(park, parkNode(node), { ends: [node.id] });
	}
	graph.addEdge(START, flow.start as typeof START);
	return graph;
}

export type FlowGraph = ReturnType<typeof compileFlow>;
