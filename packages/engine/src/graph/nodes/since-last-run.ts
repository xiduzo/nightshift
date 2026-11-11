import { createHash } from "node:crypto";
import {
	evaluateRule,
	isTruthy,
	type JsonValue,
	MAX_MEMORY_KEYS,
	memoryPath,
	renderTemplate,
	renderValue,
	type SinceLastRunNode,
	type TemplateContext,
	watchesValue,
} from "@nightshift/flows";
import type { MemoryAt, Remembered, StepMemory } from "../../memory";
import {
	endedAtReason,
	messageOf,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { canonicalJson } from "../session-guards";
import { type BodyEnd, runStep, type StepHandle } from "../step-runner";

/**
 * The Since last run node: what is new or changed since the last run of
 * the flow. It reads what it remembers for its scope (`ctx.remembered`),
 * compares, and ends `new`, `changed` or `same`. What it saw new or
 * changed goes on its `StepEnded` (`memory`), which saves it in the same
 * batch: a step never ends without its memory, or the reverse.
 *
 * - A list: each item's key (`key`, a path; unset: the item itself) and a
 *   hash of its compared fields (`compare`; unset: the whole item). A key
 *   it never saw is new, a key whose hash differs is changed. A key that
 *   comes twice counts once, the first time.
 * - A value: the value of the last run is `previous`, this one `current`.
 *   `when` says whether it changed; unset: any change. The value is saved
 *   only when it differs.
 *
 * The first run (nothing remembered for the scope) gives `new`, or `same`
 * with `firstRun: "same"`, and remembers all it saw. A run of a flow that
 * is not saved (a quick run) remembers nothing: each of its runs is a
 * first run.
 *
 * Every visit is new (`RESUME_RULES.fresh`): it is pure until its end, so
 * a step the daemon left open runs again on the same memory. A mistake of
 * the flow (no list, an item without its key, a rule that fails) ends the
 * step `error`, so the run parks and a person can fix the flow.
 */
export function sinceLastRunStepNode(
	node: SinceLastRunNode,
	ctx: StepContext,
): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			body: (step) => compare(ctx, node, step),
		});
}

/** The Since last run kind: no computer, and each of its outcomes is a chosen end. */
export const SINCE_LAST_RUN: NodeKind<SinceLastRunNode> = {
	...PLAIN_KIND,
	type: "since-last-run",
	make: sinceLastRunStepNode,
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: (_node, outcome) =>
		outcome === "new" || outcome === "changed" || outcome === "same",
	endReason: (node, outcome) => endedAtReason(node, outcome),
	endedLabel: (_node, outcome) => outcome,
};

/** The longest scope a node remembers under. */
const MAX_SCOPE = 500;
/** The longest key kept as it is: a longer one is kept as its hash. */
const MAX_KEY = 200;
/** The largest value a node remembers, as JSON. */
const MAX_VALUE_BYTES = 64 * 1024;

/** A flow mistake: the step ends `error` with these words. */
class FlowMistake extends Error {}

async function compare(
	ctx: StepContext,
	node: SinceLastRunNode,
	step: StepHandle,
): Promise<BodyEnd> {
	try {
		const at = memoryAt(ctx, node, step.tctx);
		const remembered = at === null ? new Map() : await ctx.remembered(at);
		const seen = watchesValue(node)
			? await seeValue(node, step.tctx, remembered)
			: seeItems(node, step.tctx, remembered);
		const { outcome, counts } = seen;
		step.record(null, {
			type: "since-last-run",
			firstRun: remembered.size === 0,
			remembers: at !== null,
			...counts,
		});
		const memory: StepMemory | null =
			at === null || seen.memory === null
				? null
				: {
						rootFlow: at.rootFlow,
						nodePath: at.nodePath,
						scope: at.scope,
						...seen.memory,
					};
		return {
			kind: "end",
			outcome,
			outputs: { visit: step.visit, data: seen.data },
			error: null,
			...(memory ? { memory } : {}),
		};
	} catch (error) {
		if (!(error instanceof FlowMistake)) throw error;
		return {
			kind: "end",
			outcome: "error",
			outputs: { visit: step.visit },
			error: error.message,
		};
	}
}

/**
 * Where the node remembers: the run's project and top flow, the node's
 * path through the Subflow nodes, and its rendered scope. Null in a run of
 * a flow that is not saved: it remembers nothing.
 */
function memoryAt(
	ctx: StepContext,
	node: SinceLastRunNode,
	tctx: TemplateContext,
): MemoryAt | null {
	const rootFlow = ctx.run.flowName;
	if (rootFlow === null) return null;
	const scope =
		node.scope === undefined ? "" : renderTemplate(node.scope, tctx).trim();
	if (scope.length > MAX_SCOPE) {
		throw new FlowMistake(
			`The scope of "${node.id}" is longer than ${MAX_SCOPE} characters. Use a shorter value, such as an id.`,
		);
	}
	return {
		spaceId: ctx.run.spaceId,
		projectId: ctx.run.projectId,
		rootFlow,
		nodePath: [...ctx.callPath, node.id].join("/"),
		scope,
	};
}

type Outcome = "new" | "changed" | "same";

type Seen = {
	outcome: Outcome;
	data: JsonValue;
	counts: { new: number; changed: number; same: number };
	/** What to remember, or null when nothing is new or changed. */
	memory: Pick<StepMemory, "items" | "value"> | null;
};

