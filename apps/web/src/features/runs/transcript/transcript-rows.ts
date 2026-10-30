import { groupToolCalls } from "@nightshift/client";
import type {
	CommandItem,
	ExitItem,
	LogItem,
	ToolItem,
	TranscriptItem,
} from "./transcript-items";

/**
 * What the transcript draws: one item, a run of tool calls folded into one
 * line, or a command with its output and its exit as one terminal.
 */
export type TranscriptRow =
	| { kind: "item"; item: TranscriptItem }
	| { kind: "tool-calls"; items: ToolItem[] }
	| { kind: "command"; command: CommandItem; log?: LogItem; exit?: ExitItem };

/** The items a row draws, in order. Select and Copy work on these. */
export function rowItems(row: TranscriptRow): TranscriptItem[] {
	switch (row.kind) {
		case "item":
			return [row.item];
		case "tool-calls":
			return row.items;
		case "command":
			return [
				row.command,
				...(row.log ? [row.log] : []),
				...(row.exit ? [row.exit] : []),
			];
	}
}

/**
 * The rows of a step's transcript. A command takes the log and the exit
 * that follow it. Two or more tool calls in a row fold into one group,
 * unless `groupTools` is off: then every call is a row of its own, so
 * Select can pick single calls.
 */
export function transcriptRows(
	items: readonly TranscriptItem[],
	{ groupTools }: { groupTools: boolean },
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	for (let at = 0; at < items.length; at++) {
		const item = items[at];
		if (!item) continue;
		if (item.kind !== "command") {
			rows.push({ kind: "item", item });
			continue;
		}
		const row: Extract<TranscriptRow, { kind: "command" }> = {
			kind: "command",
			command: item,
		};
		const next = items[at + 1];
		if (next?.kind === "log") {
			row.log = next;
			at++;
		}
		const after = items[at + 1];
		if (after?.kind === "exit") {
			row.exit = after;
			at++;
		}
		rows.push(row);
	}
	if (!groupTools) return rows;
	return groupToolCalls(
		rows,
		(row) => row.kind === "item" && row.item.kind === "tool",
	).map((grouped) =>
		grouped.kind === "item"
			? grouped.item
			: {
					kind: "tool-calls",
					items: grouped.items.flatMap((row) =>
						row.kind === "item" && row.item.kind === "tool" ? [row.item] : [],
					),
				},
	);
}
