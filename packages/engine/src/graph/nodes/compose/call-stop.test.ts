import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentSessionInput } from "@nightshift/agents/types";
import type { FlowInput } from "@nightshift/flows/testing";
import { now } from "@nightshift/time";
import { foldRun } from "../../../log";
import { getRunRow } from "../../../log/run-row/run-row";
import { deriveSteps } from "../../../read";
import { OUTRUN_ERROR } from "../../../read/waiting-session";
import {
	agent,
	command,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
	testRunner,
} from "../../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../../testing/test-support";
import { budgetError } from "../../step";

/**
 * A Call stops the steps of its called flow when the Call step itself
 * stops: another branch won a `first` Join, or the Call ran past its own
 * time budget. The run ends as the rest of the flow says, never as a
 * person's stop. A person's stop of the run still ends it `stopped_by_person`.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const at = { x: 0, y: 0 };

/** The file the losing branch writes once its work has started: the winner waits for it. */
const started = () => joinPath(sandbox.dataDir, "loser-started");

/** An Agent that works for 30 s unless its step stops it. It writes `started()` when it is called. */
const slowHarness = () =>
	fakeHarness((input: AgentSessionInput) => {
		if (!/Do slow\./.test(input.prompt)) return reportingScript("pass", "ok");
		writeFileSync(started(), "");
		return { steps: [{ type: "wait", ms: 30_000 }] };
	});

/** The called flow: one Agent that works long. */
const longWork = flowOf([agent("slow", "Do slow.")], [], {
	inputs: [{ name: "item", type: "json" }],
});

/**
 * start → [fast (Command), the losing branch] → joined (first) → after.
 * `fast` reaches the Join only after the losing branch's work started.
 */
const raceBeside = (loser: FlowInput["nodes"][number]) =>
	flowOf(
		[
			command("start", "true"),
			command("fast", `until [ -f '${started()}' ]; do sleep 0.02; done`),
			loser,
			{ id: "joined", type: "join", position: at, wait: "first" },
			command("after", "true"),
		],
		[
			edge("s-fast", "start", "pass", "fast"),
			edge("s-loser", "start", "pass", loser.id),
			edge("fast-j", "fast", "pass", "joined"),
			edge("loser-j", loser.id, "done", "joined"),
			edge("loser-jp", loser.id, "pass", "joined"),
			edge("j-after", "joined", "done", "after"),
		],
	);

/** Starts the run on a runner and waits until it ends with `status`, in at most 10 s. */
async function walk(
	h: Harness,
	status: string,
	during?: (runner: ReturnType<typeof testRunner>) => Promise<void>,
) {
	const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
	const began = now();
	try {
		await runner.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		await during?.(runner);
		await waitFor(
			async () =>
				!runner.isActive(h.runId) &&
				foldRun(await h.events()).status === status,
			{ label: `the run to be ${status}`, timeoutMs: 10_000 },
		);
	} finally {
		await runner.release();
	}
	const events = await h.events();
	return {
		ms: now() - began,
		steps: deriveSteps(foldRun(events)),
		ends: payloads(events, "RunEnded"),
		events,
	};
}

describe("a Call on the branch that loses a `first` Join", () => {
	test("stops the steps of its called flow at once; the run finishes along the winner", async () => {
		const harness = slowHarness();
		const h = await startRun(
			sandbox,
			raceBeside({
				id: "sub",
				type: "call",
				position: at,
				flow: "work",
				inputs: {},
			}),
			{ harness, flows: { work: longWork } },
		);
		const run = await walk(h, "finished");
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("slow").map((s) => s.outcome)).toEqual(["stopped"]);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["stopped", OUTRUN_ERROR],
		]);
		expect(of("after").map((s) => s.outcome)).toEqual(["pass"]);
		expect(run.ends.map((e) => e.endReason)).toEqual(["finished"]);
		expect(harness.calls).toHaveLength(1);
	}, 20_000);

	test("with each: the running element's steps stop, and no next element starts", async () => {
		const harness = slowHarness();
		const h = await startRun(
			sandbox,
			raceBeside({
				id: "sub",
				type: "call",
				position: at,
				flow: "work",
				inputs: {},
				each: {
					source: {
						kind: "json",
						value: '[{"id":"x","title":"x"},{"id":"y","title":"y"}]',
					},
					as: "item",
					branch: "shared",
				},
			}),
			{ harness, flows: { work: longWork } },
		);
		const run = await walk(h, "finished");
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("slow").map((s) => s.outcome)).toEqual(["stopped"]);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["stopped", OUTRUN_ERROR],
		]);
		expect(payloads(run.events, "ItemStarted")).toHaveLength(1);
		expect(of("after").map((s) => s.outcome)).toEqual(["pass"]);
		expect(run.ends.map((e) => e.endReason)).toEqual(["finished"]);
		expect(harness.calls).toHaveLength(1);
	}, 20_000);

	test("with each: the command that reads its list stops too", async () => {
		const harness = slowHarness();
		const h = await startRun(
			sandbox,
			raceBeside({
				id: "sub",
				type: "call",
				position: at,
				flow: "work",
				inputs: {},
				each: {
					source: {
						kind: "command",
						command: `touch '${started()}'; sleep 20; echo '[]'`,
					},
					as: "item",
					branch: "shared",
				},
			}),
			{ harness, flows: { work: longWork } },
		);
		const run = await walk(h, "finished");
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["stopped", OUTRUN_ERROR],
		]);
		expect(payloads(run.events, "ItemsRead")).toEqual([]);
		expect(of("after").map((s) => s.outcome)).toEqual(["pass"]);
		expect(run.ends.map((e) => e.endReason)).toEqual(["finished"]);
		expect(harness.calls).toHaveLength(0);
	}, 20_000);
});

