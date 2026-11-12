/**
 * The output of an installer or a sign-in as plain text: without the
 * escape sequences that color it, move the cursor or make a link, and
 * without carriage returns. A link (OSC 8) keeps its visible text.
 */

const ESCAPES = new RegExp(
	[
		// OSC: a link, a window title. Ends at BEL or ST.
		"\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)",
		// CSI: colors, cursor moves, erasing.
		"\\u001b\\[[0-?]*[ -/]*[@-~]",
		// Any other escape of one or two characters.
		"\\u001b[@-Z\\\\-_]",
		"\\u009b[0-?]*[ -/]*[@-~]",
	].join("|"),
	"g",
);

export function plainText(text: string): string {
	return (
		text
			.replace(ESCAPES, "")
			// A line the program wrote again: keep its last version.
			.replace(/\r\n/g, "\n")
			.replace(/[^\n]*\r(?!\n)/g, "")
			// Other control characters, but tabs and newlines.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what goes
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
	);
}

/** The last `max` characters of a text, from the start of a line. */
export function tailOf(text: string, max: number): string {
	if (text.length <= max) return text.trim();
	const cut = text.slice(-max);
	const line = cut.indexOf("\n");
	return (line >= 0 ? cut.slice(line + 1) : cut).trim();
}
