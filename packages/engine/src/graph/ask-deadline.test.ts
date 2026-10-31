import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Flow, ValueNode } from "@nightshift/flows";
import { foldRun } from "../log";
import { getRunRow } from "../log/run-row";
import { deriveOpenGate, deriveRunState, deriveSteps } from "../read/run-views";
import {
	command,
	edge,
	flowOf,
	type Harness,
	MINUTE,
	payloads,
	startRun,
	testRunner,
} from "../testing/graph";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import type { Runner } from "./runner";

/**
 * An Ask's deadline (ADR 10): it is a Gate's deadline, so the runner sets
 * the same timer. When it fires, the Ask takes the node's `default` as its
 * data; an Ask with no default ends `fail`.
 */

let sandbox: Sandbox;
let runners: Runner[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runners = [];
});
afterEach(async () => {
	for (const runner of runners) await runner.release();
	await sandbox.cleanup();
});

const T0 = Date.parse("2026-10-26T22:00:00");

const ask = (extra: Partial<ValueNode>): ValueNode => ({
	id: "pick",
	type: "value",
	position: { x: 0, y: 0 },
	by: "person",
	prompt: "Which size?",
	output: {
		type: "object",
		required: ["size"],
		properties: { size: { type: "string", enum: ["s", "m", "l"] } },
	},
	deadline: { minutes: 30 },
	...extra,
});

/** pick (pass → used; fail → missed). */
const askFlow = (node: ValueNode): Flow =>
	flowOf(
		[
			node,
			command("used", 'echo "size {{pick.data.size}}"'),
			command("missed", 'echo "{{pick.note}}"'),
		],
		[edge("e1", "pick", "pass", "used"), edge("e2", "pick", "fail", "missed")],
	);

async function setup(flow: Flow) {
	const clock = { now: T0 };
	const now = () => clock.now;
	const h = await startRun(sandbox, flow, { now });
	const runner = testRunner(h, { now });
	runners.push(runner);
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	await waitFor(async () => deriveOpenGate(foldRun(await h.events())));
	return { h, runner, clock };
}

const statusOf = async (h: Harness) =>
	deriveRunState(foldRun(await h.events())).status;

describe("an Ask with a deadline", () => {
	test("logs its form and when it is due, and at the deadline takes the default", async () => {
		const { h, runner, clock } = await setup(
			askFlow(ask({ default: { size: "m" } })),
		);
		const opened = payloads(await h.events(), "GateOpened")[0];
		expect(opened).toMatchObject({
			question: "Which size?",
			choices: [{ name: "answer" }],
			deadline: { at: T0 + 30 * MINUTE, choose: "answer" },
			form: { default: { size: "m" } },
		});
		const stepId = deriveOpenGate(foldRun(await h.events()))?.stepId;

		clock.now = T0 + 30 * MINUTE;
		await runner.take(h.runId, { kind: "wake", early: false });
		await waitFor(async () => (await statusOf(h)) === "finished");

		const steps = deriveSteps(foldRun(await h.events()));
		const note =
			"Nobody answered by the deadline, so Night Shift took the default.";
		expect(steps.find((s) => s.id === stepId)?.outputs).toEqual({
			outcome: "pass",
			data: { size: "m" },
			note,
			visit: 1,
		});
		expect(steps.find((s) => s.nodeId === "used")?.outputs.log_tail).toBe(
			"size m",
		);
	});

	test("with no default, the deadline ends the step fail", async () => {
		const { h, runner, clock } = await setup(askFlow(ask({})));
		clock.now = T0 + 31 * MINUTE;
		await runner.take(h.runId, { kind: "wake", early: false });
		await waitFor(async () => (await statusOf(h)) === "finished");
		const steps = deriveSteps(foldRun(await h.events()));
		expect(steps.find((s) => s.nodeId === "pick")?.outcome).toBe("fail");
		expect(steps.find((s) => s.nodeId === "missed")?.outputs.log_tail).toBe(
			"Nobody answered by the deadline.",
		);
	});

	test("a person who answers first wins", async () => {
		const { h, runner, clock } = await setup(
			askFlow(ask({ default: { size: "m" } })),
		);
		const stepId = deriveOpenGate(foldRun(await h.events()))?.stepId as string;
		await runner.take(h.runId, {
			kind: "answer",
			stepId,
			choice: "answer",
			note: "",
			data: { size: "l" },
		});
		await waitFor(async () => (await statusOf(h)) === "finished");
		clock.now = T0 + 30 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "unchanged",
		});
		const steps = deriveSteps(foldRun(await h.events()));
		expect(steps.find((s) => s.nodeId === "pick")?.outputs.data).toEqual({
			size: "l",
		});
	});
});
