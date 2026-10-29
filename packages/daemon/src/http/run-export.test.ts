import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { event, project, run, step } from "@nightshift/db/schema";
import {
	createSandbox,
	openRunBundle,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";

import { bundleFileName, runExportResponse } from "./run-export";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const RUN_ID = "0123abcd-0000-4000-8000-000000000000";

/** A finished run with one step, written straight to the database. */
async function seedRun() {
	const transcriptPath = join(sandbox.root, "s1.ndjson");
	await writeFile(
		transcriptPath,
		`${JSON.stringify({ seq: 1, stepId: "s1", sessionId: null, at: 1, event: { type: "command-output", stream: "stdout", text: "token hunter2-secret" } })}\n`,
	);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "repo" });
	await sandbox.db.insert(run).values({
		id: RUN_ID,
		spaceId: sandbox.spaceId,
		projectId: "p1",
		flowName: "Nightly fix-up",
		flow: "{}",
		title: "Nightly fix-up",
		worktreePath: join(sandbox.root, "wt"),
		branch: "nightshift/x",
		baseRef: "main",
		walkerId: sandbox.deviceId,
	});
	await sandbox.db.insert(step).values({
		id: "s1",
		spaceId: sandbox.spaceId,
		runId: RUN_ID,
		nodeId: "check",
		nodeType: "command",
		visit: 1,
		transcriptPath,
	});
	await sandbox.db.insert(event).values({
		spaceId: sandbox.spaceId,
		runId: RUN_ID,
		type: "RunEnded",
		payload: JSON.stringify({ status: "finished", reason: null }),
		walkerId: sandbox.deviceId,
		walkerSeq: 1,
	});
}

const leftovers = async () =>
	(await readdir(sandbox.root)).filter((n) =>
		n.startsWith("nightshift-export-"),
	);

const deps = () => ({
	db: sandbox.db,
	dataDir: sandbox.dataDir,
	connections: { secretValues: async () => ["hunter2-secret"] },
	tmpDir: sandbox.root,
});

describe("GET /api/runs/:id/export", () => {
	test("streams the run bundle as an attachment and removes the temp file", async () => {
		await seedRun();
		const response = await runExportResponse(deps(), RUN_ID, sandbox.spaceId);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Disposition")).toBe(
			'attachment; filename="nightly-fix-up-0123abcd.nightshift.sqlite"',
		);
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
		await waitFor(async () => (await leftovers()).length === 0, {
			label: "the temp directory to go",
		});

		const path = join(sandbox.root, "downloaded.sqlite");
		await writeFile(path, bytes);
		const opened = await openRunBundle(path);
		expect(opened.run.id).toBe(RUN_ID);
		const [entry] = await opened.transcript();
		expect(entry?.event).toEqual({
			type: "command-output",
			stream: "stdout",
			text: "token •••",
		});
		opened.close();
	});

	test("an unknown run is a 404 and leaves nothing behind", async () => {
		const response = await runExportResponse(deps(), "nope", sandbox.spaceId);
		expect(response.status).toBe(404);
		expect(await leftovers()).toEqual([]);
	});

	test("a run of another Space is a 404", async () => {
		await seedRun();
		const response = await runExportResponse(deps(), RUN_ID, "another-space");
		expect(response.status).toBe(404);
		expect(await leftovers()).toEqual([]);
	});

	test("the file name falls back to the title, then to run", () => {
		expect(
			bundleFileName({
				runId: RUN_ID,
				flowName: null,
				title: "Fix the CI · #12",
			}),
		).toBe("fix-the-ci-12-0123abcd.nightshift.sqlite");
		expect(bundleFileName({ runId: RUN_ID, flowName: null, title: "…" })).toBe(
			"run-0123abcd.nightshift.sqlite",
		);
	});
});
