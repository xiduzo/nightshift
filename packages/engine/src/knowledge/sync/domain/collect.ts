/**
 * The collection of knowledge content that no document lists any more
 * (ADR 4, "Consequences"): a sync replaces its folder, and each change
 * of a file leaves its earlier content in the archive.
 *
 * It runs on the Replica that keeps a Space: its archive is the one the
 * Devices copy to. A Device's own cache is left alone. Content goes only
 * when no knowledge document of any Project of its Space lists it, and
 * when it was last kept longer ago than the grace period: a Device copies
 * content to the Host before its entry reaches the Host's document, and a
 * Device that goes offline in between may bring the entry days later.
 */

/** How long unlisted content stays after it was last kept. */
export const CONTENT_GRACE_MS = 7 * 24 * 60 * 60_000;

/** What one collection did. */
export type CollectResult = {
	/** Content files it removed. */
	removed: number;
	/** Unlisted content it kept for now: within the grace period. */
	waiting: number;
};
