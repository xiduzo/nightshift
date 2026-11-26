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
	["two Agents", 16, 50],
	["an Agent and a Wait", 11, 44],
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

test("a Gate beside a sleeper: the answer goes on when the sleeper wakes, and a second answer is refused", async () => {
	let now = T0;
	const harness = fakeHarness((input) =>
		input.resumeSessionId
			? reportingScript("pass", "Done.")
			: input.prompt === "Do a" && now < (RESET.a as number)
				? usageLimitScript((RESET.a as number) - 1000)
				: reportingScript("needs-input", "Which one?"),
	);
	const h = await startRun(
		sandbox,
		beside(agent("b", "Do b", { ask: "person" }), "pass"),
		{ harness, now: () => now },
	);
	let runner = testRunner(h, { overdueSweepMs: 3_600_000 });
	const state = async () => foldRun(await h.events());
	const still = () => waitFor(() => !runner.isActive(h.runId));
	try {
		await runner.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		const gate = await waitFor(async () => (await state()).gate ?? false);
		await still();
		const answer = () =>
			runner.take(h.runId, {
				kind: "answer",
				stepId: gate.stepId,
				choice: "answer",
				note: "The red one.",
			});
		await answer();
		await still();
		// The Agent goes on with the answer in the super-step after it, which
		// comes once the sleeper beside it woke.
		await expect(answer()).rejects.toThrow("This Gate has its answer.");
		// A new daemon: recovery keeps the sleeper beside the open Gate.
		await runner.release();
		runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		const open = openWork(await state(), { kind: "interrupted" });
		expect(open).toMatchObject({ steps: [], endsRun: false });
		runner.restore(h.runId, await state());
		await expect(answer()).rejects.toThrow("This Gate has its answer.");
		now = RESET.a as number;
		await runner.take(h.runId, { kind: "wake", early: false });
		await waitFor(async () => (await state()).status === "finished");
		expect(
			harness.calls.filter((call) => call.prompt === "The red one."),
		).toHaveLength(1);
	} finally {
		await runner.release();
	}
});

for (const [where, before] of [
	["before the checkpoint of the wake", "checkpoint"],
	["as the answered Agent goes on", "StepReopened"],
] as const)
	test(`the daemon dies ${where}, after the sleeper beside an answered Gate woke: the next answer moves the run, and the Agent gets the first one`, async () => {
		let now = T0;
		const harness = fakeHarness((input) =>
			input.resumeSessionId
				? reportingScript("pass", "Done.")
				: input.prompt === "Do a" && now < (RESET.a as number)
					? usageLimitScript((RESET.a as number) - 1000)
					: reportingScript("needs-input", "Which one?"),
		);
		const h = await startRun(
			sandbox,
			beside(agent("b", "Do b", { ask: "person" }), "pass"),
			{ harness, now: () => now },
		);
		let died = false;
		let runner = testRunner(h, {
			overdueSweepMs: 3_600_000,
			openThread: (row, deps) => {
				const thread = openThread(row, deps);
				const { log } = thread.ctx;
				thread.ctx.log = {
					...log,
					append: async (input, rows) => {
						// The Agent that was answered opens its step again: dead.
						if (died || input.type === before) {
							died = true;
							throw new Error("the daemon died");
						}
						return log.append(input, rows);
					},
				};
				const put = thread.saver.put.bind(thread.saver);
				thread.saver.put = async (...args) => {
					// The checkpoint of the wake's super-step: its writes are saved.
					const woke = (await h.events()).some((e) => e.type === "WaitEnded");
					if (died || (before === "checkpoint" && woke)) {
						died = true;
						throw new Error("the daemon died");
					}
					return put(...args);
				};
				return thread;
			},
		});
		const state = async () => foldRun(await h.events());
		const still = () => waitFor(() => !runner.isActive(h.runId));
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			const gate = await waitFor(async () => (await state()).gate ?? false);
			await still();
			const answer = (note: string) =>
				runner.take(h.runId, {
					kind: "answer",
					stepId: gate.stepId,
					choice: "answer",
					note,
				});
			await answer("The red one.");
			await still();
			now = RESET.a as number;
			await runner.take(h.runId, { kind: "wake", early: false });
			await waitFor(() => died && !runner.isActive(h.runId));
			await runner.release();
			runner = testRunner(h, { overdueSweepMs: 3_600_000 });
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
			runner.restore(h.runId, await state());
			// The log still waits at the Gate, and nothing else wakes the run.
			expect((await state()).status).toBe("waiting");
			// The thread had the first answer: it goes on with it.
			await answer("The blue one.").catch((error: Error) => {
				expect(error.message).toBe(
					"This Gate has its answer. The run continues with it.",
				);
			});
			await waitFor(async () => (await state()).status === "finished");
			const told = harness.calls.map((call) => call.prompt);
			expect(told.filter((p) => p === "The red one.")).toHaveLength(1);
			expect(told).not.toContain("The blue one.");
		} finally {
			await runner.release();
		}
	});