describe("a Call with each beside a `first` Join, between two elements", () => {
	test("the next element does not start once another branch won", async () => {
		const harness = fakeHarness((input: AgentSessionInput) =>
			/Do y\./.test(input.prompt)
				? { steps: [{ type: "wait", ms: 30_000 }] }
				: reportingScript("pass", "ok"),
		);
		// The first element ends at once; the other branch wins a second later.
		const perItem = flowOf([agent("work", "Do {{item.id}}.")], [], {
			inputs: [{ name: "item", type: "json" }],
		});
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("start", "true"),
					command("fast", "sleep 1"),
					{
						id: "sub",
						type: "call",
						position: at,
						flow: "per-item",
						inputs: {},
						each: {
							source: {
								kind: "json",
								value: '[{"id":"x","title":"x"},{"id":"y","title":"y"}]',
							},
							as: "item",
							branch: "shared",
						},
					},
					{ id: "joined", type: "join", position: at, wait: "first" },
					command("after", "true"),
				],
				[
					edge("s-fast", "start", "pass", "fast"),
					edge("s-sub", "start", "pass", "sub"),
					edge("fast-j", "fast", "pass", "joined"),
					edge("sub-j", "sub", "done", "joined"),
					edge("j-after", "joined", "done", "after"),
				],
			),
			{ harness, flows: { "per-item": perItem } },
		);
		const run = await walk(h, "finished");
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("work").map((s) => s.outcome)).toEqual(["pass"]);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["stopped", OUTRUN_ERROR],
		]);
		expect(payloads(run.events, "ItemStarted")).toHaveLength(1);
		expect(run.ends.map((e) => e.endReason)).toEqual(["finished"]);
		expect(harness.calls).toHaveLength(1);
	}, 20_000);
});

describe("a Call that runs past its time budget", () => {
	test("stops the steps of its called flow and ends `error` with the budget's words; the run fails there", async () => {
		const harness = slowHarness();
		const h = await startRun(
			sandbox,
			flowOf(
				[
					{
						id: "sub",
						type: "call",
						position: at,
						flow: "work",
						inputs: {},
						timeoutMinutes: 1,
					},
					command("after", "true"),
				],
				[edge("pass", "sub", "pass", "after")],
			),
			{ harness, flows: { work: longWork } },
		);
		const run = await walk(h, "failed");
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("slow").map((s) => s.outcome)).toEqual(["stopped"]);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["error", budgetError("timeout", 1)],
		]);
		expect(of("after")).toEqual([]);
		expect(run.ends.map((e) => [e.status, e.endReason])).toEqual([
			["failed", "_OTHER"],
		]);
	}, 20_000);
});

describe("a person stops the run while a Call on a branch works", () => {
	test("the run ends `stopped_by_person`, the Call step and its steps `stopped`", async () => {
		const harness = slowHarness();
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("start", "true"),
					command("other", "sleep 20"),
					{ id: "sub", type: "call", position: at, flow: "work", inputs: {} },
					{ id: "joined", type: "join", position: at, wait: "first" },
				],
				[
					edge("s-o", "start", "pass", "other"),
					edge("s-sub", "start", "pass", "sub"),
					edge("o-j", "other", "pass", "joined"),
					edge("sub-j", "sub", "pass", "joined"),
				],
			),
			{ harness, flows: { work: longWork } },
		);
		const run = await walk(h, "stopped", async (runner) => {
			await waitFor(
				async () =>
					payloads(await h.events(), "SessionStarted").length > 0 || null,
				{ label: "the called flow's Agent to work", timeoutMs: 5_000 },
			);
			await runner.take(h.runId, { kind: "stop", by: "person" });
		});
		expect(run.ms).toBeLessThan(10_000);
		const of = (id: string) => run.steps.filter((s) => s.nodeId === id);
		expect(of("slow").map((s) => s.outcome)).toEqual(["stopped"]);
		expect(of("sub").map((s) => [s.outcome, s.error])).toEqual([
			["stopped", null],
		]);
		expect(run.ends.map((e) => e.endReason)).toEqual(["stopped_by_person"]);
	}, 20_000);
});
