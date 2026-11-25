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

/** The header of every call of a Device with a key: the id of the Host it means. */
export const HOST_HEADER = "x-nightshift-host";

/** The Host a call means, as it says. Null: it says none. */
export function askedHostOf(headers: Headers): string | null {
	return headers.get(HOST_HEADER);
}

function numberOf(value: string | null): number | null {
	return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/**
 * Beside a HOST_UNREACHABLE: the Host `hostId` has another version, and
 * `device` is how the Device's version compares with the Host's.
 */
export const versionRefusalSchema = z.object({
	device: z.enum(["older", "newer"]),
	hostId: z.string(),
});

/**
 * Who refused the version, and how the version of that Host compares with
 * this Device's, from a refusal's data. Null: not a refusal of the version.
 */
export function hostVersionOf(
	data: unknown,
): { hostId: string; host: OtherVersion } | null {
	const refusal = versionRefusalSchema.safeParse(data);
	if (!refusal.success) return null;
	const { device, hostId } = refusal.data;
	return { hostId, host: device === "older" ? "newer" : "older" };
}

/** What a Device reads of a hello before it knows that the version is the same. */
const saidSchema = z.object({
	host: z.object({ id: z.string() }),
	version: z.unknown().optional(),
});

/**
 * The Host that gave an answer to a hello, and how its version compares
 * with this Device's (null: the same). The answer of another version may
 * have another shape: only these two are read. Null: not a Host's answer.
 */
export function helloSaidBy(
	answer: unknown,
): { hostId: string; host: OtherVersion | null } | null {
	const said = saidSchema.safeParse(answer);
	if (!said.success) return null;
	return { hostId: said.data.host.id, host: otherVersion(said.data.version) };
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
