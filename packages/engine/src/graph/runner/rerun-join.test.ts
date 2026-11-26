import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import type { JoinNode } from "@nightshift/flows";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps } from "../../read";
import { RunRefusal } from "../../run-status";
import {
	command,
	edge,
	flowOf,
	type Harness,
	startRun,
	testRunner,
} from "../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../testing/test-support";
import { joinUnreachable } from "./reentry";

/**
 * A run again while a Join's round is open (`planReentry`): a branch
 * failed, the run ended failed, and the Join waits for that branch. A run
 * again that cannot bring the Join every branch is refused before
 * anything is written. A run again that can still goes on.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const joinNode = (id: string, wait: JoinNode["wait"] = "all"): JoinNode => ({
	id,
	type: "join",
	position: { x: 0, y: 0 },
	wait,
});

/** start → [good, bad] → joined → after. `bad` passes once the flag file is there. */
function failingBranch(flag: string) {
	return flowOf(
		[
			command("start", "true"),
			command("good", "true"),
			command("bad", `test -f ${flag}`),
			joinNode("joined"),
			command("after", "true"),
		],
		[
			edge("s-good", "start", "pass", "good"),
			edge("s-bad", "start", "pass", "bad"),
			edge("good-j", "good", "pass", "joined"),
			edge("bad-j", "bad", "pass", "joined"),
			edge("j-after", "joined", "done", "after"),
		],
	);
}

/**
 * start → [a1 → a2 → a3, bad] → joined → after. `bad` fails at once, while
 * a1 still runs: the run fails with a2 ended and a3 still to come.
 */
function longBranch(flag: string) {
	return flowOf(
		[
			command("start", "true"),
			command("a1", "sleep 1"),
			command("a2", "true"),
			command("a3", "true"),
			command("bad", `test -f ${flag}`),
			joinNode("joined"),
			command("after", "true"),
		],
		[
			edge("s-a1", "start", "pass", "a1"),
			edge("s-bad", "start", "pass", "bad"),
			edge("a1-a2", "a1", "pass", "a2"),
			edge("a2-a3", "a2", "pass", "a3"),
			edge("a3-j", "a3", "pass", "joined"),
			edge("bad-j", "bad", "pass", "joined"),
			edge("j-after", "joined", "done", "after"),
		],
	);
}

/** Waits until no drive holds the run and its status is `status`. */
async function settle(
	runner: ReturnType<typeof testRunner>,
	h: Harness,
	status: string,
): Promise<void> {
	await waitFor(
		async () =>
			!runner.isActive(h.runId) && foldRun(await h.events()).status === status,
		{ label: `the run to be ${status}`, timeoutMs: 20_000 },
	);
}

/** Starts the flow with a failing branch and waits until the run failed. */
async function failedRun(shape = failingBranch) {
	const flag = joinPath(sandbox.repoPath, "fixed");
	const h = await startRun(sandbox, shape(flag));
	const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	await settle(runner, h, "failed");
	return { h, runner, fix: () => writeFileSync(flag, "") };
}

const passed = async (h: Harness) =>
	deriveSteps(foldRun(await h.events()))
		.filter((s) => s.outcome === "pass" || s.outcome === "done")
		.map((s) => s.nodeId);

