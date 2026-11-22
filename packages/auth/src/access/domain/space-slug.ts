/**
 * The slug of a new Space: its name in lower case letters, digits and
 * dashes, then a dash and `suffix` (a random part the wire draws), so two
 * Spaces of one name differ.
 */
export function spaceSlug(name: string, suffix: string): string {
	const base =
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "space";
	return `${base}-${suffix}`;
}
