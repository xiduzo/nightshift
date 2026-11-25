import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { Runner } from "../graph/runner/runner";
import { RELEASED } from "../graph/runner/turn";
import { command, flowOf, startRun, testRunner } from "./graph";
import { sandboxPerTest } from "./sandbox-per-test";

describe("a sandbox per test", () => {
	const sandbox = sandboxPerTest();
	/** What each test that ran left: each test passes alone, in any order. */
	const left: { root: string; runner: Runner; runId: string }[] = [];

	for (const which of ["a", "another"])
		test(`${which} test starts a runner in a sandbox of its own, and does not release it`, async () => {
			for (const { root } of left) expect(sandbox.root).not.toBe(root);
			const h = await startRun(sandbox, flowOf([command("check", "true")]));
			left.push({
				root: sandbox.root,
				runner: testRunner(h),
				runId: h.runId,
			});
			expect(existsSync(sandbox.root)).toBe(true);
		});

	afterAll(async () => {
		expect(left).not.toBeEmpty();
		for (const { root, runner, runId } of left) {
			expect(existsSync(root)).toBe(false);
			await expect(
				runner.take(runId, { kind: "stop", by: "person" }),
			).rejects.toThrow(RELEASED);
		}
		// No test runs: the value stands for no sandbox.
		expect(() => sandbox.root).toThrow("No test runs");
	});
});
