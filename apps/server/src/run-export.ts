import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Database } from "@nightshift/db";
import {
	type ConnectionStore,
	exportRun,
	type RunBundleSummary,
} from "@nightshift/engine";

/**
 * `GET /api/runs/:id/export`: the run of the Space `spaceId` as one SQLite
 * file, a run bundle (a run of another Space is not found). The
 * file goes to a new temp directory, streams out, and the directory is
 * removed when the stream closes, also when the client goes away. The
 * values of saved secrets and connection variables are taken out.
 */
export async function runExportResponse(
	deps: {
		db: Database;
		connections: Pick<ConnectionStore, "secretValues">;
		/** Where the temp directory goes. The OS temp directory by default. */
		tmpDir?: string;
	},
	runId: string,
	spaceId: string,
): Promise<Response> {
	const dir = await mkdtemp(
		join(deps.tmpDir ?? tmpdir(), "nightshift-export-"),
	);
	const remove = () => rm(dir, { recursive: true, force: true });
	try {
		const summary = await exportRun({
			db: deps.db,
			runId,
			spaceId,
			path: join(dir, "run.nightshift.sqlite"),
			redact: await deps.connections.secretValues(),
		});
		if (!summary) {
			await remove();
			return Response.json(
				{ message: `Run not found: ${runId}` },
				{ status: 404 },
			);
		}
		const { size } = await stat(summary.path);
		const file = createReadStream(summary.path);
		file.once("close", () => void remove());
		return new Response(Readable.toWeb(file) as unknown as ReadableStream, {
			headers: {
				"Content-Type": "application/vnd.sqlite3",
				"Content-Length": String(size),
				"Content-Disposition": `attachment; filename="${bundleFileName(summary)}"`,
			},
		});
	} catch (error) {
		await remove();
		throw error;
	}
}

/** `<flow-or-title-slug>-<short id>.nightshift.sqlite` */
export function bundleFileName(
	run: Pick<RunBundleSummary, "runId" | "title" | "flowName">,
): string {
	const slug =
		(run.flowName ?? run.title)
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.slice(0, 48)
			.replace(/^-+|-+$/g, "") || "run";
	return `${slug}-${run.runId.slice(0, 8)}.nightshift.sqlite`;
}
