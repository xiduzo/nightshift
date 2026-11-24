import type { SpaceEngine } from "@nightshift/engine";
import { servedFile } from "./served-file";

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
 * run's Space (a run of another Space is not found). Served as `servedFile`
 * says. The engine refuses a path that leaves the folder and a link on the
 * way.
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
	return servedFile(request, file, {
		name: found.file.path.split("/").at(-1) ?? found.file.path,
		mediaType: file.type,
		// The run's steps may write the file again: ask each time.
		cache: "private, no-cache",
	});
}
