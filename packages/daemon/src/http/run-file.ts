import type { SpaceEngine } from "@nightshift/engine";
import { parseRange } from "./artifact-file";

/** The answer for a file that is not there, or of a run the Person may not see. */
export function runFileNotFound(): Response {
	return Response.json({ message: "File not found." }, { status: 404 });
}

/**
 * The path of a file in the run's folder from a URL of
 * `/api/runs/:id/files/<path>`: each part after `files` decoded. Null
 * when a part cannot be decoded.
 */
function runFilePath(url: string): string | null {
	const parts = new URL(url).pathname.split("/").slice(5);
	try {
		return parts.map(decodeURIComponent).join("/");
	} catch {
		return null;
	}
}

/**
 * `GET /api/runs/:id/files/<path>`: one file in the folder of a run of a
 * project without a folder (ADR 22), on this computer, for a Member of the
 * run's Space (a run of another Space is not found). As an artifact: served
 * inline, with `?download` as an attachment, and a `Range` request gets
 * that part only.
 *
 * The file is whatever the run's steps wrote, so it never runs as a page
 * of this origin: a sandbox without scripts, and no content sniffing. The
 * engine refuses a path that leaves the folder and a link on the way.
 */
export async function runFileResponse(
	space: Pick<SpaceEngine, "runFile">,
	request: Request,
	runId: string,
): Promise<Response> {
	const path = runFilePath(request.url);
	let found: Awaited<ReturnType<SpaceEngine["runFile"]>> = null;
	try {
		found = path === null ? null : await space.runFile(runId, path);
	} catch {
		found = null;
	}
	const file = found ? Bun.file(found.path) : null;
	if (!found || !file || !(await file.exists())) return runFileNotFound();
	const name = found.file.path.split("/").at(-1) ?? found.file.path;
	const download = new URL(request.url).searchParams.has("download");
	const headers = new Headers({
		"Content-Type": file.type || "application/octet-stream",
		"Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
		"Content-Security-Policy": "sandbox",
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		// The run's steps may write the file again: ask each time.
		"Cache-Control": "private, no-cache",
	});
	const size = file.size;
	const range = parseRange(request.headers.get("range"), size);
	if (range === "invalid") {
		headers.set("Content-Range", `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
		headers.set("Content-Length", String(range.end - range.start + 1));
		return new Response(file.slice(range.start, range.end + 1), {
			status: 206,
			headers,
		});
	}
	headers.set("Content-Length", String(size));
	return new Response(file, { headers });
}
