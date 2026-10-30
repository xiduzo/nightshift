import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Device } from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	testDevice,
} from "@nightshift/engine/testing";
import type { WorkFor, WorkRelay } from "../contract";
import { remoteDevice, serveWork } from "./remote";

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
