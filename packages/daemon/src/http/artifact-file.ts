import type { SpaceEngine } from "@nightshift/engine";
import { servedFile } from "./served-file";

/** The answer for an artifact that is not there, or of a run the Person may not see. */
export function artifactNotFound(): Response {
	return Response.json({ message: "Artifact not found." }, { status: 404 });
}

/**
 * `GET /api/runs/:id/artifacts/:artifactId`: one file a run's agent kept,
 * for a Member of the run's Space (a run of another Space is not found).
 * Served as `servedFile` says.
 */
export async function artifactFileResponse(
	space: Pick<SpaceEngine, "artifactFile">,
	request: Request,
	runId: string,
	artifactId: string,
): Promise<Response> {
	let found: Awaited<ReturnType<SpaceEngine["artifactFile"]>>;
	try {
		found = await space.artifactFile(runId, artifactId);
	} catch {
		found = null;
	}
	const file = found ? Bun.file(found.path) : null;
	if (!found || !file || !(await file.exists())) {
		return artifactNotFound();
	}
	const { artifact } = found;
	return servedFile(request, file, {
		name: artifact.name,
		mediaType: artifact.mediaType,
		cache: "private, max-age=31536000, immutable",
	});
}
