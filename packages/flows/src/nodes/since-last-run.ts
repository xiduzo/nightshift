import { z } from "zod";
import { type NodeCheck, nodeBase } from "./base";

/**
 * The Since last run node: what is new or changed since the last run of
 * the flow. It remembers what it saw (its memory, kept with the run
 * history of the project), so the next run compares with that.
 *
 * - A list (`items`): each item has a key (`key`, a path in the item; unset:
 *   the item itself). An item whose key it never saw is new. An item whose
 *   compared fields (`compare`; unset: the whole item) differ from what it
 *   saw is changed. The rest is the same.
 * - A value (`value`): it compares the value with the one of the last run.
 *   `when`, a rule over `previous` and `current`, says when it changed
 *   (`current > 100 and previous <= 100`). Unset: any change.
 *
 * Outcomes: `new` when anything is new, else `changed` when anything
 * changed, else `same`. Each one ends the flow when no edge leaves on it.
 * The first run (nothing remembered yet) counts everything as new, or as
 * the same with `firstRun: "same"`.
 *
 * `scope` (a template) splits the memory: each rendered scope remembers on
 * its own, for example one per feed. Two Subflow nodes that call one flow
 * each keep their own memory. A run of a flow that is not saved (a quick
 * run) remembers nothing. The memory is saved when the step ends: a later
 * step that fails does not take it back.
 */

/** What the first run gives: everything is new, or everything is the same. */
export const sinceLastRunFirstSchema = z.enum(["new", "same"]);

/** A path in an item: `id`, `link`, `user.id`. Digits index a list. */
const pathSchema = z.string().min(1).max(200);

export const sinceLastRunNodeSchema = z.object({
	...nodeBase,
	type: z.literal("since-last-run"),
	/**
	 * The list, a template: `{{feed.data.items}}`. A template that is one
	 * reference keeps the list as it is; other text is read as JSON.
	 */
	items: z.string().optional(),
	/** The path of an item's key: `id`, `link`. Unset: the item itself (a list of text or numbers). */
	key: pathSchema.optional(),
	/** The paths whose change makes an item changed. Unset: the whole item. */
	compare: z.array(pathSchema).max(50).optional(),
	/** The value to watch, a template: `{{price.data.usd}}`. Instead of `items`. */
	value: z.string().optional(),
	/** A rule over `previous` and `current` that holds when the value changed. Unset: any change. */
	when: z.string().optional(),
	/** A template that splits the memory: `{{feed_url}}`. Unset: one memory for the node. */
	scope: z.string().optional(),
	/** What the first run gives. Unset: `new`. */
	firstRun: sinceLastRunFirstSchema.optional(),
});
export type SinceLastRunNode = z.infer<typeof sinceLastRunNodeSchema>;

/** The outcomes of a Since last run node, in the order its handles show. */
export const sinceLastRunOutcomes = ["new", "changed", "same"] as const;

/**
 * data: `new` and `changed` (the items), `same_count`, and `first_run`
 * (nothing was remembered). A value also gives `previous` and `current`.
 */
export const sinceLastRunOutputFields = ["outcome", "data", "visit"] as const;

/** The most keys one Since last run node remembers. The oldest go first. */
export const MAX_MEMORY_KEYS = 10_000;

/** Whether the node watches one value, not a list. */
export function watchesValue(node: SinceLastRunNode): boolean {
	return node.value !== undefined;
}

/** The keys of a path: `user.id` → `["user", "id"]`. Empty for a path with an empty part. */
export function memoryPath(path: string): string[] {
	const keys = path.split(".");
	return keys.some((key) => key.trim() === "") ? [] : keys;
}

/**
 * A Since last run node has a list or a value, not both. A list reads its
 * key and compared fields, a value its rule. Its templates read known
 * names, and its rule reads `previous`, `current` and the run's values.
 */
export function checkSinceLastRunNode(
	node: SinceLastRunNode,
	check: NodeCheck,
): void {
	const subject = `Since last run node "${node.id}"`;
	const items = node.items?.trim() ?? "";
	const value = node.value?.trim() ?? "";
	if ((items === "") === (value === "")) {
		check.error(
			items === ""
				? `${subject} needs a list or a value to watch. Give it one of the two.`
				: `${subject} has a list and a value. Keep one of the two.`,
		);
	}
	if (items !== "") check.template(items, "list");
	if (value !== "") check.template(value, "value");
	if (node.scope !== undefined) check.template(node.scope, "scope");
	if (value !== "" && (node.key !== undefined || node.compare !== undefined)) {
		check.error(
			`${subject} watches a value, so it reads no key and no fields to compare. Remove them, or watch a list.`,
		);
	}
	if (value === "" && node.when !== undefined) {
		check.error(
			`${subject} watches a list, so it reads no rule. Remove the rule, or watch a value.`,
		);
	}
	for (const path of [node.key, ...(node.compare ?? [])]) {
		if (path !== undefined && memoryPath(path).length === 0) {
			check.error(
				`${subject} has the path "${path}", which is not valid. Name the fields with dots between them: user.id.`,
			);
		}
	}
	if (node.when !== undefined && node.when.trim() !== "") {
		check.rule(node.when, `The rule of "${node.id}"`, ["previous", "current"]);
	}
}
