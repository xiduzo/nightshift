import { TEMPLATE_REF } from "@nightshift/flows";

/** One line of a before/after view: kept, added or removed. */
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * The lines of `before` and `after`, in order, each kept, removed or added:
 * the longest common run of lines stays, the rest changes. An empty text
 * has no lines, so a new prompt is all added lines.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before === "" ? [] : before.split("\n");
	const b = after === "" ? [] : after.split("\n");
	// lengths[i][j]: the longest common run of a[i..] and b[j..].
	const lengths = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			const row = lengths[i] as number[];
			const next = lengths[i + 1] as number[];
			row[j] =
				a[i] === b[j]
					? (next[j + 1] as number) + 1
					: Math.max(next[j] as number, row[j + 1] as number);
		}
	}
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			lines.push({ kind: "same", text: a[i] as string });
			i++;
			j++;
		} else if (
			(lengths[i + 1]?.[j] as number) >= (lengths[i]?.[j + 1] as number)
		) {
			lines.push({ kind: "removed", text: a[i] as string });
			i++;
		} else {
			lines.push({ kind: "added", text: b[j] as string });
			j++;
		}
	}
	for (; i < a.length; i++)
		lines.push({ kind: "removed", text: a[i] as string });
	for (; j < b.length; j++) lines.push({ kind: "added", text: b[j] as string });
	return lines;
}

/**
 * A line cut into plain text and `{{references}}`, to show the references
 * apart: the ones a run fills in (`TEMPLATE_REF`).
 */
export function templateParts(line: string): { text: string; ref: boolean }[] {
	const parts: { text: string; ref: boolean }[] = [];
	let at = 0;
	for (const match of line.matchAll(TEMPLATE_REF)) {
		if (match.index > at) {
			parts.push({ text: line.slice(at, match.index), ref: false });
		}
		parts.push({ text: match[0], ref: true });
		at = match.index + match[0].length;
	}
	if (at < line.length) parts.push({ text: line.slice(at), ref: false });
	return parts;
}
