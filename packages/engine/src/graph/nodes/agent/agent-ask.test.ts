import { describe, expect, test } from "bun:test";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import { foldRun } from "../../../log";
import { getRunRow } from "../../../log/run-row/run-row";
import { deriveSteps } from "../../../read/run-views";
import {
	agent,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
	testRunner,
} from "../../../testing/graph";
import { sandboxPerTest } from "../../../testing/sandbox-per-test";
import { waitFor } from "../../../testing/test-support";
import type { Runner } from "../../runner/runner";
import { openThread } from "../../runner/thread";

/**
 * An Agent asks, and a person stops the run after the log has its Gate and
 * before the thread has it. The thread makes three writes there: the step's
 * jump to the ask node, the checkpoint at the ask node, and the interrupt.
 * A real runner takes the stop before one of them.
 */

const sandbox = sandboxPerTest();

const WRITES = ["the jump", "the checkpoint", "the interrupt"] as const;

/** A run whose Agent asked and that a person stopped before `write`, and its runner. */
async function stoppedBefore(write: (typeof WRITES)[number]) {
	const harness = fakeHarness((_input, call) =>
		call === 0
			? reportingScript("needs-input", "Which database?")
			: reportingScript("pass", "Built it on Postgres."),
	);
	const h = await startRun(
		sandbox,
		flowOf([agent("worker", "Build it", { ask: "person" })]),
		{ harness },
	);
	let writes = 0;
	const beforeWrite = async () => {
		if (payloads(await h.events(), "GateOpened").length === 0) return;
		if (WRITES[writes++] !== write) return;
		await runner.take(h.runId, { kind: "stop", by: "person" });
	};
	const runner = testRunner(h, {
		openThread: (row, deps) => {
			const thread = openThread(row, deps);
			const put = thread.saver.put.bind(thread.saver);
			const putWrites = thread.saver.putWrites.bind(thread.saver);
			thread.saver.put = async (...args) => {
				await beforeWrite();
				return put(...args);
			};
			thread.saver.putWrites = async (...args) => {
				await beforeWrite();
				return putWrites(...args);
			};
			return thread;
		},
	});
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	expect(await settled(h, runner)).toBe("stopped");
	return { h, runner, harness };
}

const statusOf = async (h: Harness) => foldRun(await h.events()).status;

/** The status of the run once no drive holds it. */
const settled = (h: Harness, runner: Runner) =>
	waitFor(async () => {
		if (runner.isActive(h.runId)) return null;
		const status = await statusOf(h);
		return status === "running" ? null : status;
	});

/** The run as a stop left it: the step ended stopped, no Gate is open. */
async function expectStopped(h: Harness) {
	const state = foldRun(await h.events());
	expect(state.status).toBe("stopped");
	expect((await h.events()).at(-1)?.type).toBe("RunEnded");
	expect(state.gate).toBeNull();
	expect(deriveSteps(state).map((s) => [s.nodeId, s.outcome])).toEqual([
		["worker", "stopped"],
	]);
}

/** Resumes the run once, with the person's prompt, until it is done. */
async function resumeOnce(h: Harness, runner: Runner) {
	await runner.take(h.runId, {
		kind: "resume",
		by: "person",
		prompt: "Use Postgres.",
	});
	expect(await settled(h, runner)).toBe("finished");
}

describe("an Agent's Gate that a stop ended before its checkpoint", () => {
	for (const write of WRITES) {
		test(`before ${write}: the run is stopped, and no answer finds the Gate`, async () => {
			const { h, harness } = await stoppedBefore(write);
			await expectStopped(h);
			expect(harness.calls).toHaveLength(1);
		});

		test(`before ${write}: one resume continues the step and its session with the person's prompt`, async () => {
			const { h, runner, harness } = await stoppedBefore(write);
			await resumeOnce(h, runner);
			const state = foldRun(await h.events());
			expect(state.status).toBe("finished");
			expect(deriveSteps(state).map((s) => [s.nodeId, s.outcome])).toEqual([
				["worker", "pass"],
			]);
			expect(harness.calls.map((c) => [c.prompt, c.resumeSessionId])).toEqual([
				["Build it", undefined],
				["Use Postgres.", "fake-session-1"],
			]);
			expect(payloads(await h.events(), "GateOpened")).toHaveLength(1);
			expect(payloads(await h.events(), "RunResumed")).toHaveLength(1);
		});

		test(`before ${write}: after a restart the run stays stopped until a person resumes it`, async () => {
			const { h, runner, harness } = await stoppedBefore(write);
			await runner.release();
			const restarted = testRunner(h);
			restarted.restore(h.runId, foldRun(await h.events()));
			expect(restarted.isActive(h.runId)).toBe(false);
			await expectStopped(h);
			await resumeOnce(h, restarted);
			expect(await statusOf(h)).toBe("finished");
			expect(harness.calls.at(-1)).toMatchObject({
				prompt: "Use Postgres.",
				resumeSessionId: "fake-session-1",
			});
			expect(harness.calls).toHaveLength(2);
		});
	}
});

/**
 * What the step went through before its last question. `stop`: a stop at an
 * open Gate and a resume. `answer`: an answer. `drop`: a stop before the
 * Gate's checkpoint and a resume. `sleep`: a usage limit that a person ends
 * early. `sleep, stop`: one that a stop ended, and a resume. `park`: a failed
 * session and a resume.
 */
type Past = "stop" | "answer" | "drop" | "sleep" | "sleep, stop" | "park";

