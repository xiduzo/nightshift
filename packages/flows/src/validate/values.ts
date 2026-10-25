import {
	type Flow,
	type FlowNode,
	nodeOutcomes,
	outputFieldsByType,
} from "../document";
import { nameSchema, reservedNames } from "../nodes";
import { coerceVariable, templateRefs } from "../template";
import type { Report } from "./issues";
import {
	checkRef,
	checkRule,
	checkTemplate,
	describeNode,
	type Scope,
} from "./scope";
import { readsName, templateScope } from "./template-scope";

/** The values of a flow: its inputs, outputs and variables, and the writes of its nodes. */

/** `${NAME}` reads a secret: its value must never land in a variable. */
const SECRET_REF = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;

/**
 * Variables: unique names, valid and not reserved, not an input or a node
 * id, a schema on `json` only, and an initial value that reads only what
 * its template scope holds (the inputs and `run`), holds no secret, and
 * (as plain text) fits the type.
 */
export function checkVariables(scope: Scope, error: Report): void {
	const { flow, nodes } = scope;
	const initialScope: Scope = {
		...scope,
		template: templateScope(flow, { initialValue: true }),
	};
	const reserved: readonly string[] = reservedNames;
	const inputs = new Set(flow.inputs.map((input) => input.name));
	const seen = new Set<string>();
	for (const variable of flow.variables ?? []) {
		const name = variable.name;
		if (seen.has(name)) {
			error(`The variable "${name}" is declared more than once.`, {});
			continue;
		}
		seen.add(name);
		const valid = nameSchema.safeParse(name);
		if (!valid.success) {
			error(
				`The variable "${name}" is not a valid name: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				{},
			);
		} else if (reserved.includes(name)) {
			error(`The variable name "${name}" is reserved. Pick another name.`, {});
		}
		if (inputs.has(name)) {
			error(
				`The variable "${name}" has the same name as an input. Rename one of them.`,
				{},
			);
		}
		if (nodes.has(name)) {
			error(
				`The variable "${name}" has the same name as the node "${name}". Rename one of them.`,
				{ nodeId: name },
			);
		}
		if (variable.schema !== undefined && variable.type !== "json") {
			error(
				`The variable "${name}" has a schema, but only a json variable takes one. Make it json, or remove the schema.`,
				{},
			);
		}
		const initial = variable.initial;
		if (initial === undefined || initial.trim() === "") continue;
		const subject = `The initial value of variable "${name}"`;
		if (SECRET_REF.test(initial)) {
			error(
				`${subject} reads a secret. A variable is kept with the run, so it cannot hold a secret.`,
				{},
			);
		}
		const refs = templateRefs(initial);
		for (const ref of refs) {
			if (readsName(initialScope.template, ref.name)) {
				checkRef(ref, `${subject} uses ${ref.raw}`, {}, initialScope, error);
			} else {
				error(
					`${subject} uses ${ref.raw}. It can read the inputs and run only: no step ran yet.`,
					{},
				);
			}
		}
		if (refs.length === 0) {
			const fits = coerceVariable(variable.type, initial, true);
			if (!fits.ok) error(`${subject} does not fit: ${fits.problem}`, {});
		}
	}
}

/**
 * A node's writes (`set`): a known variable, exactly one of a value and an
 * expression, a template or a rule that reads known names, outcomes the
 * node can end with, no secret, and (as plain text) a value that fits.
 */
export function checkWrites(node: FlowNode, scope: Scope, error: Report): void {
	const at = { nodeId: node.id };
	const variables = new Map(
		(scope.flow.variables ?? []).map((variable) => [variable.name, variable]),
	);
	const outcomes = nodeOutcomes(node);
	for (const write of node.set ?? []) {
		const subject = `"${node.id}" sets "${write.variable}"`;
		const writeTo = `the write to "${write.variable}" on "${node.id}"`;
		const variable = variables.get(write.variable);
		if (variable === undefined) {
			error(
				`${subject}, but the flow has no variable "${write.variable}". Add it under Variables.`,
				at,
			);
		}
		const hasValue = write.value !== undefined && write.value.trim() !== "";
		const hasExpression =
			write.expression !== undefined && write.expression.trim() !== "";
		if (hasValue && hasExpression) {
			error(`${subject} with a value and an expression. Keep one.`, at);
		} else if (!hasValue && !hasExpression) {
			error(`${subject}, but has no value or expression.`, at);
		}
		const source = hasExpression
			? (write.expression ?? "")
			: (write.value ?? "");
		if (SECRET_REF.test(source)) {
			error(
				`${subject} from a secret. A variable is kept with the run, so it cannot hold a secret.`,
				at,
			);
		}
		if (hasExpression) {
			checkRule(source, `The expression of ${writeTo}`, at, scope, error);
		} else if (hasValue) {
			checkTemplate(source, `The value of ${writeTo}`, at, scope, error);
			if (variable !== undefined && templateRefs(source).length === 0) {
				const fits = coerceVariable(variable.type, source, true);
				if (!fits.ok) {
					error(`The value of ${writeTo} does not fit: ${fits.problem}`, at);
				}
			}
		}
		for (const outcome of write.on ?? []) {
			if (!outcomes.includes(outcome)) {
				error(
					`${subject} on "${outcome}", but ${describeNode(node)} ends with ${outcomes.join(", ")}.`,
					at,
				);
			}
		}
	}
}

/** A variable that no node writes and nothing reads does nothing. */
export function checkUnusedVariables(scope: Scope, warning: Report): void {
	const written = new Set<string>();
	for (const node of scope.nodes.values()) {
		for (const write of node.set ?? []) written.add(write.variable);
	}
	for (const variable of scope.flow.variables ?? []) {
		if (written.has(variable.name) || scope.readVars.has(variable.name)) {
			continue;
		}
		warning(
			`The variable "${variable.name}" is never set or read. Set it on a node, or remove it.`,
			{},
		);
	}
}

/**
 * Inputs: unique names, valid and not reserved, not the id of a node, and a
 * `json` default that parses as JSON.
 */
export function checkInputs(
	flow: Flow,
	nodes: ReadonlyMap<string, FlowNode>,
	error: Report,
): void {
	const reserved: readonly string[] = reservedNames;
	const seen = new Set<string>();
	for (const input of flow.inputs) {
		const name = input.name;
		if (seen.has(name)) {
			error(`The input "${name}" is declared more than once.`, {});
			continue;
		}
		seen.add(name);
		const valid = nameSchema.safeParse(name);
		if (!valid.success) {
			error(
				`The input "${name}" is not a valid name: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				{},
			);
		} else if (reserved.includes(name)) {
			error(`The input name "${name}" is reserved. Pick another name.`, {});
		}
		if (nodes.has(name)) {
			error(
				`The input "${name}" has the same name as the node "${name}". Rename one of them.`,
				{ nodeId: name },
			);
		}
		if (input.type === "json" && input.default !== undefined) {
			try {
				JSON.parse(input.default);
			} catch {
				error(`The default of the json input "${name}" is not valid JSON.`, {});
			}
		}
	}
}

/** Outputs: unique, valid names that every caller can read, and known templates. */
export function checkOutputs(scope: Scope, error: Report): void {
	const seen = new Set<string>();
	const builtIn: readonly string[] = outputFieldsByType.call;
	for (const output of scope.flow.outputs) {
		const name = output.name;
		if (seen.has(name)) {
			error(`The output "${name}" is declared more than once.`, {});
			continue;
		}
		seen.add(name);
		const valid = nameSchema.safeParse(name);
		if (!valid.success) {
			error(
				`The output "${name}" is not a valid name: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				{},
			);
		} else if (builtIn.includes(name)) {
			error(
				`The output "${name}" clashes with a field every Subflow node has: ${builtIn.join(", ")}.`,
				{},
			);
		}
		checkTemplate(
			output.value,
			`The value of output "${name}"`,
			{},
			scope,
			error,
		);
	}
}
