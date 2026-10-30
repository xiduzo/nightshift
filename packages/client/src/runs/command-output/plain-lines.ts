/**
 * The output of a command as plain lines a parser can read: no terminal
 * escapes, no progress redraws, and no more than a fixed length. Outputs can
 * be megabytes, so a parser reads the head and the tail of a long one: a test
 * run names its files at the start and sums up at the end, and a crash prints
 * its trace last.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** CSI sequences (colours, cursor moves), OSC sequences (links, titles) and two-byte escapes. */
const ESCAPES = new RegExp(
	`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`,
	"g",
);

/** The text without terminal escapes. */
export function stripAnsi(text: string): string {
	return text.includes(ESC) ? text.replace(ESCAPES, "") : text;
}

/** How much of a long output a parser reads: characters from its start and from its end. */
export type ScanSize = { head: number; tail: number };

/**
 * The part of `text` a parser reads: all of it when it is short, else its
 * first `head` and last `tail` characters, each cut at a line break.
 */
export function headAndTail(text: string, { head, tail }: ScanSize): string {
	if (text.length <= head + tail) return text;
	const headEnd = text.lastIndexOf("\n", head);
	const tailStart = text.indexOf("\n", text.length - tail);
	const first = text.slice(0, headEnd < 0 ? head : headEnd);
	const last = tailStart < 0 ? "" : text.slice(tailStart + 1);
	return `${first}\n${last}`;
}

/**
 * The lines of a command's output as a person saw them: escapes gone, CRLF
 * as LF, of a line a progress bar redrew (`\r`) only its last state, and
 * without the `package:task: ` a task runner like Turborepo puts first.
 */
export function plainLines(text: string, size: ScanSize): string[] {
	const lines = stripAnsi(headAndTail(text, size)).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (!line.includes("\r")) continue;
		const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
		const at = trimmed.lastIndexOf("\r");
		lines[i] = at < 0 ? trimmed : trimmed.slice(at + 1);
	}
	return withoutTaskPrefix(lines);
}

/** `@shop/web:test: ` before a line of a task's output. */
const TASK_PREFIX = /^@?[\w.-]+(?:\/[\w.-]+)?:[\w.-]+(?::[\w.-]+)*: ?/;

/**
 * The lines without a task runner's prefix, when most lines have one. Only
 * then: `tests/test_math.py:12: ` looks the same, on a line or two.
 */
function withoutTaskPrefix(lines: string[]): string[] {
	let filled = 0;
	let prefixed = 0;
	for (const line of lines.slice(0, 400)) {
		if (!line.trim()) continue;
		filled++;
		if (TASK_PREFIX.test(line)) prefixed++;
	}
	if (filled < 3 || prefixed / filled < 0.6) return lines;
	return lines.map((line) => line.replace(TASK_PREFIX, ""));
}

const DURATION =
	/^\s*(?:(\d+)\s*h\s*)?(?:(\d+)\s*m(?!s)\s*)?(?:(\d+(?:\.\d+)?)\s*(ms|s|secs?|seconds?)?)?\s*$/i;

/** `12ms`, `1.5s`, `0.012s`, `1m 3s`, `2.345 s`, `3 sec` as milliseconds. */
export function durationMs(text: string): number | undefined {
	const match = DURATION.exec(text);
	if (!match) return undefined;
	const [, hours, minutes, amount, unit] = match;
	if (hours === undefined && minutes === undefined && amount === undefined)
		return undefined;
	let ms = 0;
	if (hours) ms += Number(hours) * 3_600_000;
	if (minutes) ms += Number(minutes) * 60_000;
	if (amount !== undefined) {
		if (!unit && !hours && !minutes) return undefined;
		ms += Number(amount) * (unit?.toLowerCase() === "ms" ? 1 : 1000);
	}
	return Math.round(ms * 1000) / 1000;
}
