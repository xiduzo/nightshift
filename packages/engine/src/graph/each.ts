import {
	type JsonValue,
	type ListItem,
	normalizeList,
	renderValue,
	type TemplateContext,
} from "@nightshift/flows";
import type { DerivedItem, ItemFacts, StepOutputs } from "../log";

/**
 * The pure parts of a Call step with `each`: turning a source's JSON into
 * list items, the facts the log keeps of an element, and the step's outputs.
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

/**
 * Parses what a command printed as one JSON value: a Command node with
 * `output: "json"`, or a command source. Throws with a readable message.
 */
export function parseCommandJson(stdout: string, what: string): JsonValue {
	try {
		return JSON.parse(stdout) as JsonValue;
	} catch (error) {
		throw new Error(
			`${what} did not print JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Parses what a command source prints: a JSON array of elements. */
export function parseCommandItems(stdout: string): ListItem[] {
	const json = parseCommandJson(stdout, "The source command");
	return listOf(json, "The source command printed JSON that is not a list");
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

/** An element that did not start in this visit, and what it waits on. */
export type WaitingItem = { id: string; blockers: readonly string[] };

/** `#14 waits on #12, #13`, or `#14 not started` when no blocker holds it. */
function waitingLine(item: WaitingItem): string {
	const label = itemLabel(item);
	return item.blockers.length > 0
		? `${label} waits on ${item.blockers.map((id) => itemLabel({ id })).join(", ")}`
		: `${label} not started`;
}

/** The outputs of a Call step with `each` (`callEachOutputFields`). */
export function eachOutputs(input: {
	items: readonly DerivedItem[];
	visit: number;
	outcome: string;
	waiting: readonly WaitingItem[];
}): StepOutputs {
	const count = (state: DerivedItem["state"]) =>
		input.items.filter((item) => item.state === state).length;
	return {
		outcome: input.outcome,
		done_count: count("done"),
		failed_count: count("failed"),
		blocked_count: count("blocked"),
		waiting_count: input.waiting.length,
		summary: [
			...input.items.map(itemLine),
			...input.waiting.map(waitingLine),
		].join("\n"),
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
