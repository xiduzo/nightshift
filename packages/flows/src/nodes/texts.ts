/**
 * The texts a node holds that can read a name of the flow: its templates,
 * the shell commands among them, and its rules (JSONata). Each node type
 * declares where they sit (`NodeDefinition.texts`), and one walk reads
 * them: a rename, the reads, Make subflow, a paste and the command checks
 * all visit the same texts.
 */

/** How Night Shift reads a text. A command is a template that a shell runs. */
export type TextKind = "template" | "command" | "rule";

/**
 * Where a node holds a text, and how Night Shift reads it. `at` names the
 * field: keys joined by `.`, `[]` for each item of a list, `{}` for each
 * value of a record (`cascade[].inputs{}`). The field holds the text only
 * where it is a string, so one position fits each branch of a union:
 * `until.command` is the command of a Wait for a command, and
 * `until.command.command` the one of a Wait for a signal or a command.
 */
export type NodeText = {
	at: string;
	/** Unset: a template. */
	kind?: "command" | "rule";
	/** The names a rule reads as its own, besides the flow's: `previous`, `current`. */
	also?: readonly string[];
	/** A variable write's value or expression: the node's own id reads the step that just ended. */
	self?: true;
};

/** One text of a node, as the walk finds it: where it sits and how it is read. */
export type TextField = {
	/** Its declared position: `options[].when`. */
	at: string;
	kind: TextKind;
	also: readonly string[];
	self: boolean;
};

/** A text of a node with its field. */
export type HeldText = TextField & { text: string };

/** The new text of one text of a node. */
export type TextRewrite = (text: string, field: TextField) => string;

/** The positions as a tree: each key once, in the order the texts first name it. */
type Branch = { field?: TextField; keys: Map<string, Branch> };

const trees = new WeakMap<readonly NodeText[], Branch>();

/** `cascade[].inputs{}`: `cascade`, `[]`, `inputs`, `{}`. */
const keysOf = (at: string): string[] =>
	at.match(/\[\]|\{\}|[^.[\]{}]+/g) ?? [];

function treeOf(texts: readonly NodeText[]): Branch {
	const known = trees.get(texts);
	if (known) return known;
	const tree: Branch = { keys: new Map() };
	for (const text of texts) {
		let branch = tree;
		for (const key of keysOf(text.at)) {
			let next = branch.keys.get(key);
			if (!next) {
				next = { keys: new Map() };
				branch.keys.set(key, next);
			}
			branch = next;
		}
		branch.field = {
			at: text.at,
			kind: text.kind ?? "template",
			also: text.also ?? [],
			self: text.self === true,
		};
	}
	trees.set(texts, tree);
	return tree;
}

/**
 * `value` with `rewrite` applied to each string at the branch, in the
 * order of the declaration, each item of a list or a record in its own
 * order with all its texts before the next item's. A field that is not
 * set stays unset. Unchanged parts keep their identity.
 */
function mapBranch(
	value: unknown,
	branch: Branch,
	rewrite: TextRewrite,
): unknown {
	if (typeof value === "string")
		return branch.field ? rewrite(value, branch.field) : value;
	if (typeof value !== "object" || value === null) return value;
	if (Array.isArray(value)) {
		const each = branch.keys.get("[]");
		if (!each) return value;
		const items = value.map((item) => mapBranch(item, each, rewrite));
		return items.some((item, index) => item !== value[index]) ? items : value;
	}
	const record = value as Record<string, unknown>;
	let out = record;
	const set = (key: string, next: unknown) => {
		if (next !== out[key]) out = { ...out, [key]: next };
	};
	for (const [key, next] of branch.keys) {
		if (key === "{}") {
			for (const [name, item] of Object.entries(record))
				set(name, mapBranch(item, next, rewrite));
		} else if (key !== "[]" && Object.hasOwn(record, key)) {
			const item = record[key];
			if (item !== undefined) set(key, mapBranch(item, next, rewrite));
		}
	}
	return out;
}

/**
 * `value` with each text at the positions `texts` declare replaced by what
 * `rewrite` gives it, in the order of the declaration.
 */
export function mapTexts<T>(
	value: T,
	texts: readonly NodeText[],
	rewrite: TextRewrite,
): T {
	return mapBranch(value, treeOf(texts), rewrite) as T;
}

/** Each text at the positions `texts` declare, in the order `mapTexts` visits them. */
export function textsIn(
	value: unknown,
	texts: readonly NodeText[],
): HeldText[] {
	const found: HeldText[] = [];
	mapBranch(value, treeOf(texts), (text, field) => {
		found.push({ ...field, text });
		return text;
	});
	return found;
}