const PASTS: readonly Past[][] = [
	[],
	["stop"],
	["answer"],
	["drop"],
	["sleep"],
	["sleep, stop"],
	["park"],
	["stop", "stop"],
	["stop", "answer"],
	["answer", "stop"],
	["answer", "answer"],
	["drop", "drop"],
	["drop", "stop"],
	["sleep", "stop"],
	["sleep", "drop"],
	["sleep", "sleep"],
	["park", "stop"],
	["park", "answer"],
	["park", "drop"],
];

/** Walks an Agent through `past` to its last question, and stops it there before `write`. */
async function askedAfter(
	past: readonly Past[],
	write: (typeof WRITES)[number],
	/** The first Agent passes after `past`, and the second one asks the last question. */
	later = false,
) {
	const harness = fakeHarness((_input, call) => {
		const at = past[call];
		if (at === "sleep" || at === "sleep, stop") return usageLimitScript();
		if (at === "park") return failingScript();
		if (later && call === past.length)
			return reportingScript("pass", "Built it.");
		return call <= past.length + (later ? 1 : 0)
			? reportingScript("needs-input", `Question ${call}`)
			: reportingScript("pass", "Built it.");
	});
	const h = await startRun(
		sandbox,
		later
			? flowOf(
					[
						agent("worker", "Build it", { ask: "person" }),
						agent("checker", "Check it", { ask: "person" }),
					],
					[edge("e1", "worker", "pass", "checker")],
				)
			: flowOf([agent("worker", "Build it", { ask: "person" })]),
		{ harness },
	);
	const asks = past.filter((p) => ["stop", "answer", "drop"].includes(p));
	/** The questions, by number, that a stop drops. */
	const dropped = new Set([
		...asks.flatMap((p, i) => (p === "drop" ? [i + 1] : [])),
		asks.length + 1,
	]);
	const writes = new Map<number, number>();
	const beforeWrite = async () => {
		const gate = payloads(await h.events(), "GateOpened").length;
		if (!dropped.has(gate)) return;
		const at = writes.get(gate) ?? 0;
		writes.set(gate, at + 1);
		if (WRITES[at] !== write) return;
		await runner.take(h.runId, { kind: "stop", by: "person" });
	};
	const runner = testRunner(h, {
		openThread: (row, deps) => {
			const thread = openThread(row, deps);
			const put = thread.saver.put.bind(thread.saver);
			const putWrites = thread.saver.putWrites.bind(thread.saver);
			thread.saver.put = async (...args) => {
				await beforeWrite();
				return put(...args);
			};
			thread.saver.putWrites = async (...args) => {
				await beforeWrite();
				return putWrites(...args);
			};
			return thread;
		},
	});
	const take = runner.take.bind(runner, h.runId);
	const resume = (prompt: string) =>
		take({ kind: "resume", by: "person", prompt });
	const is = async (status: string) =>
		expect(await settled(h, runner)).toBe(status as never);
	await take({
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	for (const [i, at] of past.entries()) {
		const prompt = `Prompt ${i}`;
		if (at === "answer") {
			await is("waiting");
			const stepId = foldRun(await h.events()).gate?.stepId as string;
			await take({ kind: "answer", stepId, choice: "answer", note: prompt });
			continue;
		}
		if (at === "stop") await is("waiting");
		if (at === "sleep" || at === "sleep, stop") await is("sleeping");
		if (at === "stop" || at === "sleep, stop") {
			await take({ kind: "stop", by: "person" });
		}
		if (at === "park") await is("failed");
		else if (at !== "sleep") await is("stopped");
		await resume(prompt);
	}
	await is("stopped");
	return { h, runner, harness, asks: asks.length + 1 };
}

describe("a question that a stop ended before its checkpoint needs one resume", () => {
	for (const past of PASTS) {
		for (const write of WRITES) {
			test(`after ${past.join(" then ") || "nothing"}, before ${write}: the session goes on with the prompt`, async () => {
				const { h, runner, harness, asks } = await askedAfter(past, write);
				expect(harness.calls).toHaveLength(past.length + 1);
				await resumeOnce(h, runner);
				expect(harness.calls.map((c) => [c.prompt, c.resumeSessionId])).toEqual(
					[
						["Build it", undefined],
						...past.map((_, i) => [`Prompt ${i}`, "fake-session-1"]),
						["Use Postgres.", "fake-session-1"],
					],
				);
				const events = await h.events();
				expect(
					deriveSteps(foldRun(events)).map((s) => [s.visit, s.outcome]),
				).toEqual([[1, "pass"]]);
				expect(payloads(events, "GateOpened")).toHaveLength(asks);
			});
		}
	}
});

describe("an Agent that asked and finished", () => {
	const WAYS: Past[][] = [["stop"], ["answer"], ["drop"], ["sleep"], ["park"]];
	for (const past of WAYS) {
		for (const write of WRITES) {
			test(`after ${past}: does not run again when a stop ends a later question before ${write}`, async () => {
				const { h, runner, harness } = await askedAfter(past, write, true);
				await resumeOnce(h, runner);
				expect(harness.calls.map((c) => c.prompt)).toEqual([
					"Build it",
					...past.map((_, i) => `Prompt ${i}`),
					"Check it",
					"Use Postgres.",
				]);
				expect(
					deriveSteps(foldRun(await h.events())).map((s) => [
						s.nodeId,
						s.visit,
						s.outcome,
					]),
				).toEqual([
					["worker", 1, "pass"],
					["checker", 1, "pass"],
				]);
			});
		}
	}
});
