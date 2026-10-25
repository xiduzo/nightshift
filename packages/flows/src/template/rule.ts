import { Refusal } from "@nightshift/refusal";
import jsonata from "jsonata";
import type { JsonValue, Option } from "../nodes";
import type { TemplateContext } from "./context";

/**
 * Rules: the `when` of a Decision option, a JSONata expression over the
 * same values templates see. The context is one object whose top-level
 * keys are `run`, `vars`, every input name and every node id, so
 * `build.data.tests_passed = true and check.exit_code = 0` reads the
 * outputs of the nodes `build` and `check`. A name JSONata cannot take
 * bare (one with `-`) goes in backticks: `` `my-input` = "x" ``.
 *
 * Precedence is the template lookup's: `run`, then inputs, then nodes.
 */

/** The object a rule is evaluated against. */
export function ruleContext(
	context: TemplateContext,
): Record<string, JsonValue> {
	return {
		...context.nodes,
		...context.inputs,
		run: context.run,
		vars: context.vars ?? {},
	};
}

/** JSONata's own idea of true: `$boolean(value)`. */
export function isTruthy(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") return value.length > 0;
	if (Array.isArray(value)) return value.some(isTruthy);
	if (typeof value === "object") return Object.keys(value).length > 0;
	return false;
}

/**
 * Evaluates one rule against the context. Throws when the expression does
 * not parse or fails while it runs; the message is JSONata's.
 */
export async function evaluateRule(
	expr: string,
	context: TemplateContext,
): Promise<JsonValue | undefined> {
	const compiled = jsonata(expr);
	const result: unknown = await compiled.evaluate(ruleContext(context));
	return result as JsonValue | undefined;
}

/** What each rule gave, in option order, up to the one that matched. */
export type RuleEvaluation = {
	option: string;
	/** The rule's value, or `null` for the default option (it has no rule). */
	result: JsonValue | null;
};

export type RuleOutcome = {
	/** The option that matched, or null when none did. */
	matched: string | null;
	evaluated: RuleEvaluation[];
};

/**
 * Picks the first option whose `when` holds. Options are tried in order;
 * an option without `when` matches at once (the default). Throws on the
 * first rule that fails, with the option named.
 */
export async function chooseByRule(
	options: readonly Option[],
	context: TemplateContext,
): Promise<RuleOutcome> {
	const evaluated: RuleEvaluation[] = [];
	for (const option of options) {
		if (option.when === undefined || option.when.trim() === "") {
			evaluated.push({ option: option.name, result: null });
			return { matched: option.name, evaluated };
		}
		let result: JsonValue | undefined;
		try {
			result = await evaluateRule(option.when, context);
		} catch (error) {
			// The person wrote the rule: JSONata's words say what to fix in it.
			throw new Refusal(
				"invalid",
				`The rule of option "${option.name}" failed: ${ruleMessage(error)}`,
			);
		}
		evaluated.push({ option: option.name, result: result ?? null });
		if (isTruthy(result)) return { matched: option.name, evaluated };
	}
	return { matched: null, evaluated };
}

/** Why the rule is not valid JSONata, or null when it parses. */
export function ruleProblem(expr: string): string | null {
	try {
		jsonata(expr);
		return null;
	} catch (error) {
		return ruleMessage(error);
	}
}

/** JSONata throws plain objects with a `message`, not Errors. */
export function ruleMessage(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return String(error);
}

/**
 * The top-level names a rule reads (`build` in `build.data.x`), best
 * effort from JSONata's AST. Names below a variable (`$x.y`) or inside a
 * path step that is not the first are not top-level and are left out.
 */
export function ruleNames(expr: string): string[] {
	let ast: unknown;
	try {
		ast = jsonata(expr).ast();
	} catch {
		return [];
	}
	const names = new Set<string>();
	walk(ast, names, true);
	return [...names];
}

/**
 * The variables a rule reads (`tries` in `vars.tries + 1`), best effort
 * from JSONata's AST: the name right after a top-level `vars`.
 */
export function ruleVariableNames(expr: string): string[] {
	let ast: unknown;
	try {
		ast = jsonata(expr).ast();
	} catch {
		return [];
	}
	const names = new Set<string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (typeof node !== "object" || node === null) return;
		const ast = node as AstNode;
		if (ast.type === "path" && Array.isArray(ast.steps)) {
			const [first, second] = ast.steps;
			if (
				first?.type === "name" &&
				first.value === "vars" &&
				second?.type === "name" &&
				typeof second.value === "string"
			) {
				names.add(second.value);
			}
		}
		for (const [key, value] of Object.entries(ast)) {
			if (key === "type" || key === "value" || key === "position") continue;
			visit(value);
		}
	};
	visit(ast);
	return [...names];
}

type AstNode = {
	type?: string;
	value?: unknown;
	steps?: AstNode[];
	[key: string]: unknown;
};

/**
 * `top` is true where a path would read the context: the first step of a
 * path whose first step is a name. Inside a `$` variable path or after a
 * step, the names are keys of that value, not context names.
 */
function walk(node: unknown, names: Set<string>, top: boolean): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, names, top);
		return;
	}
	if (typeof node !== "object" || node === null) return;
	const ast = node as AstNode;
	if (ast.type === "path" && Array.isArray(ast.steps)) {
		const [first, ...rest] = ast.steps;
		if (first?.type === "name" && typeof first.value === "string") {
			if (top) names.add(first.value);
		} else {
			walk(first, names, top);
		}
		// Predicates and expressions inside later steps read their own value.
		for (const step of rest) walk(stepChildren(step), names, false);
		if (first) walk(stepChildren(first), names, false);
		return;
	}
	if (ast.type === "name") {
		if (top && typeof ast.value === "string") names.add(ast.value);
		return;
	}
	for (const [key, value] of Object.entries(ast)) {
		if (key === "type" || key === "value" || key === "position") continue;
		walk(value, names, top);
	}
}

/** Everything of a path step but its own name: predicates, stages, grouping. */
function stepChildren(step: AstNode | undefined): unknown[] {
	if (!step) return [];
	return Object.entries(step)
		.filter(
			([key]) =>
				key !== "type" &&
				key !== "value" &&
				key !== "position" &&
				key !== "steps",
		)
		.map(([, value]) => value);
}
