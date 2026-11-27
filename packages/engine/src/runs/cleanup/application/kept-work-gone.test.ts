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
});
