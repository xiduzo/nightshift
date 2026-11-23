/**
 * The output of an installer or a sign-in, as Night Shift reads it: plain
 * text without the escape sequences that color it, move the cursor or
 * make a link, and without carriage returns. A sign-in's output gives two
 * facts only: the sign-in address, when its host is the vendor's, and
 * whether the CLI asks for a code.
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

const ADDRESSES = /https:\/\/[^\s"'<>`]+/g;
const CODE_QUESTION =
	/paste (?:the |your )?code|code here|enter (?:the |your )?(?:authori[sz]ation |verification |one-time |login )?code/i;
const SIGNED_IN =
	/login successful|successfully (?:logged|signed) in|you are (?:now )?(?:logged|signed) in/i;

/** A link (OSC 8) keeps its visible text. */
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

/** Whether `hostname` is one of `hosts`, or a subdomain of one. */
function allowedHost(hostname: string, hosts: readonly string[]): boolean {
	return hosts.some(
		(host) => hostname === host || hostname.endsWith(`.${host}`),
	);
}

/**
 * The first https address in `text` on one of `hosts`: no other address,
 * no user name or port. An address at the very end of `text` may go on in
 * the next piece of output, so it counts only once `ended`.
 */
export function signInAddress(
	text: string,
	hosts: readonly string[],
	ended = false,
): string | null {
	for (const match of text.matchAll(ADDRESSES)) {
		if (!ended && match.index + match[0].length >= text.length) continue;
		const candidate = match[0].replace(/[.,;:!?)\]}>'"]+$/, "");
		let url: URL;
		try {
			url = new URL(candidate);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" || url.username || url.password) continue;
		if (url.port !== "" || !allowedHost(url.hostname, hosts)) continue;
		return url.href;
	}
	return null;
}

/** Whether the CLI asks for a code in `text`. */
export function asksForCode(text: string): boolean {
	return CODE_QUESTION.test(text);
}

/** Whether the CLI says in `text` that it signed in. */
export function saysSignedIn(text: string): boolean {
	return SIGNED_IN.test(text);
}
