import type { Digest, NotificationSettings } from "./types";

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

type DigestWhen = NotificationSettings["digest"]["when"];

/**
 * When the morning digest goes out, as the web and the phone offer it,
 * with the same words.
 */
export const DIGEST_CHOICES: readonly { value: DigestWhen; label: string }[] = [
	{ value: "quiet-hours-end", label: "When quiet hours end" },
	{ value: "time", label: "At a set time" },
	{ value: "off", label: "Off" },
];

/**
 * Whether the digest goes out at its own time: you chose a time, or it
 * follows quiet hours and you have none. Then the time shows to change.
 */
export function digestAtTime(
	settings: Pick<NotificationSettings, "digest" | "quietHours">,
): boolean {
	const { when } = settings.digest;
	return (
		when === "time" || (when === "quiet-hours-end" && !settings.quietHours)
	);
}
