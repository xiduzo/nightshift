import { TEMPLATE_REF } from "./template";

type Span = { from: number; to: number };

/** A heredoc start: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`, `<<\EOF`. */
const HEREDOC = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_]\w*))/;

/** The characters before a `#` that starts a comment. */
const WORD_BREAK = /[\s;&|()]/;

/**
 * The parts of a shell command where the shell leaves `${NAME}` as it is:
 * single quotes and the body of a quoted heredoc. A small reader, not a full
 * shell parser: text inside `"$(…)"` counts as double quoted, so a quote in
 * there is missed. It never marks too much in that case.
 */
function literalSpans(command: string): Span[] {
	const spans: Span[] = [];
	const heredocs: { end: string; stripTabs: boolean; quoted: boolean }[] = [];
	let i = 0;
	while (i < command.length) {
		const c = command[i];
		if (c === "\\") {
			i += 2;
		} else if (c === "'") {
			const to = closingSingleQuote(command, i);
			spans.push({ from: i, to });
			i = to + 1;
		} else if (c === '"') {
			i = closingDoubleQuote(command, i) + 1;
		} else if (
			c === "#" &&
			(i === 0 || WORD_BREAK.test(command[i - 1] ?? ""))
		) {
			const line = command.indexOf("\n", i);
			i = line === -1 ? command.length : line;
		} else if (c === "<" && !command.startsWith("<<<", i)) {
			const start = HEREDOC.exec(command.slice(i));
			if (start) {
				const [whole, dash, single, double, bare] = start;
				heredocs.push({
					end: single ?? double ?? bare ?? "",
					stripTabs: dash === "-",
					quoted: bare === undefined || whole.includes("\\"),
				});
				i += whole.length;
			} else {
				i += 1;
			}
		} else if (c === "\n" && heredocs.length > 0) {
			i += 1;
			for (const heredoc of heredocs.splice(0)) {
				const to = heredocEnd(command, i, heredoc.end, heredoc.stripTabs);
				if (heredoc.quoted) spans.push({ from: i, to });
				i = to;
			}
		} else {
			i += 1;
		}
	}
	return spans;
}

/** The closing `'` of the quote at `from`, or the end of the command. */
function closingSingleQuote(command: string, from: number): number {
	const ansi = command[from - 1] === "$";
	for (let i = from + 1; i < command.length; i++) {
		if (ansi && command[i] === "\\") i += 1;
		else if (command[i] === "'") return i;
	}
	return command.length;
}

/** The closing `"` of the quote at `from`, or the end of the command. */
function closingDoubleQuote(command: string, from: number): number {
	for (let i = from + 1; i < command.length; i++) {
		if (command[i] === "\\") i += 1;
		else if (command[i] === '"') return i;
	}
	return command.length;
}

/** Where the heredoc body that starts at `from` ends: after its end line. */
function heredocEnd(
	command: string,
	from: number,
	end: string,
	stripTabs: boolean,
): number {
	let at = from;
	while (at < command.length) {
		const newline = command.indexOf("\n", at);
		const lineEnd = newline === -1 ? command.length : newline;
		const line = command.slice(at, lineEnd);
		if ((stripTabs ? line.replace(/^\t+/, "") : line) === end) return lineEnd;
		at = lineEnd + 1;
	}
	return command.length;
}

/**
 * The templates of a command that the shell does not fill in. A value reaches
 * the shell as `${NS_…}`, so in single quotes or a quoted heredoc the command
 * gets that name, not the value.
 */
export function templatesInLiteralShellText(command: string): string[] {
	const spans = literalSpans(command);
	return [...command.matchAll(TEMPLATE_REF)]
		.filter(({ index }) =>
			spans.some(({ from, to }) => index >= from && index < to),
		)
		.map(([raw]) => raw);
}
