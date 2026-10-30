import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
	StepBudget,
} from "../log/events";
import { findOverdue } from "./deadlines";

const MINUTE = 1_000;
const dir = await mkdtemp(join(tmpdir(), "deadlines-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** A run's log, each event at the time given. */
function log() {
	const events: LoggedEvent[] = [];
	const push = <T extends EngineEventType>(
		at: number,
		type: T,
		payload: EnginePayloads[T],
		stepId: string | null = null,
	) => {
		events.push({
			seq: events.length + 1,
			runId: "run-1",
			stepId,
			sessionId: null,
			type,
			payload,
			at,
		} as LoggedEvent);
		return builder;
	};
	const builder = {
		events,
		push,
		started: () =>
			push(0, "RunStarted", {
				projectId: "p",
				flowName: "f",
				title: "f",
				start: "worker",
			}),
		step: (
			at: number,
			stepId: string,
			budget: StepBudget,
			scope: Scope | null = null,
		) =>
			push(
				at,
				"StepStarted",
				{
					nodeId: stepId,
					nodeType: "agent",
					visit: 1,
					transcriptPath: join(dir, `${stepId}.ndjson`),
					logPath: null,
					scope,
					...budget,
				},
				stepId,
			),
	};
	return builder;
}

const check = (events: LoggedEvent[], now: number, graceMs = 0) =>
	findOverdue(
		events,
		{ now, graceMs, minuteMs: MINUTE },
		{ runId: "run-1", dataDir: dir },
	);

describe("findOverdue", () => {
	test("a step past its budget is overdue once the grace passed too", async () => {
		const { events } = log()
			.started()
			.step(100, "worker", { timeoutMs: 5 * MINUTE });
		expect(await check(events, 100 + 5 * MINUTE - 1)).toBeNull();
		expect(await check(events, 100 + 5 * MINUTE, MINUTE)).toBeNull();
		expect(await check(events, 100 + 6 * MINUTE, MINUTE)).toEqual({
			stepId: "worker",
			nodeId: "worker",
			reason: "timeout",
			error: "The step ran past its time budget of 5 min.",
		});
	});

	test("a step without a budget, or from a log before budgets, is never overdue", async () => {
		const { events } = log().started().step(100, "worker", {});
		expect(await check(events, 100 + 1000 * MINUTE)).toBeNull();
	});

	test("the idle clock counts from the step's last transcript entry", async () => {
		const { events } = log()
			.started()
			.step(100, "talker", { idleMs: 3 * MINUTE });
		// No transcript yet: the clock counts from the start.
		expect((await check(events, 100 + 3 * MINUTE))?.reason).toBe("idle");
		await writeFile(
			join(dir, "talker.ndjson"),
			`${JSON.stringify({ seq: 1, stepId: "talker", sessionId: null, at: 100 + 2 * MINUTE, event: { type: "text", messageId: "m", delta: "hi" } })}\n`,
		);
		expect(await check(events, 100 + 3 * MINUTE)).toBeNull();
		expect(await check(events, 100 + 5 * MINUTE)).toEqual({
			stepId: "talker",
			nodeId: "talker",
			reason: "idle",
			error: "The agent showed no activity for 3 min, so the step stopped.",
		});
	});

	test("a long transcript is read from its end", async () => {
		const { events } = log()
			.started()
			.step(0, "long", { idleMs: 3 * MINUTE });
		const entry = (seq: number, at: number) =>
			`${JSON.stringify({ seq, stepId: "long", sessionId: null, at, event: { type: "text", messageId: "m", delta: "x".repeat(2_000) } })}\n`;
		const lines = Array.from({ length: 100 }, (_, i) => entry(i + 1, i));
		await writeFile(
			join(dir, "long.ndjson"),
			lines.join("") + entry(101, 10 * MINUTE),
		);
		expect(await check(events, 12 * MINUTE)).toBeNull();
		expect((await check(events, 13 * MINUTE))?.reason).toBe("idle");
	});

	test("a wait parks the clock, and its end starts it again", async () => {
		const b = log()
			.started()
			.step(100, "worker", { timeoutMs: 5 * MINUTE })
			.push(
				200,
				"WaitStarted",
				{
					reason: "usage-limit",
					until: 100 * MINUTE,
					message: "Usage limit",
					since: 200,
				},
				"worker",
			);
		// Asleep: no limit applies.
		expect(await check(b.events, 50 * MINUTE)).toBeNull();
		b.push(100 * MINUTE, "WaitEnded", { early: false }, "worker");
		expect(await check(b.events, 104 * MINUTE)).toBeNull();
		expect((await check(b.events, 105 * MINUTE))?.reason).toBe("timeout");
	});

	test("a Call step's clock moves with the work inside it", async () => {
		const scope = { parentStepId: "caller", itemId: null };
		const b = log()
			.started()
			.step(0, "caller", { timeoutMs: 5 * MINUTE })
			.step(4 * MINUTE, "inner", {}, scope);
		expect(await check(b.events, 8 * MINUTE)).toBeNull();
		expect((await check(b.events, 9 * MINUTE))?.stepId).toBe("caller");
	});

	test("nothing is overdue in a run that ended", async () => {
		const { events } = log()
			.started()
			.step(100, "worker", { timeoutMs: MINUTE })
			.push(200, "RunEnded", { status: "interrupted", reason: null });
		expect(await check(events, 100 * MINUTE)).toBeNull();
	});
});
