import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import {
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps, parseCalledFlows, parseRunFlow } from "../../read";
import {
	agent,
	command,
	edge,
	flowOf,
	startRun,
	testRunner,
} from "../../testing/graph";
import { runEvents } from "../../testing/run-events";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../testing/test-support";
import { closeOpenWork, openWork } from "./open-work";
import { openThread, type ThreadState } from "./thread";
import { createSleeps, planWake } from "./wake";

/**
 * Steps sleep, alone or on two branches. The daemon dies before a write, in the
 * sleep or in a wake, so the log and the thread disagree. The run goes on by
 * itself, and each step ends well once. The clock is the test's.
 */

const at = { x: 0, y: 0 };
const T0 = 1_800_000_000_000;
const RESET: Record<string, number> = { a: T0 + 100_000, b: T0 + 200_000 };

let sandbox: Sandbox;
let quiet: ReturnType<typeof spyOn>;
beforeAll(async () => {
	sandbox = await createSandbox();
	// A dying daemon logs what it could not write; that is the point here.
	quiet = spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
	quiet.mockRestore();
	await sandbox.cleanup();
});

const a = agent("a", "Do a");
const nap = {
	id: "b",
	type: "wait" as const,
	position: at,
	until: { kind: "duration" as const, minutes: 200 },
};
const beside = (b: { id: string }, done: string) =>
	flowOf(
		[
			command("start", "true"),
			a,
			b as never,
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("1", "start", "pass", "a"),
			edge("2", "start", "pass", "b"),
			edge("3", "a", "pass", "joined"),
			edge("4", "b", done, "joined"),
		],
	);
const SHAPES = {
	"two Agents": beside(agent("b", "Do b"), "pass"),
	"an Agent and a Wait": beside(nap, "done"),
	"one Agent": flowOf([a]),
};

/** Walks a flow, and kills the daemon before the `crash`-th write. Returns the number of writes. */
async function walk(name: keyof typeof SHAPES, crash: number) {
	let now = T0;
	const owners = new Map<string, string>();
	const harness = fakeHarness((input) => {
		const id = input.resumeSessionId
			? (owners.get(input.resumeSessionId) as string)
			: (input.prompt.split(" ")[1] as string);
		if (!input.resumeSessionId) {
			owners.set(`fake-session-${owners.size + 1}`, id);
		}
		const reset = RESET[id] as number;
		return now < reset
			? usageLimitScript(reset - 1000)
			: reportingScript("pass", "Done.");
	});
	const h = await startRun(sandbox, SHAPES[name], { harness, now: () => now });
	let writes = 0;
	let died = false;
	function daemon() {
		let dead = false;
		const point = () => {
			if (dead) throw new Error("the daemon died");
			if (writes++ !== crash) return;
			dead = true;
			died = true;
			throw new Error("the daemon died");
		};
		const { log } = h.deps.shared;
		return testRunner(h, {
			overdueSweepMs: 3_600_000,
			shared: {
				log: {
					...log,
					append: async (input, rows) => {
						point();
						return log.append(input, rows);
					},
				},
			},
			openThread: (row, deps) => {
				const thread = openThread(row, deps);
				const { saver } = thread;
				const put = saver.put.bind(saver);
				const putWrites = saver.putWrites.bind(saver);
				saver.put = async (...args) => {
					point();
					return put(...args);
				};
				saver.putWrites = async (...args) => {
					point();
					return putWrites(...args);
				};
				return thread;
			},
		});
	}
	let runner = daemon();
	const state = async () => foldRun(await h.events());
	/** The run once no drive holds it. A new daemon takes it when its daemon died. */
	const still = async () => {
		await waitFor(() => !runner.isActive(h.runId));
		if (!died) return;
		died = false;
		await runner.release();
		runner = daemon();
		const open = openWork(await state(), { kind: "interrupted" });
		await closeOpenWork(
			{
				log: h.log,
				bus: h.deps.shared.bus,
				flowOf: parseRunFlow,
				calledFlowsOf: parseCalledFlows,
			},
			h.runId,
			{ kind: "interrupted", reason: "Night Shift stopped." },
		);
		if (open.endsRun) {
			await runner.take(h.runId, { kind: "resume", by: "daemon" });
		} else runner.restore(h.runId, await state());
		await waitFor(() => !runner.isActive(h.runId));
	};
	await runner
		.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		})
		.catch(() => {});
	await still();
	for (let i = 0; i < 10 && (await state()).status === "sleeping"; i++) {
		now += 50_000;
		await runner.take(h.runId, { kind: "wake", early: false }).catch(() => {});
		await still();
	}
	const run = await state();
	await runner.release();
	const steps = deriveSteps(run);
	return {
		status: run.status,
		// Each node of a branch ends well once, and no step stays open.
		passed: steps
			.filter((s) => s.outcome === "pass" || s.outcome === "done")
			.map((s) => s.nodeId)
			.filter((id) => id === "a" || id === "b")
			.sort(),
		open: steps.filter((s) => s.endedAt === null).length,
		writes,
	};
}

