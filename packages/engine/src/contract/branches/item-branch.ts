/** A git-safe slug: lowercase letters, digits and single dashes. */
export function slugify(text: string, maxChars = 48): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.slice(0, maxChars).replace(/-+$/, "");
}

/**
 * `nightshift/<run8>-<id>-<title>`: the branch of one Call item. Not
 * `nightshift/<run8>/…`: git cannot hold a branch inside the name of
 * another, and `nightshift/<run8>` is the run's own branch.
 */
export function itemBranchName(
	shortId: string,
	item: { id: string; title: string },
): string {
	const slug = slugify(`${item.id} ${item.title}`) || "item";
	return `nightshift/${shortId}-${slug}`;
}