test("recovery keeps every sleeper", () => {
	const open = openWork(both().state(), { kind: "interrupted" });
	expect(open.steps).toEqual([]);
	expect(open.endsRun).toBe(false);
});

test("recovery keeps every open Gate, and a sleeper beside one", () => {
	const log = runEvents()
		.runStarted()
		.stepStarted("a", "a")
		.waitStarted("a", { until: 400 })
		.stepStarted("g", "g")
		.gateOpened("g")
		.stepStarted("h", "h")
		.gateOpened("h");
	const open = openWork(log.state(), { kind: "interrupted" });
	expect(open.steps).toEqual([]);
	expect(open.endsRun).toBe(false);
});

test("two branches ask, and the daemon dies before the second ask is saved: each answer reaches its own Agent", async () => {
	const harness = fakeHarness((input) =>
		input.resumeSessionId
			? reportingScript("pass", "Done.")
			: reportingScript("needs-input", "Which one?"),
	);
	const asks = (id: string) => agent(id, `Do ${id}`, { ask: "person" });
	const h = await startRun(
		sandbox,
		flowOf(
			[
				command("start", "true"),
				asks("a"),
				asks("b"),
				{ id: "joined", type: "join", position: at, wait: "all" },
			],
			[
				edge("1", "start", "pass", "a"),
				edge("2", "start", "pass", "b"),
				edge("3", "a", "pass", "joined"),
				edge("4", "b", "pass", "joined"),
			],
		),
		{ harness },
	);
	let gates = 0;
	let died = false;
	let runner = testRunner(h, {
		overdueSweepMs: 3_600_000,
		openThread: (row, deps) => {
			const thread = openThread(row, deps);
			const { log } = thread.ctx;
			thread.ctx.log = {
				...log,
				append: async (input, rows) => {
					if (died) throw new Error("the daemon died");
					if (input.type === "GateOpened") gates++;
					return log.append(input, rows);
				},
			};
			const putWrites = thread.saver.putWrites.bind(thread.saver);
			thread.saver.putWrites = async (...args) => {
				// The writes of the task that asked second.
				if (died || gates === 2) {
					died = true;
					throw new Error("the daemon died");
				}
				return putWrites(...args);
			};
			return thread;
		},
	});
	const state = async () => foldRun(await h.events());
	try {
		await runner.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		await waitFor(() => died && !runner.isActive(h.runId));
		await runner.release();
		runner = testRunner(h, { overdueSweepMs: 3_600_000 });
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
		expect((await state()).gates.map((g) => g.nodeId).sort()).toEqual([
			"a",
			"b",
		]);
		for (const nodeId of ["b", "a"]) {
			const gate = (await state()).gates.find((g) => g.nodeId === nodeId);
			await runner.take(h.runId, {
				kind: "answer",
				stepId: gate?.stepId ?? "",
				choice: "answer",
				note: `For ${nodeId}.`,
			});
			await waitFor(() => !runner.isActive(h.runId));
		}
		await waitFor(async () => (await state()).status === "finished");
		const owners = new Map<string, string>();
		for (const call of harness.calls) {
			if (!call.resumeSessionId) {
				owners.set(`fake-session-${owners.size + 1}`, call.prompt);
			}
		}
		const told = harness.calls
			.filter((call) => call.prompt.startsWith("For "))
			.map((call) => [owners.get(call.resumeSessionId ?? ""), call.prompt]);
		expect(told.sort()).toEqual([
			["Do a", "For a."],
			["Do b", "For b."],
		]);
	} finally {
		await runner.release();
	}
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

test("a new daemon sets the timer of a sleep that comes before the deadline of a Gate beside it", async () => {
	const woken: string[] = [];
	const sleeps = createSleeps({ now: () => 500, wake: (id) => woken.push(id) });
	sleeps.restore(
		"run-1",
		runEvents()
			.runStarted()
			.stepStarted("a", "a")
			.waitStarted("a", { until: 400 })
			.stepStarted("g", "g")
			.push(
				"GateOpened",
				{
					question: "Ship it?",
					choices: [{ name: "yes" }],
					deadline: { at: 900_000, choose: "yes" },
				},
				{ stepId: "g" },
			)
			.state(),
	);
	await waitFor(() => woken.length > 0, { timeoutMs: 500 });
	sleeps.dispose();
	expect(woken).toEqual(["run-1"]);
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
