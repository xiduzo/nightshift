import {
	type OtherVersion,
	otherVersion,
	PROTOCOL_VERSION,
} from "@nightshift/refusal";
import { z } from "zod";

/**
 * How a Device and its Host say their version (ADR 45), and how a Host
 * refuses another one.
 *
 * - A Device says it with every call, in a header. A Host reads it once the
 *   key is good.
 * - A Host says it in `link.hello` and `link.heartbeat`.
 * - A Host refuses another version with HOST_UNREACHABLE. Every Device
 *   reads that code as a Host it cannot reach now: it keeps its key, its
 *   rows and its runs wait, and it tries again.
 */

/** The header of every call of a Device: its version. */
export const VERSION_HEADER = "x-nightshift-version";

/** The version a call says. Null: it says none. */
export function deviceVersionOf(headers: Headers): number | null {
	return numberOf(headers.get(VERSION_HEADER));
}

function numberOf(value: string | null): number | null {
	return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/**
 * Beside a HOST_UNREACHABLE: the Host has another version, and `device` is
 * how the Device's version compares with the Host's.
 */
export const versionRefusalSchema = z.object({
	device: z.enum(["older", "newer"]),
});

/** How the version of the Host compares with this Device's, from a refusal's data. Null: not a refusal of the version. */
export function hostVersionOf(data: unknown): OtherVersion | null {
	const refusal = versionRefusalSchema.safeParse(data);
	if (!refusal.success) return null;
	return refusal.data.device === "older" ? "newer" : "older";
}

/** The token of the document channel: the Device key, and this Device's version after it. */
export function documentToken(key: string): string {
	return `${key}@${PROTOCOL_VERSION}`;
}

/** The Device key of a document channel's token. Null: a Device of another version. */
export function keyOfDocumentToken(token: string): string | null {
	const at = token.lastIndexOf("@");
	const version = numberOf(at < 0 ? null : token.slice(at + 1));
	return otherVersion(version) === null ? token.slice(0, at) : null;
}
