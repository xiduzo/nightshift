import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { Runner } from "../graph/runner/runner";
import { RELEASED } from "../graph/runner/turn";
import { command, flowOf, startRun, testRunner } from "./graph";
import { sandboxPerTest } from "./sandbox-per-test";

describe("a sandbox per test", () => {
	const sandbox = sandboxPerTest();
	const roots: string[] = [];
	let earlier: { runner: Runner; runId: string } | undefined;

	test("a test starts a runner and does not release it", async () => {
		roots.push(sandbox.root);
		const h = await startRun(sandbox, flowOf([command("check", "true")]));
		earlier = { runner: testRunner(h), runId: h.runId };
		expect(existsSync(sandbox.root)).toBe(true);
	});

	test("the next test has its own sandbox, and the runner let go", async () => {
		expect(roots).not.toContain(sandbox.root);
		expect(existsSync(roots[0] as string)).toBe(false);
		await expect(
			earlier?.runner.take(earlier.runId, { kind: "stop", by: "person" }),
		).rejects.toThrow(RELEASED);
	});

	afterAll(() => {
		// No test runs: the value stands for no sandbox.
		expect(() => sandbox.root).toThrow("No test runs");
	});
});
