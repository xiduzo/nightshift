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
 * The top-level names a rule reads (`build` in `build.data.x`), best
 * effort from JSONata's AST. Names below a variable (`$x.y`) or inside a
 * path step that is not the first are not top-level and are left out.
 */
export function ruleNames(expr: string): string[] {
	return [...new Set(ruleRefs(expr).map((ref) => ref.name))];
}

/** A top-level name a rule reads, with the keys after it. */
type RuleRef = { name: string; path: string[] };

/** A `RuleRef` and the name's step in JSONata's AST, which knows where the name ends. */
type FoundRef = RuleRef & { step: AstNode };

/**
 * Each place a rule reads a top-level name (`ruleNames`), with the plain
 * keys after it: `build` and `data.tasks` in `build.data.tasks[0].title`.
 * The keys stop after a step that filters or computes. Best effort, in
 * the order of the rule.
 */
export function ruleRefs(expr: string): RuleRef[] {
	return findRefs(expr).map(({ name, path }) => ({ name, path }));
}

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
 * too. Strings, `$` variables, functions and the keys below a name stay.
 * Everything else of the text stays as it is. A rule that is not valid
 * stays as a whole.
 */
export function rewriteRuleNames(
	expr: string,
	rename: (name: string) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	const spans = findRefs(expr)
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
function walk(node: unknown, refs: FoundRef[], top: boolean): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, refs, top);
		return;
	}
	if (typeof node !== "object" || node === null) return;
	const ast = node as AstNode;
	if (ast.type === "path" && Array.isArray(ast.steps)) {
		const [first, ...rest] = ast.steps;
		if (first?.type === "name" && typeof first.value === "string") {
			if (top)
				refs.push({
					name: first.value,
					path: keysAfter(first, rest),
					step: first,
				});
		} else {
			walk(first, refs, top);
		}
		// Predicates and expressions inside later steps read their own value.
		for (const step of rest) walk(stepChildren(step), refs, false);
		if (first) walk(stepChildren(first), refs, false);
		return;
	}
	if (ast.type === "name") {
		if (top && typeof ast.value === "string")
			refs.push({ name: ast.value, path: [], step: ast });
		return;
	}
	for (const [key, value] of Object.entries(ast)) {
		if (key === "type" || key === "value" || key === "position") continue;
		walk(value, refs, top);
	}
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
