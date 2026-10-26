import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

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
const DAEMON_PATHS = ["/rpc", "/api", "/sync", "/health"];

/**
 * The UI's answer to a request, or null when the daemon answers it. A
 * page's path gets its prerendered page (`/devices` → `/devices/index.html`),
 * else the app's first page, which routes in the browser. `/` is the UI for
 * a browser only: a probe without `Accept: text/html` gets the daemon's "OK".
 *
 * Each file is read and compressed once (brotli and gzip), then answered
 * from memory in the encoding the browser takes. A file that is not
 * named by its content has an ETag: the browser asks again and gets 304
 * while it is the same.
 */
export function webHandler(
	files: WebFiles,
): (request: Request) => Promise<Response | null> {
	const prepared = new Map<
		string,
		{ version: string; file: Promise<Prepared> }
	>();
	/** The file at `path`, read and compressed once per version of it. */
	function prepare(path: string, file: Blob): Promise<Prepared> {
		const version = `${file.size}:${(file as Partial<File>).lastModified ?? 0}`;
		const known = prepared.get(path);
		if (known?.version === version) return known.file;
		const ready = prepareFile(path, file);
		prepared.set(path, { version, file: ready });
		ready.catch(() => {
			if (prepared.get(path)?.file === ready) prepared.delete(path);
		});
		return ready;
	}
	async function respond(path: string, file: Blob, request: Request) {
		return answer(path, await prepare(path, file), request);
	}
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

/** A file as the daemon answers it: its bytes, compressed copies, and its ETag. */
type Prepared = {
	type: string;
	body: Uint8Array<ArrayBuffer>;
	br: Uint8Array<ArrayBuffer> | null;
	gzip: Uint8Array<ArrayBuffer> | null;
	etag: string;
};

/** The UI's text files, worth compressing. Images and fonts are compressed already. */
const COMPRESSIBLE =
	/\.(?:html|js|mjs|css|svg|json|txt|xml|map|webmanifest|wasm)$/;

/** A file smaller than this goes as it is. */
const COMPRESS_FROM_BYTES = 1024;

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

async function prepareFile(path: string, file: Blob): Promise<Prepared> {
	const html = path.endsWith(".html");
	const body = html
		? new TextEncoder().encode(
				(await file.text()).replace("<head>", `<head>${DAEMON_META}`),
			)
		: new Uint8Array(await file.arrayBuffer());
	const compress =
		COMPRESSIBLE.test(path) && body.byteLength >= COMPRESS_FROM_BYTES;
	const [br, gz] = compress
		? await Promise.all([
				// Quality 9: near the best size, in a fraction of the time of 11.
				brotliAsync(body, {
					params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
				}),
				gzipAsync(body, { level: 9 }),
			])
		: [null, null];
	return {
		type: html
			? "text/html; charset=utf-8"
			: file.type || "application/octet-stream",
		body,
		br: br && new Uint8Array(br),
		gzip: gz && new Uint8Array(gz),
		etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`,
	};
}

function answer(path: string, file: Prepared, request: Request): Response {
	// Vite names the built assets by their content.
	const immutable = path.startsWith("/assets/");
	const headers = new Headers({
		"content-type": file.type,
		"cache-control": immutable
			? "public, max-age=31536000, immutable"
			: "no-cache",
	});
	if (!immutable) headers.set("etag", file.etag);
	if (file.br || file.gzip) headers.set("vary", "Accept-Encoding");
	if (!immutable && request.headers.get("if-none-match") === file.etag) {
		return new Response(null, { status: 304, headers });
	}
	const accepts = request.headers.get("accept-encoding") ?? "";
	const encoded =
		file.br && /\bbr\b/.test(accepts)
			? { encoding: "br", body: file.br }
			: file.gzip && /\bgzip\b/.test(accepts)
				? { encoding: "gzip", body: file.gzip }
				: null;
	if (encoded) headers.set("content-encoding", encoded.encoding);
	const body = encoded?.body ?? file.body;
	return new Response(request.method === "HEAD" ? null : body, { headers });
}
