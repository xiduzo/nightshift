import type { Digest } from "./types";

/** A digest older than this no longer shows: the next one comes soon. */
const SHOWN_FOR_MS = 24 * 60 * 60_000;

/**
 * Whether the inbox still shows the last morning digest, on the web and on
 * the phone: it went out in the last day.
 */
export function digestShown(
	digest: Pick<Digest, "to"> | null | undefined,
	now: number,
): digest is Digest {
	return digest != null && now - digest.to <= SHOWN_FOR_MS;
}
