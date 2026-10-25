import type { Flow, FlowNode } from "../document";
import {
	ruleNames,
	ruleProblem,
	ruleVariableNames,
	type TemplateRef,
	templateRefs,
} from "../template";
import type { At, ProjectFlowMap, Report } from "./issues";
import { readsName, type TemplateScope } from "./template-scope";

/** The references of templates and rules: what they may read, and the checks of each one. */

/** What a template may refer to. */
export type Scope = {
	flow: Flow;
	nodes: ReadonlyMap<string, FlowNode>;
	/** Undefined when the project's flows are not known. */
	flows: ProjectFlowMap | undefined;
	/** What a template may read (`templateScope`). */
	template: TemplateScope;
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
	for (const name of ruleNames(expr)) {
		if (!readsName(scope.template, name)) {
			error(
				`${subject} reads "${name}", but there is no node or input "${name}".`,
				at,
			);
		}
	}
	const variables = new Set((scope.template.vars ?? []).map((v) => v.name));
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
 * Each reference names `run`, an input, `vars` or a node, and reads what
 * the template scope (`templateScope`) lists: one of its fields first, and
 * deeper keys only below a JSON field.
 */
export function checkTemplate(
	text: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	for (const ref of templateRefs(text)) {
		checkRef(ref, `${subject} uses ${ref.raw}`, at, scope, error);
	}
}

/** One reference of a template. `uses` starts each message. */
export function checkRef(
	ref: TemplateRef,
	uses: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const readable = scope.template;
	const [field, ...deeper] = ref.path;
	if (ref.name === "run") {
		const fields = readable.run.map((run) => run.name);
		if (field === undefined || !fields.includes(field)) {
			error(
				`${uses}, but the run has no field ${field === undefined ? "there" : `"${field}"`}. Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (deeper.length > 0) {
			error(`${uses}, but run.${field} is text: it takes no path.`, at);
		}
		return;
	}

	if (ref.name === "vars" && readable.vars !== null) {
		const variable = readable.vars.find((v) => v.name === field);
		if (field === undefined) {
			error(`${uses}, but vars needs a variable: {{vars.<name>}}.`, at);
		} else if (variable === undefined) {
			error(`${uses}, but the flow has no variable "${field}".`, at);
		} else {
			scope.readVars.add(field);
			if (deeper.length > 0 && !variable.json) {
				const type =
					scope.flow.variables?.find((v) => v.name === field)?.type ?? "text";
				error(
					`${uses}, but the variable "${field}" is ${type}: it takes no path. Write {{vars.${field}}}, or make it json.`,
					at,
				);
			}
		}
		return;
	}

	const input = readable.inputs.find(
		(candidate) => candidate.name === ref.name,
	);
	if (input !== undefined) {
		if (!input.json && field !== undefined) {
			error(
				`${uses}, but the input "${ref.name}" is text: it takes no path. Write {{${ref.name}}}, or make it a json input.`,
				at,
			);
		}
		return;
	}

	const node = readable.nodes.find((candidate) => candidate.id === ref.name);
	if (node === undefined) {
		error(`${uses}, but there is no node or input "${ref.name}".`, at);
		return;
	}
	// A Subflow node whose flow is not known yet: the call reports that.
	if (node.open) return;
	const fields = node.fields.map((candidate) => candidate.name);
	const read = node.fields.find((candidate) => candidate.name === field);
	if (field === undefined) {
		error(
			`${uses}, but a node needs a field: {{${ref.name}.<field>}}. Use one of: ${fields.join(", ")}.`,
			at,
		);
	} else if (read === undefined) {
		error(
			scope.nodes.get(ref.name)?.type === "command" && field === "data"
				? `${uses}, but the command node "${ref.name}" prints text. Set its output to JSON to read data.`
				: `${uses}, but "${ref.name}" has no field "${field}". Use one of: ${fields.join(", ")}.`,
			at,
		);
	} else if (deeper.length > 0 && !read.json) {
		error(`${uses}, but ${ref.name}.${field} is text: it takes no path.`, at);
	}
}

export function describeNode(node: FlowNode): string {
	return node.type === "agent" && node.outcomes === undefined
		? `a ${node.type} node`
		: `"${node.id}"`;
}