function seeItems(
	node: SinceLastRunNode,
	tctx: TemplateContext,
	remembered: Map<string, Remembered>,
): Seen {
	const items = listOf(node, tctx);
	const first = remembered.size === 0;
	const keyPath = node.key === undefined ? null : memoryPath(node.key);
	const compared = node.compare?.map(memoryPath) ?? null;
	const fresh: JsonValue[] = [];
	const changed: JsonValue[] = [];
	const written: Record<string, string> = {};
	const counted = new Set<string>();
	let same = 0;
	items.forEach((item, index) => {
		const key = keyOf(node, item, keyPath, index);
		if (counted.has(key)) return;
		counted.add(key);
		const hash = hashOf(
			compared === null
				? item
				: compared.map((path) => valueAt(item, path) ?? null),
		);
		const known = remembered.get(key);
		if (first) {
			written[key] = hash;
			if (node.firstRun === "same") same += 1;
			else fresh.push(item);
		} else if (known === undefined) {
			written[key] = hash;
			fresh.push(item);
		} else if (known.hash !== hash) {
			written[key] = hash;
			changed.push(item);
		} else {
			same += 1;
		}
	});
	const outcome: Outcome =
		fresh.length > 0 ? "new" : changed.length > 0 ? "changed" : "same";
	return {
		outcome,
		data: { new: fresh, changed, same_count: same, first_run: first },
		counts: { new: fresh.length, changed: changed.length, same },
		memory: Object.keys(written).length > 0 ? { items: written } : null,
	};
}

/** The node's list: one reference keeps it as it is, other text is read as JSON. */
function listOf(node: SinceLastRunNode, tctx: TemplateContext): JsonValue[] {
	const rendered = renderValue(node.items ?? "", tctx);
	let list: JsonValue = rendered;
	if (typeof rendered === "string") {
		try {
			list = JSON.parse(rendered) as JsonValue;
		} catch {
			list = null;
		}
	}
	if (!Array.isArray(list)) {
		throw new FlowMistake(
			`The list of "${node.id}" is not a list. Check the format of its list: it must give a JSON list, such as {{feed.data.items}}.`,
		);
	}
	if (list.length > MAX_MEMORY_KEYS) {
		throw new FlowMistake(
			`The list of "${node.id}" has ${list.length} items. Since last run remembers at most ${MAX_MEMORY_KEYS}. Give it a shorter list.`,
		);
	}
	return list;
}

/** An item's key as text: its key's value, or the item itself. A long key is kept as its hash. */
function keyOf(
	node: SinceLastRunNode,
	item: JsonValue,
	keyPath: string[] | null,
	index: number,
): string {
	const value = keyPath === null ? item : valueAt(item, keyPath);
	if (value === undefined || value === null || value === "") {
		throw new FlowMistake(
			`Item ${index + 1} of the list of "${node.id}" has no ${node.key ?? "value"}. Check the key of the node, or the list.`,
		);
	}
	const text = typeof value === "string" ? value : canonicalJson(value);
	return text.length > MAX_KEY ? `sha256:${hashOf(text)}` : text;
}

async function seeValue(
	node: SinceLastRunNode,
	tctx: TemplateContext,
	remembered: Map<string, Remembered>,
): Promise<Seen> {
	const current = renderValue(node.value ?? "", tctx);
	if (JSON.stringify(current).length > MAX_VALUE_BYTES) {
		throw new FlowMistake(
			`The value of "${node.id}" is larger than 64 KB. Watch a smaller part of it, or a list with a key.`,
		);
	}
	const first = remembered.size === 0;
	const previous = remembered.get("")?.value ?? null;
	const differs = first || canonicalJson(previous) !== canonicalJson(current);
	let outcome: Outcome;
	if (first) {
		outcome = node.firstRun === "same" ? "same" : "new";
	} else if (node.when !== undefined && node.when.trim() !== "") {
		let result: JsonValue | undefined;
		try {
			result = await evaluateRule(node.when, tctx, { previous, current });
		} catch (error) {
			throw new FlowMistake(
				`The rule of "${node.id}" failed: ${ruleMessage(error)}`,
			);
		}
		outcome = isTruthy(result) ? "changed" : "same";
	} else {
		outcome = differs ? "changed" : "same";
	}
	return {
		outcome,
		data: {
			new: outcome === "new" ? [current] : [],
			changed: outcome === "changed" ? [current] : [],
			same_count: outcome === "same" ? 1 : 0,
			first_run: first,
			previous,
			current,
		},
		counts: {
			new: outcome === "new" ? 1 : 0,
			changed: outcome === "changed" ? 1 : 0,
			same: outcome === "same" ? 1 : 0,
		},
		memory: differs ? { value: current } : null,
	};
}

/** The value at a path of an item: a key of an object, or an index of a list. */
function valueAt(
	item: JsonValue,
	path: readonly string[],
): JsonValue | undefined {
	let value: JsonValue | undefined = item;
	for (const key of path) {
		if (Array.isArray(value)) value = value[Number(key)];
		else if (value !== null && typeof value === "object") value = value[key];
		else return undefined;
	}
	return value;
}

/** A short hash of a value's canonical JSON: two equal values give one hash. */
function hashOf(value: unknown): string {
	return createHash("sha256")
		.update(canonicalJson(value))
		.digest("base64url")
		.slice(0, 22);
}

/** JSONata throws plain objects with a `message`, not Errors. */
function ruleMessage(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return messageOf(error);
}
