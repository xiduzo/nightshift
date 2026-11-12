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
 * Evaluates one rule against the context, and the names of `also` (a Since
 * last run node's `previous` and `current`), which win over the context's.
 * Throws when the expression does not parse or fails while it runs; the
 * message is JSONata's.
 */
export async function evaluateRule(
	expr: string,
	context: TemplateContext,
	also: Record<string, JsonValue> = {},
): Promise<JsonValue | undefined> {
	const compiled = jsonata(expr);
	const result: unknown = await compiled.evaluate({
		...ruleContext(context),
		...also,
	});
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

/**
 * The outcome a signal picks: the first rule (`signalRules` of a Wait)
 * that holds over `{ event }`, the signal's data, as a webhook schedule's
 * rule reads it. Null when none holds. A rule that fails does not hold.
 */
export async function signalOutcome(
	rules: readonly { outcome: string; when: string }[],
	data: JsonValue | undefined,
): Promise<string | null> {
	for (const rule of rules) {
		try {
			const result: unknown = await jsonata(rule.when).evaluate({
				event: data,
			});
			if (isTruthy(result)) return rule.outcome;
		} catch {
			// A rule that fails on this signal's data does not pick its outcome.
		}
	}
	return null;
}

/**
 * Whether a cascade tier's `accept` rule holds over the value a model
 * made, as `data` (ADR 6). Throws with JSONata's message when the rule
 * fails on it: the try does not hold then, and the message says why.
 */
export async function acceptsValue(
	expr: string,
	data: JsonValue,
): Promise<boolean> {
	const result: unknown = await jsonata(expr).evaluate({ data });
	return isTruthy(result);
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
 * The top-level names a rule reads (`build` in `build.data.x`, in
 * `$$.build.data.x` too), best effort from JSONata's AST. Names below a
 * variable (`$x.y`), in a path step that is not the first, or in a filter
 * are not top-level and are left out.
 */
export function ruleNames(expr: string): string[] {
	return [...new Set(ruleRefs(expr).map((ref) => ref.name))];
}

/** A top-level name a rule reads, with the keys after it. */
type RuleRef = { name: string; path: string[] };

/** A name a path of the rule starts with, with its step and the steps after it. */
type FoundRef = {
	name: string;
	/** The name's step in JSONata's AST, which knows where the name ends. */
	step: AstNode;
	/** The steps of the path after the name. */
	rest: readonly AstNode[];
	/** The name reads the rule's values (a top-level name), not a key of another value. */
	top: boolean;
};

/** A name in the rule and its step in JSONata's AST: what a rewrite renames. */
type NamedStep = { name: string; step: AstNode };

/**
 * Each place a rule reads a top-level name (`ruleNames`), with the plain
 * keys after it: `build` and `data.tasks` in `build.data.tasks[0].title`.
 * The keys stop after a step that filters or computes. Best effort, in
 * the order of the rule.
 */
export function ruleRefs(expr: string): RuleRef[] {
	return findRefs(expr)
		.filter((ref) => ref.top)
		.map(({ name, step, rest }) => ({ name, path: keysAfter(step, rest) }));
}

/** Every name a path of the rule starts with: at the top, and below it. */
function findRefs(expr: string): FoundRef[] {
	let ast: unknown;
	try {
		ast = jsonata(expr).ast();
	} catch {
		return [];
	}
	const refs: FoundRef[] = [];
	walk(ast, refs, true);
	return refs;
}

/**
 * Each place a rule reads a variable: the name right after `vars` at the
 * start of a path (`tries` in `vars.tries + 1`, in `$$.vars.tries` too).
 * A path below a variable (`$x.vars.tries`) or below another name
 * (`other.vars.tries`) reads no variable.
 */
function findVariableRefs(expr: string): NamedStep[] {
	return findRefs(expr).flatMap(({ name, rest }) => {
		const [next] = rest;
		return name === "vars" &&
			next?.type === "name" &&
			typeof next.value === "string"
			? [{ name: next.value, step: next }]
			: [];
	});
}

/** The words JSONata reads as an operator or a value, not as a name. */
const NOT_A_NAME = new Set([
	"and",
	"or",
	"in",
	"true",
	"false",
	"null",
	"function",
]);

/** The name as a rule writes it: bare when JSONata takes it bare, else in backticks. */
function nameInRule(name: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !NOT_A_NAME.has(name)
		? name
		: `\`${name}\``;
}

/**
 * Rewrites the top-level names a rule reads (`ruleRefs`) that `rename`
 * gives a new name for: `build` in `build.data.x`, in `` `build`.data ``
 * and `$$.build` too. Strings, `$` variables, functions and the keys below
 * a name stay. Everything else of the text stays as it is. A rule that is
 * not valid stays as a whole.
 */
export function rewriteRuleNames(
	expr: string,
	rename: (name: string) => string | undefined,
): string {
	const top = findRefs(expr).filter((ref) => ref.top);
	return rewriteSteps(expr, top, rename);
}

/**
 * Rewrites the variables a rule reads (`ruleVariableNames`) that `rename`
 * gives a new name for: `tries` in `vars.tries`, in `$$.vars.tries` too.
 * A string (`"vars.tries"`), a longer name (`vars.tries_2`) and a key
 * below another value (`$x.vars.tries`) stay, as does the rest of the
 * text. A rule that is not valid stays as a whole.
 */
export function rewriteRuleVariables(
	expr: string,
	rename: (name: string) => string | undefined,
): string {
	return rewriteSteps(expr, findVariableRefs(expr), rename);
}

/**
 * Replaces the name of each step that `rename` gives a new name for, by
 * its place in the text, so the rest stays byte for byte. A quoted name
 * stays quoted. A new name JSONata cannot take bare goes in backticks.
 */
function rewriteSteps(
	expr: string,
	found: readonly NamedStep[],
	rename: (name: string) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	const spans = found
		.flatMap(({ name, step }) => {
			const to = rename(name);
			const span = nameSpan(expr, name, step);
			return to === undefined || to === name || span === null
				? []
				: [{ ...span, to }];
		})
		.sort((a, b) => a.start - b.start);
	for (const { start, end, quoted, to } of spans) {
		if (start < cursor) continue;
		out += expr.slice(cursor, start) + (quoted ? `\`${to}\`` : nameInRule(to));
		cursor = end;
	}
	return out + expr.slice(cursor);
}

/**
 * Where the name of a step sits in the rule. JSONata puts the end of the
 * name (after its closing backtick) in `position`. Null when the text
 * there is not the name, so a rewrite never lands in the wrong place.
 */
function nameSpan(
	expr: string,
	name: string,
	step: AstNode,
): { start: number; end: number; quoted: boolean } | null {
	const end = step.position;
	if (typeof end !== "number") return null;
	const quoted = `\`${name}\``;
	if (expr.slice(end - quoted.length, end) === quoted)
		return { start: end - quoted.length, end, quoted: true };
	if (expr.slice(end - name.length, end) === name)
		return { start: end - name.length, end, quoted: false };
	return null;
}

/**
 * The variables a rule reads (`tries` in `vars.tries + 1`), best effort
 * from JSONata's AST: the name right after `vars` at the start of a path.
 */
export function ruleVariableNames(expr: string): string[] {
	return [...new Set(findVariableRefs(expr).map((ref) => ref.name))];
}

type AstNode = {
	type?: string;
	value?: unknown;
	steps?: AstNode[];
	[key: string]: unknown;
};

/**
 * The keys of an AST node that read each value it gives, not the rule's
 * values: a filter or an index (`[…]`) and a grouping (`{…}`).
 */
const OVER_EACH_VALUE = new Set(["predicate", "stages", "group"]);

/**
 * `top` is true where a path would read the rule's values: the first step
 * of a path at the top of the rule, or of a path after `$$` (the rule's
 * values everywhere) or after `$` at the top. Inside a `$` variable path,
 * after a step and in a filter, the names are keys of that value, not
 * names of the rule. Every path that starts with a name counts, `top`
 * says which kind it is.
 */
function walk(node: unknown, refs: FoundRef[], top: boolean): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, refs, top);
		return;
	}
	if (typeof node !== "object" || node === null) return;
	const ast = node as AstNode;
	if (ast.type === "path" && Array.isArray(ast.steps)) {
		walkPath(ast.steps, refs, top);
		// A grouping after the path reads each value of it.
		walk(stepChildren(ast), refs, false);
		return;
	}
	if (ast.type === "name") {
		if (typeof ast.value === "string")
			refs.push({ name: ast.value, step: ast, rest: [], top });
		return;
	}
	if (readsRoot(ast, top)) {
		// A filter on the rule's values reads them: `$$[check.ok]`.
		walk(stepChildren(ast), refs, true);
		return;
	}
	for (const [key, value] of Object.entries(ast)) {
		if (key === "type" || key === "value" || key === "position") continue;
		walk(value, refs, top && !OVER_EACH_VALUE.has(key));
	}
}

