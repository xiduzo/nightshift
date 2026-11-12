import { definitionOf, type FlowNode } from "../flow";
import type { NodeCheck } from "../nodes";
import { nodesWithin, sectionPath } from "../sections";
import { templatesInLiteralShellText } from "../template";
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
		commandTemplate: (text, where) => {
			const subject = `The ${where} of "${node.id}"`;
			checkTemplate(text, subject, at, own, error);
			for (const raw of new Set(templatesInLiteralShellText(text))) {
				warning(
					`${subject} has ${raw} in single quotes or a quoted heredoc. The command gets the name of the value, not the value. Use double quotes: "${raw}".`,
					at,
				);
			}
		},
		rule: (expr, subject, also) =>
			checkRule(expr, subject, at, scope, error, also),
		eventRule: (expr, subject) => checkEventRule(expr, subject, at, error),
		dataRule: (expr, subject) => checkDataRule(expr, subject, at, error),
		routed: (outcome) => scope.routed.has(`${node.id}\u0000${outcome}`),
		section: (id) => {
			const section = sectionPath(scope.flow, id).at(-1);
			return section ? nodesWithin(scope.flow, section) : null;
		},
	};
	checkNodeWith(node, check);
}

/**
 * Runs the checks of the node's own type (`NodeDefinition.check`) through
 * `check`. The flow check reports issues through it. A reader can collect
 * every template and rule the checks read (`dataLinks`), so a new field
 * needs no second list.
 */
export function checkNodeWith(node: FlowNode, check: NodeCheck): void {
	definitionOf(node).check(node, check);
}
