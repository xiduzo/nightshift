/**
 * What the Markdown of a Gate shows, without React Native: where a link
 * opens, the color of each line of a diff, and a list item's marker.
 */

/**
 * Where a link in the text opens: a web page in the in-app browser, a
 * `mailto:` or another app's link through the system, and a link without
 * a scheme ("docs/plan.md") nowhere, as there is no page to open.
 */
export function linkTarget(href: string): "browser" | "system" | null {
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())?.[1];
	if (!scheme) return null;
	const lower = scheme.toLowerCase();
	if (lower === "http" || lower === "https") return "browser";
	// A script in a link never runs.
	if (lower === "javascript" || lower === "data" || lower === "file") {
		return null;
	}
	return "system";
}

/** The tone of one line of a diff: added, removed, or as it was. */
export function diffLineTone(line: string): "added" | "removed" | null {
	if (line.startsWith("+++") || line.startsWith("---")) return null;
	if (line.startsWith("+")) return "added";
	if (line.startsWith("-")) return "removed";
	return null;
}

/** The marker of a list item: "3." in an ordered list, "•" in another. */
export function listMarker(
	ordered: boolean,
	start: number | undefined,
	index: number,
): string {
	return ordered ? `${(start ?? 1) + index}.` : "•";
}
