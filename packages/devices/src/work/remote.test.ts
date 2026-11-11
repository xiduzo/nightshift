import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRunFolders, type Device } from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	testDevice,
} from "@nightshift/engine/testing";
import { UNREADABLE_REQUEST, type WorkFor, type WorkRelay } from "../contract";
import { CALL_DEADLINES_MS, remoteDevice, serveWork } from "./remote";

/**
 * The snapshots that tell what a step changed, as a Walker asks another
 * Device for them: the call crosses the relay as plain data, and the placed
 * Device answers with its own git. A Device that takes none answers with an
 * error, which the Walker's step runner skips.
 */

const FOR_RUN: WorkFor = {
	spaceId: "space-1",
	projectId: "project-1",
	personId: "person-1",
	runId: "run-1",
};

/** A relay straight to `device`, as the placed Device serves a call. */
function relayTo(device: Device): WorkRelay {
	return {
		call: (_id, request, signal) =>
			serveWork(device, request, signal ?? new AbortController().signal),
		online: () => true,
	};
}

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the snapshots of a remote Device", () => {
	test("tell what changed in its worktree since the first one", async () => {
		const placed = testDevice({ harnesses: {}, snapshots: true });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		const cwd = sandbox.repoPath;

		const start = await device.snapshotWorktree?.({ cwd });
		await writeFile(join(cwd, "made-by-a-command.txt"), "hello\n");
		const changes = await device.worktreeChanges?.({
			cwd,
			from: start?.tree ?? "",
		});

		expect(changes?.files).toEqual([
			{
				path: "made-by-a-command.txt",
				status: "added",
				added: 1,
				removed: 0,
				patch: "@@ -0,0 +1 @@\n+hello",
			},
		]);
		expect(changes?.tree).not.toBe(start?.tree);
	});

	test("fail on a Device that takes none", async () => {
		const placed = testDevice({ harnesses: {} });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);

		await expect(
			device.snapshotWorktree?.({ cwd: sandbox.repoPath }),
		).rejects.toThrow("does not tell what a step changed");
	});
});

describe("a call to a remote Device that never answers", () => {
	test("ends with a refusal after its deadline, and the call is cancelled there", async () => {
		const before = CALL_DEADLINES_MS.capabilities;
		CALL_DEADLINES_MS.capabilities = 30;
		let cancelled = false;
		// The call went to a stream nobody reads: no reply ever comes.
		const lost: WorkRelay = {
			async *call(_id, _request, signal) {
				await new Promise<void>((resolve) =>
					signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
				cancelled = signal?.aborted === true;
			},
			online: () => true,
		};
		try {
			const device = remoteDevice(
				lost,
				{ id: "laptop", name: "laptop" },
				FOR_RUN,
			);
			await expect(device.capabilities()).rejects.toThrow(
				"laptop did not answer in time. Check that it is online, then try again.",
			);
			expect(cancelled).toBe(true);
		} finally {
			CALL_DEADLINES_MS.capabilities = before;
		}
	});
});

describe("the run folder of a remote Device", () => {
	test("is made there once, with no branch and no base", async () => {
		const folders = createRunFolders(sandbox.dataDir);
		const placed = testDevice({ harnesses: {}, runFolders: folders });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		const run = { id: "run-1", projectId: "project-1" };
		expect(await device.runFolder?.(run)).toEqual({
			worktreePath: folders.path("run-1"),
			branch: "",
			baseRef: "",
			made: true,
		});
		expect(existsSync(folders.path("run-1"))).toBe(true);
		expect((await device.runFolder?.(run))?.made).toBe(false);
	});

	test("on a Device that makes none, or of an older Night Shift, says to update it", async () => {
		const run = { id: "run-1", projectId: "project-1" };
		// The placed Device names itself: the test's is "test".
		const none = remoteDevice(
			relayTo(testDevice({ harnesses: {} })),
			{ id: "test", name: "test" },
			FOR_RUN,
		);
		const older = remoteDevice(
			{
				async *call() {
					// What an older Device answers to a call it cannot read.
					yield { kind: "error", message: UNREADABLE_REQUEST };
				},
				online: () => true,
			},
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		for (const device of [none, older]) {
			await expect(device.runFolder?.(run)).rejects.toThrow(
				`Update Night Shift on ${device.name} to run projects without a folder.`,
			);
		}
	});
});
