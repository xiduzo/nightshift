import type { JsonValue } from "@nightshift/flows";
import { markdownTable } from "markdown-table";
import type { Nodes, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { toString as textOf } from "mdast-util-to-string";
import { gfmTable } from "micromark-extension-gfm-table";
import { ConvertProblem, cellText, columnsOf, recordsOf } from "./problem";

/**
 * A Markdown table (GitHub's table syntax) with mdast-util-from-markdown
 * and its table extension, and markdown-table to write one. Reading takes
 * the first table of the text: its header row names the columns, and every
 * row becomes a record of text, as CSV does.
 */

export function readMarkdownTable(text: string): Record<string, string>[] {
	const tree = fromMarkdown(text, {
		extensions: [gfmTable()],
		mdastExtensions: [gfmTableFromMarkdown()],
	});
	const table = firstTable(tree);
	if (table === null) {
		throw new ConvertProblem(
			"The text has no Markdown table. A table has a header row, then a row such as | --- | --- |.",
		);
	}
	const [header, ...rows] = table.children;
	const columns = uniqueNames(
		(header?.children ?? []).map((cell, index) => {
			const name = textOf(cell).trim();
			return name === "" ? `column_${index + 1}` : name;
		}),
	);
	return rows.map((row) =>
		Object.fromEntries(
			columns.map((column, index) => {
				const cell = row.children[index];
				return [column, cell === undefined ? "" : textOf(cell).trim()];
			}),
		),
	);
}

export function writeMarkdownTable(value: JsonValue): string {
	const records = recordsOf(value, "A Markdown table");
	if (records.length === 0) return "";
	const columns = columnsOf(records);
	return markdownTable([
		columns.map(cellOf),
		...records.map((record) =>
			columns.map((column) => cellOf(cellText(record[column]))),
		),
	]);
}

/** A cell's text that keeps the table whole: a `|` escaped, a line break a space. */
function cellOf(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function firstTable(node: Nodes): Table | null {
	if (node.type === "table") return node;
	if (!("children" in node)) return null;
	for (const child of node.children) {
		const found = firstTable(child);
		if (found !== null) return found;
	}
	return null;
}

/** Column names, with a number added to a name that repeats: `name`, `name_2`. */
function uniqueNames(names: readonly string[]): string[] {
	const seen = new Map<string, number>();
	return names.map((name) => {
		const count = (seen.get(name) ?? 0) + 1;
		seen.set(name, count);
		return count === 1 ? name : `${name}_${count}`;
	});
}
