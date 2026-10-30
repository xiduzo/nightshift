/**
 * A path as the person knows it: relative to the project's folder when it
 * is inside it, so the run's own copy of the project does not show. `root`
 * is that folder. Empty for the folder itself. A path outside it stays.
 */
export function projectPath(path: string, root?: string): string {
	const trimmed = path.trim();
	const base = root?.trim().replace(/\/+$/, "");
	if (base) {
		if (trimmed === base || trimmed === `${base}/`) return "";
		if (trimmed.startsWith(`${base}/`)) return trimmed.slice(base.length + 1);
	}
	return trimmed.replace(/^(\.\/)+/, "");
}
