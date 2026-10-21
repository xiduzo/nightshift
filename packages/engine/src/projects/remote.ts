/**
 * One string for every URL of one repository: `host/path`, without the
 * scheme, the user or password, the port, and `.git`. So
 * `git@github.com:acme/app.git`, `ssh://git@github.com/acme/app` and
 * `https://github.com/acme/app.git` are all `github.com/acme/app`. The
 * host is lower case; the path keeps its case. Null for a path or a
 * `file:` URL: a repository on this computer is no other Device's.
 */
export function normaliseRemote(url: string): string | null {
	const trimmed = url.trim();
	if (trimmed === "" || /^[a-z]:[\\/]/i.test(trimmed)) return null;
	let host: string;
	let path: string;
	const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed);
	if (withScheme) {
		const [, scheme = "", rest = ""] = withScheme;
		if (scheme.toLowerCase() === "file") return null;
		const slash = rest.indexOf("/");
		const authority = slash === -1 ? rest : rest.slice(0, slash);
		path = slash === -1 ? "" : rest.slice(slash + 1);
		host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
	} else {
		// scp-like: `[user@]host:path`. Anything else is a path.
		const scp = /^(?:[^@/]+@)?([^:/]+):(.*)$/.exec(trimmed);
		if (!scp) return null;
		host = scp[1] ?? "";
		path = scp[2] ?? "";
	}
	path = path
		.replace(/^\/+|\/+$/g, "")
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "");
	if (host === "" || path === "") return null;
	return `${host.toLowerCase()}/${path}`;
}
