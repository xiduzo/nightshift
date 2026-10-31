/**
 * The web address of a project's remote, such as `github.com/acme/app`,
 * to open in the browser. Null for a project without a remote.
 */
export function remoteUrl(remote: string | null): string | null {
	const trimmed = remote?.trim().replace(/\/+$/, "");
	if (!trimmed) return null;
	return `https://${trimmed.replace(/^[a-z]+:\/\//i, "")}`;
}