/** The steps of one path: the name it starts with, then what each later step reads. */
function walkPath(
	steps: readonly AstNode[],
	refs: FoundRef[],
	top: boolean,
): void {
	const [first, ...rest] = steps;
	if (!first) return;
	if (readsRoot(first, top)) {
		walk(first, refs, top);
		walkPath(rest, refs, true);
		return;
	}
	if (first.type === "name" && typeof first.value === "string") {
		refs.push({ name: first.value, step: first, rest, top });
		walk(stepChildren(first), refs, false);
	} else {
		walk(first, refs, top);
	}
	// Predicates and expressions inside later steps read their own value.
	for (const step of rest) walk(stepChildren(step), refs, false);
}

/**
 * Whether a path's first step is the rule's values: `$$` anywhere, `$` at
 * the top (in a filter, `$` is the value the filter tests).
 */
function readsRoot(step: AstNode, top: boolean): boolean {
	return (
		step.type === "variable" &&
		(step.value === "$" || (step.value === "" && top))
	);
}

/** The plain keys after a path's first step, up to one that filters or computes. */
function keysAfter(first: AstNode, rest: readonly AstNode[]): string[] {
	const keys: string[] = [];
	if (stepChildren(first).length > 0) return keys;
	for (const step of rest) {
		if (step.type !== "name" || typeof step.value !== "string") break;
		keys.push(step.value);
		if (stepChildren(step).length > 0) break;
	}
	return keys;
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
