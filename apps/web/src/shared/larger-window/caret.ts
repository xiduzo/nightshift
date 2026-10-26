/** A field's selection: where it starts and where it ends. */
export type Caret = readonly [start: number, end: number];

/**
 * How far to scroll a field so the line with the cursor shows near the
 * middle, a little above it: that line's share of all lines. It stays
 * within what the field can scroll.
 */
export function scrollTopNear(
	text: string,
	start: number,
	scrollHeight: number,
	clientHeight: number,
): number {
	const lines = text.split("\n").length;
	const before = text.slice(0, start).split("\n").length;
	const most = Math.max(0, scrollHeight - clientHeight);
	return Math.min(
		most,
		Math.max(0, (scrollHeight * before) / lines - clientHeight / 2),
	);
}