/** Each shape, its first write in a sleep, and the number of its writes. The last one is `RunEnded`. */
const WALKS = [
	["two Agents", 16, 51],
	["an Agent and a Wait", 11, 45],
	["one Agent", 4, 22],
] as const;
for (const [name, from, total] of WALKS) {
	const good = {
		status: "finished" as const,
		passed: (name === "one Agent" ? ["a"] : ["a", "b"]) as ("a" | "b")[],
		open: 0,
	};
	test(`${name}, no crash`, async () => {
		const { writes, ...end } = await walk(name, -1);
		expect(end).toEqual(good);
		expect(writes).toBe(total);
	});
	test(
		`${name}, the daemon dies before each write: the run finishes by itself`,
		async () => {
			const bad: object[] = [];
			for (let crash = from; crash < total - 1; crash++) {
				const { writes: _, ...end } = await walk(name, crash);
				if (!Bun.deepEquals(end, good)) bad.push({ crash, ...end });
			}
			expect(bad).toEqual([]);
		},
		{ timeout: 60_000 },
	);
}

test("recovery keeps every sleeper", () => {
	const open = openWork(both().state(), { kind: "interrupted" });
	expect(open.steps).toEqual([]);
	expect(open.endsRun).toBe(false);
});

/** A log where `a` sleeps until 400 and `b`, which slept later, until 800. */
const both = () =>
	runEvents()
		.runStarted()
		.stepStarted("a", "a")
		.waitStarted("a", { until: 400 })
		.stepStarted("b", "b")
		.waitStarted("b", { until: 800 });
const wait = (stepId: string) => ({
	kind: "wait" as const,
	stepId,
	nodeId: stepId,
	reason: "usage-limit" as const,
	until: null,
	message: "",
});
const sits = (...ids: string[]): ThreadState => ({
	kind: "interrupted",
	value: wait(ids[0] as string),
	interrupts: ids.map((id) => ({ id: `i-${id}`, value: wait(id) })),
});
const WOKEN = { kind: "wake", early: false };

test("a wake moves the step that wakes, and each interrupt whose step the log does not hold asleep", () => {
	const plan = (log: ReturnType<typeof both>, thread: ThreadState) =>
		planWake(log.state(), thread, { early: false }, 900);
	// The other sleeper keeps its wait.
	expect(plan(both(), sits("a", "b"))).toMatchObject({
		step: { id: "a" },
		entry: { kind: "resume", each: { "i-a": WOKEN } },
	});
	expect(plan(both().waitEnded("a"), sits("a", "b"))).toMatchObject({
		step: { id: "b" },
		entry: { each: { "i-a": WOKEN, "i-b": WOKEN } },
	});
	// The thread does not hold the wait: its task runs again.
	expect(plan(both(), sits("b"))).toMatchObject({
		step: { id: "a" },
		entry: { kind: "continue" },
	});
	expect(plan(both(), { kind: "pending", next: ["a", "b"] })).toMatchObject({
		entry: { kind: "continue" },
	});
});

test("a new daemon sets the timer of the step that wakes first", async () => {
	const woken: string[] = [];
	const sleeps = createSleeps({ now: () => 500, wake: (id) => woken.push(id) });
	sleeps.restore(
		"run-1",
		runEvents()
			.runStarted()
			.stepStarted("a", "a")
			.waitStarted("a", { until: 400 })
			.stepStarted("b", "b")
			.waitStarted("b", { until: 900_000 })
			.state(),
	);
	await waitFor(() => woken.length > 0, { timeoutMs: 500 });
	sleeps.dispose();
	expect(woken).toEqual(["run-1"]);
});

test("a resume that cannot wake the run says so, and the run stays as it was", async () => {
	const h = await startRun(sandbox, flowOf([agent("a", "Do a")]));
	await h.log.append({
		type: "StepStarted",
		runId: h.runId,
		stepId: "s1",
		payload: {
			nodeId: "a",
			nodeType: "agent",
			visit: 1,
			transcriptPath: "/t",
			logPath: null,
			scope: null,
		},
	});
	await h.log.append({
		type: "WaitStarted",
		runId: h.runId,
		stepId: "s1",
		payload: {
			reason: "usage-limit",
			until: T0,
			message: "Waits.",
			since: 0,
		},
	});
	const before = (await h.events()).length;
	const runner = testRunner(h);
	await expect(
		runner.take(h.runId, { kind: "resume", by: "person" }),
	).rejects.toThrow(
		"Night Shift could not wake this run. Stop the run, then resume it.",
	);
	expect((await h.events()).length).toBe(before);
	await runner.release();
});
