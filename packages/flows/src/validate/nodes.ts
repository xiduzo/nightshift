import type { FlowNode } from "../flow";
import {
	checkAgentNode,
	checkCallNode,
	checkCommandNode,
	checkDecisionNode,
	checkEndNode,
	checkLeaseNode,
	checkToolNode,
	checkValueNode,
	checkWaitNode,
	type NodeCheck,
} from "../nodes";
import { nodesWithin, sectionPath } from "../sections";
import type { Report } from "./issues";
import {
	checkDataRule,
	checkEventRule,
	checkRule,
	checkTemplate,
	type Scope,
} from "./scope";

/**
 * The checks of one node's own content. Each node type keeps its checks in
 * `nodes/`. This gives them the flow they read: its templates, rules and
 * edges.
 */
export function checkNode(
	node: FlowNode,
	scope: Scope,
	error: Report,
	warning: Report,
): void {
	const at = { nodeId: node.id };
	// A node with a cascade reads `{{cascade.*}}` in its own templates.
	const own =
		"cascade" in node && node.cascade !== undefined
			? { ...scope, cascade: true }
			: scope;
	const check: NodeCheck = {
		error: (message) => error(message, at),
		warning: (message) => warning(message, at),
		template: (text, where) =>
			checkTemplate(text, `The ${where} of "${node.id}"`, at, own, error),
		rule: (expr, subject) => checkRule(expr, subject, at, scope, error),
		eventRule: (expr, subject) => checkEventRule(expr, subject, at, error),
		dataRule: (expr, subject) => checkDataRule(expr, subject, at, error),
		routed: (outcome) =>
			scope.flow.edges.some(
				(edge) => edge.from === node.id && edge.outcome === outcome,
			),
		section: (id) => {
			const section = sectionPath(scope.flow, id).at(-1);
			return section ? nodesWithin(scope.flow, section) : null;
		},
	};
	switch (node.type) {
		case "agent":
			checkAgentNode(node, check);
			break;
		case "command":
			checkCommandNode(node, check);
			break;
		case "decision":
			checkDecisionNode(node, check);
			break;
		case "call":
			checkCallNode(node, check);
			break;
		case "value":
			checkValueNode(node, check);
			break;
		case "wait":
			checkWaitNode(node, check);
			break;
		case "tool":
			checkToolNode(node, check);
			break;
		case "end":
			checkEndNode(node, check);
			break;
		case "join":
			// A Join's checks are the branches' (`checkBranches`).
			break;
		case "lease":
			checkLeaseNode(node, check);
			break;
	}
}
