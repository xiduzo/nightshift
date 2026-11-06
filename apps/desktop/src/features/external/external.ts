import { basename } from "node:path";

/**
 * What leaves the app's window. Electrobun does not open a new window for a
 * link: it reports `new-window-open` and drops the link. It saves a download
 * to the Downloads folder, without a word on screen. So the app opens the
 * link in the person's browser, and tells the page about the download.
 */

/** The links the app hands to the system. A file or app link stays closed. */
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** The url to open for a `new-window-open` detail, or null to open nothing. */
export function externalUrl(detail: unknown): string | null {
	const url = (detail as { url?: unknown } | null)?.url;
	if (typeof url !== "string") return null;
	try {
		return EXTERNAL_PROTOCOLS.has(new URL(url).protocol) ? url : null;
	} catch {
		return null;
	}
}

export type DownloadState = "started" | "completed" | "failed";

/**
 * The script that tells the page about a download. `DesktopDownloads` in
 * `apps/web` listens. Null when the event names no file.
 */
export function downloadScript(
	state: DownloadState,
	detail: unknown,
): string | null {
	const { path, filename } = (detail ?? {}) as {
		path?: unknown;
		filename?: unknown;
	};
	// The path has the name on disk, such as "demo (1).mp4". A failed download
	// has no filename.
	const name =
		(typeof path === "string" && basename(path)) ||
		(typeof filename === "string" && filename);
	if (!name) return null;
	const id = typeof path === "string" && path ? path : name;
	const event = JSON.stringify({ state, id, name });
	return `window.dispatchEvent(new CustomEvent("nightshift:download",{detail:${event}}));`;
}