describe("a run again while a branch failed and its Join waits", () => {
	for (const [shape, nodeId] of [
		[failingBranch, "good"],
		[failingBranch, "joined"],
		[longBranch, "a3"],
	] as const) {
		test(`from "${nodeId}": refused with words, the log stays as it was, and a resume finishes the run`, async () => {
			const { h, runner, fix } = await failedRun(shape);
			try {
				fix();
				const before = await h.events();
				const refused = await runner
					.take(h.runId, { kind: "rerun", by: "person", nodeId })
					.then(
						() => null,
						(error: unknown) => error,
					);
				expect(refused).toBeInstanceOf(RunRefusal);
				expect((refused as RunRefusal).rule).toBe("join-unreachable");
				expect((refused as RunRefusal).message).toBe(joinUnreachable("joined"));
				await settle(runner, h, "failed");
				expect(await h.events()).toEqual(before);
				// The words offer a resume: it works.
				await runner.take(h.runId, { kind: "resume", by: "person" });
				await settle(runner, h, "finished");
			} finally {
				await runner.release();
			}
		});
	}

	test("from the branch that failed: the Join goes on and the run finishes", async () => {
		const { h, runner, fix } = await failedRun();
		try {
			fix();
			await runner.take(h.runId, {
				kind: "rerun",
				by: "person",
				nodeId: "bad",
			});
			await settle(runner, h, "finished");
			expect(await passed(h)).toEqual(
				expect.arrayContaining(["bad", "joined", "after"]),
			);
		} finally {
			await runner.release();
		}
	});

	test("from the branch that failed while another branch is on its way: the run finishes", async () => {
		const { h, runner, fix } = await failedRun(longBranch);
		try {
			fix();
			await runner.take(h.runId, {
				kind: "rerun",
				by: "person",
				nodeId: "bad",
			});
			await settle(runner, h, "finished");
			expect(await passed(h)).toEqual(
				expect.arrayContaining(["a3", "bad", "joined", "after"]),
			);
		} finally {
			await runner.release();
		}
	});

	test("from a step before the branches: both run again and the run finishes", async () => {
		const { h, runner, fix } = await failedRun();
		try {
			fix();
			await runner.take(h.runId, {
				kind: "rerun",
				by: "person",
				nodeId: "start",
			});
			await settle(runner, h, "finished");
			const steps = await passed(h);
			expect(steps.filter((id) => id === "good")).toHaveLength(2);
			expect(steps).toEqual(expect.arrayContaining(["joined", "after"]));
		} finally {
			await runner.release();
		}
	});

	test("a resume runs the branch that failed, and the run finishes", async () => {
		const { h, runner, fix } = await failedRun();
		try {
			fix();
			await runner.take(h.runId, { kind: "resume", by: "person" });
			await settle(runner, h, "finished");
			expect(await passed(h)).toEqual(
				expect.arrayContaining(["bad", "joined", "after"]),
			);
		} finally {
			await runner.release();
		}
	});
});

describe("a run again after a stop while the branches ran", () => {
	test("from one branch: refused, because the other branch was cut short", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("start", "true"),
					command("s1", "sleep 5"),
					command("s2", "sleep 5"),
					joinNode("joined"),
					command("after", "true"),
				],
				[
					edge("s-s1", "start", "pass", "s1"),
					edge("s-s2", "start", "pass", "s2"),
					edge("s1-j", "s1", "pass", "joined"),
					edge("s2-j", "s2", "pass", "joined"),
					edge("j-after", "joined", "done", "after"),
				],
			),
		);
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			await waitFor(
				async () =>
					deriveSteps(foldRun(await h.events())).filter(
						(s) => s.nodeId === "s1" || s.nodeId === "s2",
					).length === 2,
				{ label: "both branches to run", timeoutMs: 20_000 },
			);
			await runner.take(h.runId, { kind: "stop", by: "person" });
			await settle(runner, h, "stopped");
			const before = await h.events();
			const refused = await runner
				.take(h.runId, { kind: "rerun", by: "person", nodeId: "s1" })
				.then(
					() => null,
					(error: unknown) => error,
				);
			expect(refused).toBeInstanceOf(RunRefusal);
			expect((refused as RunRefusal).rule).toBe("join-unreachable");
			expect(await h.events()).toEqual(before);
		} finally {
			await runner.release();
		}
	});
});

describe("a run again in a flow without a Join", () => {
	test("goes on from its node, and the run finishes", async () => {
		const flag = joinPath(sandbox.repoPath, "fixed");
		const h = await startRun(
			sandbox,
			flowOf(
				[command("first", "true"), command("second", `test -f ${flag}`)],
				[edge("f-s", "first", "pass", "second")],
			),
		);
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			await settle(runner, h, "failed");
			writeFileSync(flag, "");
			await runner.take(h.runId, {
				kind: "rerun",
				by: "person",
				nodeId: "first",
			});
			await settle(runner, h, "finished");
			expect((await passed(h)).filter((id) => id === "first")).toHaveLength(2);
		} finally {
			await runner.release();
		}
	});
});
