/** The tab width of a code block: the browser default, as no `tab-size` is set. */
const TAB_SIZE = 8;

/**
 * How many columns the leading whitespace of `text` takes, with a tab
 * going to the next tab stop. A line of only whitespace has no indent, as
 * it has nothing to wrap.
 */
export function leadingIndent(text: string): number {
	let columns = 0;
	for (const char of text) {
		if (char === " ") columns += 1;
		else if (char === "\t") columns += TAB_SIZE - (columns % TAB_SIZE);
		else return columns;
	}
	return 0;
}
