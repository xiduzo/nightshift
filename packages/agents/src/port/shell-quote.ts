/**
 * Shell quoting, in two forms that give different output on purpose:
 * - `shellQuote` quotes only when the value needs it, so a person reads a
 *   short command: `claude --resume abc-123`, `cd /work && …`.
 * - `shellQuoteAlways` quotes every value, for a command string that a
 *   harness adapter runs through `sh -c`.
 * Both quote the same way: in single quotes, with `'` written as `'\''`.
 * Pure, so the browser-safe entries may use it.
 */

/** A value that a shell reads as one word, as it is. */
const SAFE_WORD = /^[\w@%+=:,./-]+$/;

/** Quote one value for `sh -c`, always: `'codex'`. */
export function shellQuoteAlways(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Quote one value for a shell, only when it needs it: `abc` stays `abc`. */
export function shellQuote(value: string): string {
	return SAFE_WORD.test(value) ? value : shellQuoteAlways(value);
}
