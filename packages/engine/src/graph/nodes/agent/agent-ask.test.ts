import { describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import { foldRun } from "../../../log";
import { getRunRow } from "../../../log/run-row/run-row";
import { deriveSteps } from "../../../read/run-views";
import {
	agent,
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
	expect(state.gate).toBeNull();
	expect(deriveSteps(state).map((s) => [s.nodeId, s.outcome])).toEqual([
		["worker", "stopped"],
	]);
}

/** Resumes the run until it goes on from its stop. A resume may find the Gate gone and stop again. */
async function resumeUntilDone(h: Harness, runner: Runner) {
	for (let resumes = 0; (await statusOf(h)) === "stopped"; resumes++) {
		if (resumes === 2) throw new Error("The run did not go on.");
		await expectStopped(h);
		await runner.take(h.runId, {
			kind: "resume",
			by: "person",
			prompt: "Use Postgres.",
		});
		await settled(h, runner);
	}
}

describe("an Agent's Gate that a stop ended before its checkpoint", () => {
	for (const write of WRITES) {
		test(`before ${write}: the run is stopped, and no answer finds the Gate`, async () => {
			const { h, harness } = await stoppedBefore(write);
			await expectStopped(h);
			expect(harness.calls).toHaveLength(1);
		});

		test(`before ${write}: a resume continues the step and its session with the person's prompt`, async () => {
			const { h, runner, harness } = await stoppedBefore(write);
			await resumeUntilDone(h, runner);
			const state = foldRun(await h.events());
			expect(state.status).toBe("finished");
			expect(deriveSteps(state).map((s) => [s.nodeId, s.outcome])).toEqual([
				["worker", "pass"],
			]);
			expect(harness.calls.map((c) => [c.prompt, c.resumeSessionId])).toEqual([
				["Build it", undefined],
				["Use Postgres.", "fake-session-1"],
			]);
		});

		test(`before ${write}: after a restart the run stays stopped until a person resumes it`, async () => {
			const { h, runner, harness } = await stoppedBefore(write);
			await runner.release();
			const restarted = testRunner(h);
			restarted.restore(h.runId, foldRun(await h.events()));
			expect(restarted.isActive(h.runId)).toBe(false);
			await expectStopped(h);
			await resumeUntilDone(h, restarted);
			expect(await statusOf(h)).toBe("finished");
			expect(harness.calls.at(-1)).toMatchObject({
				prompt: "Use Postgres.",
				resumeSessionId: "fake-session-1",
			});
			expect(harness.calls).toHaveLength(2);
		});
	}
});
