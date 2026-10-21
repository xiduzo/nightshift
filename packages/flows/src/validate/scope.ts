import {
	type Flow,
	type FlowNode,
	jsonOutputFields,
	nodeOutputFields,
	runsEach,
} from "../document";
import type { CallNode } from "../nodes";
import {
	ruleNames,
	ruleProblem,
	ruleVariableNames,
	runFields,
	templateRefs,
} from "../template";
import type { At, Flows, Report } from "./issues";

/** The references of templates and rules: what they may read, and the checks of each one. */

/** What a template may refer to. */
export type Scope = {
	flow: Flow;
	nodes: ReadonlyMap<string, FlowNode>;
	/** Undefined when the project's flows are not known. */
	flows: Flows | undefined;
	/** The variables a template or a rule read so far, for the unused-variable warning. */
	readVars: Set<string>;
};

/**
 * A rule (a JSONata expression) must be valid, and read only known names
 * (`checkRuleReads`). `subject` starts each message.
 */
export function checkRule(
	expr: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const problem = ruleProblem(expr);
	if (problem !== null) {
		error(`${subject} is not valid: ${problem}`, at);
		return;
	}
	checkRuleReads(expr, subject, at, scope, error);
}

/**
 * The names a rule reads: `run`, `vars`, an input or a node at the top,
 * and a variable the flow has below `vars`.
 */
function checkRuleReads(
	expr: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const known = new Set<string>([
		"run",
		"vars",
		...scope.flow.inputs.map((input) => input.name),
		...scope.nodes.keys(),
	]);
	for (const name of ruleNames(expr)) {
		if (!known.has(name)) {
			error(
				`${subject} reads "${name}", but there is no node or input "${name}".`,
				at,
			);
		}
	}
	const variables = new Set((scope.flow.variables ?? []).map((v) => v.name));
	for (const name of ruleVariableNames(expr)) {
		scope.readVars.add(name);
		if (!variables.has(name)) {
			error(
				`${subject} reads vars.${name}, but the flow has no variable "${name}".`,
				at,
			);
		}
	}
}

/**
 * Each reference names `run`, an input, or a node. `run`: one field of
 * `runFields`. A `text` input: no path. A `json` input: any path. A node:
 * one of its output fields first; deeper keys only below a JSON field (and
 * below a Call node's flow outputs, which hold JSON). A Command node's
 * `data` needs `output: "json"`.
 */
export function checkTemplate(
	text: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const inputs = new Map(scope.flow.inputs.map((input) => [input.name, input]));
	for (const ref of templateRefs(text)) {
		const uses = `${subject} uses ${ref.raw}`;
		const [field, ...deeper] = ref.path;
		if (ref.name === "run") {
			const fields: readonly string[] = runFields;
			if (field === undefined || !fields.includes(field)) {
				error(
					`${uses}, but the run has no field ${field === undefined ? "there" : `"${field}"`}. Use one of: ${fields.join(", ")}.`,
					at,
				);
			} else if (deeper.length > 0) {
				error(`${uses}, but run.${field} is text: it takes no path.`, at);
			}
			continue;
		}

		if (ref.name === "vars") {
			const variable = scope.flow.variables?.find((v) => v.name === field);
			if (field === undefined) {
				error(`${uses}, but vars needs a variable: {{vars.<name>}}.`, at);
			} else if (variable === undefined) {
				error(`${uses}, but the flow has no variable "${field}".`, at);
			} else {
				scope.readVars.add(field);
				if (deeper.length > 0 && variable.type !== "json") {
					error(
						`${uses}, but the variable "${field}" is ${variable.type}: it takes no path. Write {{vars.${field}}}, or make it json.`,
						at,
					);
				}
			}
			continue;
		}

		const input = inputs.get(ref.name);
		if (input !== undefined) {
			if (input.type === "text" && field !== undefined) {
				error(
					`${uses}, but the input "${ref.name}" is text: it takes no path. Write {{${ref.name}}}, or make it a json input.`,
					at,
				);
			}
			continue;
		}

		const node = scope.nodes.get(ref.name);
		if (node === undefined) {
			error(`${uses}, but there is no node or input "${ref.name}".`, at);
			continue;
		}

		let fields: readonly string[] = nodeOutputFields(node);
		/** Fields that take a deeper path. */
		let json: readonly string[] = jsonOutputFields;
		if (node.type === "call" && !runsEach(node)) {
			const called = calledFlow(node, scope.flows);
			// Unknown until the flows load, or broken: the call reports that.
			if (called === undefined) continue;
			fields = nodeOutputFields(node, called);
			json = [...json, ...called.outputs.map((output) => output.name)];
		}
		if (node.type === "command" && field === "data" && node.output !== "json") {
			error(
				`${uses}, but the command node "${ref.name}" prints text. Set its output to JSON to read data.`,
				at,
			);
			continue;
		}
		if (field === undefined) {
			error(
				`${uses}, but a node needs a field: {{${ref.name}.<field>}}. Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (!fields.includes(field)) {
			error(
				`${uses}, but "${ref.name}" has no field "${field}". Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (deeper.length > 0 && !json.includes(field)) {
			error(`${uses}, but ${ref.name}.${field} is text: it takes no path.`, at);
		}
	}
}

/** The flow a Call node calls; undefined when it is not known or broken. */
export function calledFlow(
	node: CallNode,
	flows: Flows | undefined,
): Flow | undefined {
	if (flows === undefined || !Object.hasOwn(flows, node.flow)) return undefined;
	return flows[node.flow] ?? undefined;
}

export function describeNode(node: FlowNode): string {
	return node.type === "agent" && node.outcomes === undefined
		? `a ${node.type} node`
		: `"${node.id}"`;
}
