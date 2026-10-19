import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

/**
 * The web UI, served by the daemon itself: the `nightshift` binary carries
 * it, so a headless Host needs nothing else to show Night Shift in a
 * browser. The UI's own routes and files only: the procedures, the API, the
 * relay and the health check stay the daemon's.
 */

/** The built UI (`apps/web/dist/client`): a file by its URL path. */
export type WebFiles = {
	file(path: string): Blob | null;
};

/** The files the binary embeds (`setEmbedded`). */
export function embeddedWeb(files: Record<string, string>): WebFiles {
	return {
		file: (path) => (files[path] ? Bun.file(files[path]) : null),
	};
}

/** A built UI in a folder (NIGHTSHIFT_WEB_DIR). */
export function directoryWeb(dir: string): WebFiles {
	const root = resolve(dir);
	return {
		file(path) {
			const full = resolve(join(root, path));
			if (full !== root && !full.startsWith(root + sep)) return null;
			return existsSync(full) && statSync(full).isFile()
				? Bun.file(full)
				: null;
		},
	};
}

/**
 * Marks a page the daemon served: the UI then calls the daemon at the
 * page's own address, whatever address it was built for.
 */
export const DAEMON_META =
	'<meta name="nightshift-daemon" content="same-origin"/>';

/** Paths the daemon answers itself, never the UI. */
const DAEMON_PATHS = ["/rpc", "/api", "/sync"];

/**
 * The UI's answer to a request, or null when the daemon answers it. A
 * page's path gets its prerendered page (`/devices` → `/devices/index.html`),
 * else the app's first page, which routes in the browser. `/` is the UI for
 * a browser only: a probe without `Accept: text/html` gets the daemon's "OK".
 */
export function webHandler(
	files: WebFiles,
): (request: Request) => Promise<Response | null> {
	return async (request) => {
		if (request.method !== "GET" && request.method !== "HEAD") return null;
		let path: string;
		try {
			path = decodeURIComponent(new URL(request.url).pathname);
		} catch {
			return null;
		}
		if (path.includes("\0") || path.split("/").includes("..")) return null;
		if (DAEMON_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
			return null;
		}
		const page = (request.headers.get("accept") ?? "").includes("text/html");
		if (path === "/" && !page) return null;

		const candidates = path.endsWith("/")
			? [`${path}index.html`]
			: [path, `${path}/index.html`];
		for (const candidate of candidates) {
			const file = files.file(candidate);
			if (file) return respond(candidate, file, request);
		}
		// A route of the app that was not prerendered (a run, a project).
		if (page && extname(path) === "") {
			const index = files.file("/index.html");
			if (index) return respond("/index.html", index, request);
		}
		return null;
	};
}

async function respond(
	path: string,
	file: Blob,
	request: Request,
): Promise<Response> {
	const html = path.endsWith(".html");
	const headers = new Headers({
		"content-type": html
			? "text/html; charset=utf-8"
			: file.type || "application/octet-stream",
		// Vite names the built assets by their content.
		"cache-control": path.startsWith("/assets/")
			? "public, max-age=31536000, immutable"
			: "no-cache",
	});
	if (!html) {
		return new Response(request.method === "HEAD" ? null : file, { headers });
	}
	const text = (await file.text()).replace("<head>", `<head>${DAEMON_META}`);
	return new Response(request.method === "HEAD" ? null : text, { headers });
}
