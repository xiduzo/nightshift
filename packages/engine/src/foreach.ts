import type { ItemField, SourceItem } from "@nightshift/flows";
import { z } from "zod";

import type { DerivedItem, ItemFacts, StepOutputs } from "./events";

/**
 * The pure parts of a For Each step: parsing a command source, the facts the
 * log keeps of an item, its template fields, and the step's outputs.
 */

const idSchema = z.union([z.string().min(1), z.number()]).transform(String);

const commandItemSchema = z.object({
	id: idSchema,
	title: z.string(),
	number: z.number().int().optional(),
	body: z.string().optional(),
	url: z.string().optional(),
	/** Ids of items that must be done first, or `{ id, done }` for one outside the list. */
	blockedBy: z
		.array(
			z.union([
				idSchema,
				z.object({ id: idSchema, done: z.boolean().default(false) }),
			]),
		)
		.default([]),
	done: z.boolean().default(false),
	parentNumber: z.number().int().optional(),
	parentTitle: z.string().optional(),
});

/**
 * Parses what a command source prints: a JSON array of
 * `{ id, title, body?, url?, blockedBy?: id[], done?: boolean }`. A blocker
 * in the list is done when that item is; one outside the list is not, unless
 * it says `{ id, done: true }`. Throws with a readable message.
 */
export function parseCommandItems(stdout: string): SourceItem[] {
	let json: unknown;
	try {
		json = JSON.parse(stdout);
	} catch (error) {
		throw new Error(
			`The source command did not print JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const result = z.array(commandItemSchema).safeParse(json);
	if (!result.success) {
		const issue = result.error.issues[0];
		const at = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
		throw new Error(
			`The source command printed JSON that is not a list of items${at}: ${issue?.message ?? "invalid"}`,
		);
	}
	const parsed = result.data;
	const ids = new Set<string>();
	for (const item of parsed) {
		if (ids.has(item.id)) {
			throw new Error(
				`The source command printed the item id "${item.id}" more than once.`,
			);
		}
		ids.add(item.id);
	}
	const doneById = new Map(parsed.map((item) => [item.id, item.done]));
	return parsed.map((item) => {
		const source: SourceItem = {
			id: item.id,
			title: item.title,
			blockedBy: item.blockedBy.map((blocker) =>
				typeof blocker === "string"
					? { id: blocker, done: doneById.get(blocker) ?? false }
					: { id: blocker.id, done: doneById.get(blocker.id) ?? blocker.done },
			),
			done: item.done,
		};
		if (item.number !== undefined) source.number = item.number;
		else if (/^\d+$/.test(item.id)) source.number = Number(item.id);
		if (item.body !== undefined) source.body = item.body;
		if (item.url !== undefined) source.url = item.url;
		if (item.parentNumber !== undefined)
			source.parentNumber = item.parentNumber;
		if (item.parentTitle !== undefined) source.parentTitle = item.parentTitle;
		return source;
	});
}

export function toItemFacts(item: SourceItem): ItemFacts {
	return {
		id: item.id,
		number: item.number ?? null,
		title: item.title,
		body: item.body ?? null,
		url: item.url ?? null,
		parentNumber: item.parentNumber ?? null,
		parentTitle: item.parentTitle ?? null,
	};
}

/** How an item reads in summaries: `#12`. */
export function itemLabel(item: { id: string; number: number | null }): string {
	return `#${item.number ?? item.id}`;
}

/** `{{item.<field>}}` values of the item a body runs for. */
export function itemTemplateFields(input: {
	facts: ItemFacts;
	index: number;
	branch: string;
	baseBranch: string | null;
}): Partial<Record<ItemField, string | number>> {
	const { facts } = input;
	return {
		id: facts.id,
		number: facts.number ?? "",
		title: facts.title,
		body: facts.body ?? "",
		url: facts.url ?? "",
		index: input.index,
		branch: input.branch,
		base_branch: input.baseBranch ?? "",
		parent_number: facts.parentNumber ?? "",
		parent_title: facts.parentTitle ?? "",
	};
}

/** One line per item: `#12 done`, `#13 blocked by #12`, `#14 failed: …`. */
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
		visit: input.visit,
	};
}
