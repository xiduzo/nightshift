import {
	type JsonValue,
	type ListItem,
	normalizeList,
	renderValue,
	type TemplateContext,
} from "@nightshift/flows";

import type { DerivedItem, ItemFacts, StepOutputs } from "./events";

/**
 * The pure parts of a For Each step: turning a source's JSON into list
 * items, the facts the log keeps of an element, and the step's outputs.
 */

/** Normalizes a source's JSON value, or throws with a readable message. */
export function listOf(value: JsonValue, what: string): ListItem[] {
	const result = normalizeList(value);
	if (!result.ok) throw new Error(`${what}: ${result.error}`);
	return result.items;
}

/**
 * The list of a `json` source. One reference keeps its value (often an
 * agent's `data`); any other text, or a reference to text, is parsed as JSON.
 */
export function jsonSourceItems(
	template: string,
	context: TemplateContext,
): ListItem[] {
	let value = renderValue(template, context);
	if (typeof value === "string") {
		const text = value;
		try {
			value = JSON.parse(text) as JsonValue;
		} catch {
			const shown = text.length > 200 ? `${text.slice(0, 200)}…` : text;
			throw new Error(
				`The list "${template}" did not render a JSON array: ${shown || "(empty)"}`,
			);
		}
	}
	return listOf(value, `The list "${template}"`);
}

/** Parses what a command source prints: a JSON array of elements. */
export function parseCommandItems(stdout: string): ListItem[] {
	let json: JsonValue;
	try {
		json = JSON.parse(stdout) as JsonValue;
	} catch (error) {
		throw new Error(
			`The source command did not print JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return listOf(json, "The source command printed JSON that is not a list");
}

/**
 * The files in `cwd` that match `pattern`, sorted by path, as elements
 * `{ id: path, title: path, path }`. The pattern stays inside `cwd`: an
 * absolute pattern or a `..` segment is refused.
 */
export async function fileItems(
	cwd: string,
	glob: string,
): Promise<ListItem[]> {
	const trimmed = glob.trim();
	if (trimmed === "") throw new Error("The glob of the files source is empty.");
	if (
		trimmed.startsWith("/") ||
		trimmed.startsWith("~") ||
		/^[A-Za-z]:[\\/]/.test(trimmed) ||
		/(^|[\\/{,])\.\.([\\/},]|$)/.test(trimmed)
	) {
		throw new Error(
			`The glob "${trimmed}" reaches outside the worktree. Use a path relative to it, without "..".`,
		);
	}
	const pattern = trimmed;
	const paths: string[] = [];
	for await (const path of new Bun.Glob(pattern).scan({
		cwd,
		onlyFiles: true,
	})) {
		if (path === ".git" || path.startsWith(".git/")) continue;
		paths.push(path);
	}
	paths.sort();
	return listOf(
		paths.map((path) => ({ id: path, title: path, path })),
		`The files "${pattern}"`,
	);
}

export function toItemFacts(item: ListItem): ItemFacts {
	return { id: item.id, title: item.title, url: item.url, value: item.value };
}

/** How an element reads in summaries: `#12` for a number, else its id. */
export function itemLabel(item: { id: string }): string {
	return /^\d+$/.test(item.id) ? `#${item.id}` : item.id;
}

/** One line per element: `#12 done`, `#13 blocked by #12`, `#14 failed: …`. */
export function itemLine(item: DerivedItem): string {
	const label = itemLabel(item.facts);
	switch (item.state) {
		case "done":
		case "running":
			return `${label} ${item.state}`;
		case "blocked":
			return `${label} ${item.reason ?? "blocked"}`;
		case "failed":
			return item.reason
				? `${label} failed: ${firstLine(item.reason)}`
				: `${label} failed`;
		case "halted":
			return item.reason
				? `${label} halted: ${firstLine(item.reason)}`
				: `${label} halted`;
	}
}

function firstLine(text: string): string {
	return text.split("\n")[0] ?? "";
}

/** The outputs of a For Each step (`outputFieldsByType.foreach`). */
export function forEachOutputs(input: {
	items: readonly DerivedItem[];
	visit: number;
	outcome: string;
	waitingCount: number;
}): StepOutputs {
	const count = (state: DerivedItem["state"]) =>
		input.items.filter((item) => item.state === state).length;
	return {
		outcome: input.outcome,
		done_count: count("done"),
		failed_count: count("failed"),
		blocked_count: count("blocked"),
		waiting_count: input.waitingCount,
		summary: input.items.map(itemLine).join("\n"),
		results: input.items.map((item) => ({
			id: item.facts.id,
			title: item.facts.title,
			state: item.state,
			reason: item.reason,
			outputs: item.outputs,
		})),
		visit: input.visit,
	};
}
