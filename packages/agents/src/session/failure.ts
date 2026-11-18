/**
 * How a session failed: what a failure text says about why the harness
 * stopped (`failureKind`), when a usage limit ends, and the words a person
 * sees for an error the chunk stream threw. The translator sorts its
 * terminal event with these (`translate.ts`).
 */

import { Refusal } from "@nightshift/refusal";
import type { AgentErrorKind, AgentEvent } from "../port";
import { toEpochMs } from "./raw-value";

/**
 * A usage or primary rate limit: the account is out of usage for now. Ported
 * from `LIMITED` in `night-shift.py`, plus Claude Code's own wording.
 */
const USAGE_LIMIT_TEXT =
	/usage limit|session limit|weekly limit|hit your (?:\w+ )?limit|limit reached|out of (?:extra )?usage|rate.?limit|\b429\b|too many requests|quota/i;

/**
 * The service cannot be reached: DNS, refused or reset connections, timeouts,
 * TLS, HTTP 5xx, and GitHub's secondary rate limit (a short back-off, not an
 * exhausted account). Ported from `OFFLINE` in `night-shift.py` (without its
 * own "did not finish in" timeout text), plus the wording of Claude Code's API
 * errors (`API Error: 529 …`, `Connection error.`, `Request timed out.`),
 * Bun's fetch errors as OpenCode reports them (`Unable to connect`), Codex's
 * (`stream disconnected …`, `error sending request …`), and Node's socket
 * error codes.
 */
const NETWORK_TEXT = new RegExp(
	[
		"error connecting to",
		"could not resolve host",
		"no such host",
		"name resolution",
		"network is (?:unreachable|down)",
		"connection (?:refused|reset|timed out|closed|error)",
		"operation timed out",
		"request timed out",
		"i/o timeout",
		"tls handshake",
		"unexpected eof",
		"remote end hung up",
		"socket hang up",
		"fetch failed",
		"unable to connect",
		"socket connection was closed",
		"stream disconnected",
		"error sending request",
		"\\bHTTP 5\\d\\d\\b",
		"\\bapi error\\W{0,3}5\\d\\d\\b",
		"bad gateway",
		"service unavailable",
		"gateway time-?out",
		"overloaded",
		"secondary rate.?limit",
		"\\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE|ConnectionRefused)\\b",
	].join("|"),
	"i",
);

/** GitHub's secondary rate limit says "rate limit" but is a network wait. */
const SECONDARY_RATE_LIMIT = /secondary rate.?limit/i;

/** Older Claude Code versions end the message with `|<epoch seconds>`. */
const LEGACY_RESET = /\|(\d{10,13})\s*$/;

/**
 * What a failure text says about why the harness stopped: `usage-limit`,
 * `network`, or undefined for any other failure. A secondary rate limit is
 * `network`; a usage limit, a primary rate limit, a 429, or a quota is
 * `usage-limit`, also when the text mentions the network too.
 */
export function failureKind(
	text: string,
): "usage-limit" | "network" | undefined {
	if (SECONDARY_RATE_LIMIT.test(text)) return "network";
	if (USAGE_LIMIT_TEXT.test(text)) return "usage-limit";
	if (NETWORK_TEXT.test(text)) return "network";
	return undefined;
}

export function isUsageLimitText(text: string): boolean {
	return failureKind(text) === "usage-limit";
}

export function isNetworkText(text: string): boolean {
	return failureKind(text) === "network";
}

export function parseLegacyResetAt(text: string): number | undefined {
	const match = LEGACY_RESET.exec(text);
	return match?.[1] === undefined ? undefined : toEpochMs(Number(match[1]));
}

/**
 * The adapter's report that the harness program itself failed: its exit
 * code and the tail of its error output. A crash, not the harness's own
 * words, so it is sorted like a throw.
 */
export const PROCESS_EXIT = /^Agent process exited with code \d+/;

/** The error output of a program the system could not find or start. */
const NOT_STARTED = /\bENOENT\b|command not found|No such file or directory/i;

/** The text of an error the chunk stream threw: what the failure checks read, never what a person sees. */
export function thrownText(error: unknown, label: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return `${label} session failed`;
}

/**
 * What a person sees for an error the chunk stream threw. A refusal keeps
 * its words: Night Shift wrote them for people (a secret that is not
 * saved, a harness that cannot use connections). Any other throw is a
 * failure: plain words for its kind, and the error goes to the log.
 */
export function thrownWords(
	error: unknown,
	label: string,
	kind: AgentErrorKind,
): string {
	if (error instanceof Refusal) return error.message;
	console.error(`[agents] the ${label} session failed:`, error);
	if (kind === "usage-limit") return `${label} reached its usage limit.`;
	if (kind === "network") return `${label} lost its connection.`;
	if (error instanceof Error && NOT_STARTED.test(error.message)) {
		return `${label} did not start. Check that it is installed on this computer.`;
	}
	return `${label} stopped with an error. Night Shift saved the details. Try again.`;
}

export function errorEvent(
	kind: AgentErrorKind,
	message: string,
	resetAt?: number,
): AgentEvent {
	return {
		type: "error",
		kind,
		message,
		...(resetAt !== undefined ? { resetAt } : {}),
	};
}
