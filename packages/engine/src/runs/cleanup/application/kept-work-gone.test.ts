import { describe, expect, test } from "bun:test";
import { KEPT_WORK_GONE } from "../domain/kept-work";
import { cleanupPorts } from "../test-support";
import { keptWorkGone } from "./kept-work-gone";

const removal = {
	projectId: "project-1",
	worktreePath: null,
	branches: [],
	by: "cleanup" as const,
};

describe("keptWorkGone", () => {
	test("has words for a run whose kept work the cleanup freed, and none for one whose work it keeps", async () => {
		const ports = await cleanupPorts();
		const gone = keptWorkGone(ports);
		await ports.removalLog.removed({
			...removal,
			runId: "freed-run",
			kept: ["refs/nightshift/kept/freed-ru/copy"],
		});
		await ports.removalLog.removed({
			...removal,
			runId: "kept-run",
			kept: ["refs/nightshift/kept/kept-run/copy"],
		});
		await ports.removalLog.removed({
			...removal,
			runId: "freed-run",
			expired: ["refs/nightshift/kept/freed-ru/copy"],
		});
		expect(await gone({ id: "freed-run", projectId: "project-1" })).toBe(
			KEPT_WORK_GONE,
		);
		expect(await gone({ id: "kept-run", projectId: "project-1" })).toBeNull();
		expect(await gone({ id: "other-run", projectId: "project-1" })).toBeNull();
		expect(await gone({ id: "freed-run", projectId: "project-2" })).toBeNull();
	});

	test("has none once a copy made again from elsewhere was removed after the work went", async () => {
		const ports = await cleanupPorts();
		const run = { id: "back-run", projectId: "project-1" };
		await ports.removalLog.removed({
			...removal,
			runId: run.id,
			kept: ["refs/nightshift/kept/back-run/copy"],
		});
		await ports.removalLog.removed({
			...removal,
			runId: run.id,
			expired: ["refs/nightshift/kept/back-run/copy"],
		});
		expect(await keptWorkGone(ports)(run)).toBe(KEPT_WORK_GONE);
		// A rerun made the copy from origin, and its work was merged: nothing to keep.
		await ports.removalLog.removed({
			...removal,
			runId: run.id,
			worktreePath: "/work/app.nightshift/back-run",
		});
		expect(await keptWorkGone(ports)(run)).toBeNull();
	});
});
