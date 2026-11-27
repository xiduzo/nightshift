import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import type {
	AgentNode,
	CallEachNode,
	EndNode,
	Flow,
	Policy,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import { type EnginePayloads, foldRun, type RunEndReason } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { parseCalledFlows, parseRunFlow } from "../../read";
import {
	agent as agentNode,
	command,
	drive,
	edge,
	flowOf,
	MINUTE,
	payloads,
	type StartOptions,
	startRun,
	testRunner,
} from "../../testing/graph";
import { sandboxPerTest } from "../../testing/sandbox-per-test";
import { waitFor } from "../../testing/test-support";
import { closeOpenWork } from "./open-work";
import { endingOf, openThread } from "./thread";

/**
 * Why a run ended is a fact its writer gives, never words found in a
 * sentence. Each cause, through the real graph and the runner's
 * `endingOf`, on its own, inside a Call and inside a Call with each. A
 * message, a node id or a harness error with the words of a cause does not
 * give that cause's code.
 */

const sandbox = sandboxPerTest();

/** The words the old reader looked for, in sentences that are not those causes. */
const PHRASES = [
	"Usage limit: 5 users",
	"The network is down: the old router",
	"The network was down all week",
	"Reached the stop time",
	"The run spent $3 of the budget",
	"It reached its limit of 4 turns, so the step stopped",
	"He asked 3 times in a row with the same input",
	"The server showed no activity",
	"The team reached the limit of 10 steps",
];

const end = (id: string, status: EndNode["status"], message?: string) =>
	({
		id,
		type: "end",
		position: { x: 0, y: 0 },
		status,
		...(message !== undefined ? { message } : {}),
	}) as EndNode;

const agent = (id: string, extra: Partial<AgentNode> = {}) =>
	agentNode(id, `Work on ${id}`, extra);

async function codeOf(
	flow: Flow,
	options: StartOptions = {},
	stopAt: number | null = null,
): Promise<RunEndReason | undefined> {
	const h = await startRun(sandbox, flow, options);
	const driven = await drive(h, { inputs: {}, stopAt });
	return endingOf(driven.outcome)?.endReason;
}

describe("a sentence is not a cause", () => {
	for (const phrase of PHRASES) {
		test(`an End that finished with "${phrase}" ends finished`, async () => {
			expect(await codeOf(flowOf([end("done", "done", phrase)]))).toBe(
				"finished",
			);
		});

		test(`a failed End with "${phrase}" ends _OTHER`, async () => {
			expect(await codeOf(flowOf([end("broke", "failed", phrase)]))).toBe(
				"_OTHER",
			);
		});

		test(`a Command whose error says "${phrase}" ends _OTHER`, async () => {
			// Its data lacks a property of its schema: the error names it.
			const look = command("look", "echo '{}'", {
				stdout: "json",
				output: { type: "object", required: [phrase] },
			});
			expect(await codeOf(flowOf([look]))).toBe("_OTHER");
		});

		test(`an Agent whose harness fails with "${phrase}" ends _OTHER`, async () => {
			expect(
				await codeOf(flowOf([agent("worker")]), {
					harness: fakeHarness(failingScript(phrase)),
				}),
			).toBe("_OTHER");
		});
	}
});

/** How a row's flow runs: on its own, called once, or called for one element. */
type Wrap = "own" | "call" | "each";

const callNode = (flow: string) =>
	({
		id: "call",
		type: "call",
		position: { x: 0, y: 0 },
		flow,
		inputs: {},
	}) as const;

const callEachNode = (flow: string, ids = ["one"]): CallEachNode => ({
	id: "call",
	type: "call",
	position: { x: 0, y: 0 },
	flow,
	inputs: {},
	each: {
		source: { kind: "json", value: JSON.stringify(ids.map((id) => ({ id }))) },
		as: "item",
		branch: "shared",
		haltOn: ["halt"],
	},
});

function wrapped(
	wrap: Wrap,
	inner: Flow,
): { flow: Flow; flows: Record<string, Flow> } {
	if (wrap === "own") return { flow: inner, flows: {} };
	const called = flowOf({
		...inner,
		...(wrap === "each"
			? { inputs: [{ name: "item", type: "json", required: true }] }
			: {}),
	});
	const node = wrap === "call" ? callNode("inner") : callEachNode("inner");
	return {
		flow: flowOf([node], [], inner.policy ? { policy: inner.policy } : {}),
		flows: { inner: called },
	};
}

type Row = {
	cause: string;
	inner: () => Flow;
	options?: () => StartOptions;
	/** The stop time, from now; null: none. */
	stopIn?: number;
	code: Record<Wrap, RunEndReason>;
};

const withPolicy = (flow: Flow, policy: Policy): Flow => ({ ...flow, policy });

const ROWS: Row[] = [
	{
		cause: "an End that finished",
		inner: () => flowOf([end("done", "done", "All good.")]),
		code: { own: "finished", call: "finished", each: "finished" },
	},
	{
		cause: "a failed End",
		inner: () => flowOf([end("broke", "failed", "It broke.")]),
		// A failed element fails only its item: the loop is done.
		code: { own: "_OTHER", call: "_OTHER", each: "finished" },
	},
	{
		cause: "the step cap",
		inner: () =>
			withPolicy(
				flowOf(
					[command("a", "true"), command("b", "true")],
					[edge("e1", "a", "pass", "b")],
				),
				{ maxSteps: 1 },
			),
		code: {
			own: "guard.max_steps",
			call: "guard.max_steps",
			each: "guard.max_steps",
		},
	},
	{
		cause: "the stop time",
		inner: () => flowOf([command("a", "true")]),
		stopIn: -1,
		code: { own: "stop_time", call: "stop_time", each: "stop_time" },
	},
	{
		cause: "a person's stop",
		inner: () => flowOf([command("a", "true")]),
		options: () => ({ signal: AbortSignal.abort() }),
		code: {
			own: "stopped_by_person",
			call: "stopped_by_person",
			each: "stopped_by_person",
		},
	},
	{
		cause: "the turn limit",
		inner: () => flowOf([agent("worker", { maxTurns: 4 })]),
		options: () => ({
			harness: fakeHarness({
				steps: [{ type: "text", text: "Still working." }],
				outcome: { type: "finished", limit: "turns" },
			}),
		}),
		code: { own: "guard.turns", call: "guard.turns", each: "finished" },
	},
	{
		cause: "no activity",
		inner: () => withPolicy(flowOf([agent("worker")]), { idleMinutes: 1 }),
		options: () => ({
			harness: fakeHarness({
				steps: [
					{ type: "text", text: "Thinking." },
					{ type: "wait", ms: 30_000 },
				],
			}),
		}),
		code: { own: "guard.idle", call: "guard.idle", each: "finished" },
	},
	{
		cause: "the run budget",
		inner: () => withPolicy(flowOf([agent("worker")]), { budgetUsd: 1 }),
		options: () => ({
			harness: fakeHarness({
				model: "claude-sonnet-4-6",
				steps: [
					{ type: "text", text: "Working." },
					{ type: "usage", usage: { inputTokens: 1_000_000, outputTokens: 0 } },
					{ type: "wait", ms: 30_000 },
				],
			}),
		}),
		code: { own: "guard.budget", call: "guard.budget", each: "finished" },
	},
	{
		cause: "the budget before a step",
		inner: () =>
			withPolicy(
				flowOf(
					[agent("first"), agent("second")],
					[edge("e1", "first", "pass", "second")],
				),
				{ budgetUsd: 2 },
			),
		// The first step spends $3 and ends on its own: the second never starts.
		options: () => ({
			harness: fakeHarness({
				...reportingScript("pass"),
				model: "claude-sonnet-4-6",
				outcome: {
					type: "finished",
					usage: { inputTokens: 1_000_000, outputTokens: 0 },
				},
			}),
		}),
		code: { own: "guard.budget", call: "guard.budget", each: "guard.budget" },
	},
	{
		cause: "a usage limit past the stop time",
		inner: () => flowOf([agent("worker")]),
		options: () => ({
			harness: fakeHarness(usageLimitScript(now() + 30 * MINUTE)),
		}),
		stopIn: 25 * MINUTE,
		code: {
			own: "agent.usage_limit",
			call: "agent.usage_limit",
			each: "agent.usage_limit",
		},
	},
	{
		cause: "the network past its grace",
		inner: () =>
			withPolicy(flowOf([agent("worker")]), { networkGraceMinutes: 0.5 }),
		options: () => ({
			harness: fakeHarness({
				steps: [{ type: "text", text: "Starting." }],
				outcome: { type: "error", kind: "network", message: "offline" },
			}),
		}),
		code: { own: "agent.network", call: "agent.network", each: "finished" },
	},
];

describe("each cause gives its code", () => {
	for (const row of ROWS) {
		for (const wrap of ["own", "call", "each"] as const) {
			test(`${row.cause}, ${wrap === "own" ? "on its own" : wrap === "call" ? "in a Call" : "in a Call with each"}: ${row.code[wrap]}`, async () => {
				const { flow, flows } = wrapped(wrap, row.inner());
				const stopAt = row.stopIn === undefined ? null : now() + row.stopIn;
				expect(await codeOf(flow, { ...row.options?.(), flows }, stopAt)).toBe(
					row.code[wrap],
				);
			});
		}
	}
});

describe("the node whose step failed the run", () => {
	async function nodeOf(flow: Flow, options: StartOptions = {}) {
		const h = await startRun(sandbox, flow, options);
		const driven = await drive(h, { inputs: {}, stopAt: null });
		return endingOf(driven.outcome)?.node;
	}

	test("a step that failed, with no edge on its end: its node", async () => {
		expect(await nodeOf(flowOf([command("look", "exit 3")]))).toBe("look");
	});

	test("the words of the reason do not matter: a failed Agent names its node", async () => {
		const harness = fakeHarness(failingScript('Node "other" failed: boom'));
		expect(await nodeOf(flowOf([agent("worker")]), { harness })).toBe("worker");
	});

	test("a Call whose flow failed: the Call's node", async () => {
		const { flow, flows } = wrapped(
			"call",
			flowOf([command("look", "exit 3")]),
		);
		expect(await nodeOf(flow, { flows })).toBe("call");
	});

	test("no step failed: a finished run, a failed End, a stop or the step cap names none", async () => {
		expect(await nodeOf(flowOf([end("done", "done")]))).toBeUndefined();
		expect(await nodeOf(flowOf([end("broke", "failed")]))).toBeUndefined();
		expect(
			await nodeOf(flowOf([command("a", "true")]), {
				signal: AbortSignal.abort(),
			}),
		).toBeUndefined();
		const capped = withPolicy(
			flowOf(
				[command("a", "true"), command("b", "true")],
				[edge("e1", "a", "pass", "b")],
			),
			{ maxSteps: 1 },
		);
		expect(await nodeOf(capped)).toBeUndefined();
	});
});

describe("a stop between the elements of a Call with each", () => {
	/**
	 * A loop over two elements whose body is one Command. Right after the
	 * first element ends, `between` runs: it stops the run before the second.
	 */
	async function stopBetween(
		between: () => void,
		options: StartOptions & { stopAt?: number; wrapUp?: true } = {},
	) {
		const loop = callEachNode("inner", ["one", "two"]);
		const inner = flowOf([command("work", "true")], [], {
			inputs: [{ name: "item", type: "json", required: true }],
		});
		const flow = options.wrapUp
			? flowOf(
					[loop, command("wrap", "true")],
					[edge("e1", "call", "stopped", "wrap")],
				)
			: flowOf([loop]);
		const h = await startRun(sandbox, flow, {
			...options,
			flows: { inner },
		});
		const { log } = h.ctx;
		h.ctx.log = {
			...log,
			append: async (input, writes) => {
				const appended = await log.append(input, writes);
				if (input.type === "ItemEnded") between();
				return appended;
			},
		};
		const driven = await drive(h, {
			inputs: {},
			stopAt: options.stopAt ?? null,
		});
		const events = await h.events();
		return {
			code: endingOf(driven.outcome)?.endReason,
			items: payloads(events, "ItemStarted").map((p) => p.item.id),
			steps: payloads(events, "StepStarted").map((p) => p.nodeId),
		};
	}

	test("a person's stop gives stopped_by_person", async () => {
		const controller = new AbortController();
		const stopped = await stopBetween(() => controller.abort(), {
			signal: controller.signal,
		});
		expect(stopped.items).toEqual(["one"]);
		expect(stopped.code).toBe("stopped_by_person");
	});

	/** A clock that jumps past the stop time when `between` runs. */
	const lateClock = () => {
		const stopAt = now() + 60 * MINUTE;
		let late = false;
		return {
			stopAt,
			now: () => (late ? stopAt + 1 : now()),
			pass: () => {
				late = true;
			},
		};
	};

	test("the stop time gives stop_time", async () => {
		const clock = lateClock();
		const stopped = await stopBetween(clock.pass, {
			now: clock.now,
			stopAt: clock.stopAt,
		});
		expect(stopped.items).toEqual(["one"]);
		expect(stopped.code).toBe("stop_time");
	});

	test("the stop time with a stopped edge wraps the run up along it", async () => {
		const clock = lateClock();
		const stopped = await stopBetween(clock.pass, {
			now: clock.now,
			stopAt: clock.stopAt,
			wrapUp: true,
		});
		expect(stopped.items).toEqual(["one"]);
		expect(stopped.steps).toEqual(["call", "work", "wrap"]);
		expect(stopped.code).toBe("finished");
	});
});

describe("a step whose route the daemon lost", () => {
	let quiet: ReturnType<typeof spyOn>;
	beforeEach(() => {
		// A dying daemon logs what it could not write; that is the point here.
		quiet = spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => quiet.mockRestore());

	/**
	 * Runs the flow on a daemon that dies right after the step's `StepEnded`,
	 * before the commit after it. Recovery closes the run, and a resume
	 * routes the step from the log. Gives the run's log.
	 */
	async function afterLostCommit(
		flow: Flow,
		harness: StartOptions["harness"],
		options: {
			flows?: StartOptions["flows"];
			/** The `StepEnded` after which the daemon dies. Default: the first. */
			diesAfter?: (ended: EnginePayloads["StepEnded"]) => boolean;
		} = {},
	) {
		const h = await startRun(sandbox, flow, {
			harness,
			...(options.flows ? { flows: options.flows } : {}),
		});
		let ended = false;
		let dead = false;
		/** Every write after that `StepEnded` fails: the daemon died before the commit. */
		const point = (write: string, payload?: unknown) => {
			if (dead) throw new Error("the daemon died");
			if (
				write === "StepEnded" &&
				(options.diesAfter?.(payload as EnginePayloads["StepEnded"]) ?? true)
			) {
				ended = true;
				return;
			}
			if (ended) {
				dead = true;
				throw new Error("the daemon died");
			}
		};
		const dying = testRunner(h, {
			overdueSweepMs: 3_600_000,
			openThread: (row, deps) => {
				const thread = openThread(row, deps);
				const { ctx, saver } = thread;
				const { log } = ctx;
				ctx.log = {
					...log,
					append: async (input, writes) => {
						point(input.type, input.payload);
						return log.append(input, writes);
					},
				};
				const put = saver.put.bind(saver);
				const putWrites = saver.putWrites.bind(saver);
				saver.put = async (...args) => {
					point("checkpoint");
					return put(...args);
				};
				saver.putWrites = async (...args) => {
					point("writes");
					return putWrites(...args);
				};
				return thread;
			},
		});
		await dying.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		await waitFor(async () => (dead && !dying.isActive(h.runId) ? true : null));
		await dying.release();
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
		const next = testRunner(h, { overdueSweepMs: 3_600_000 });
		try {
			await next.take(h.runId, { kind: "resume", by: "daemon" });
			await waitFor(async () =>
				payloads(await h.events(), "RunEnded").length === 2 &&
				!next.isActive(h.runId)
					? true
					: null,
			);
			return await h.events();
		} finally {
			await next.release();
		}
	}

	test("a guard's end keeps its code when the commit after it never landed", async () => {
		const events = await afterLostCommit(
			flowOf([agent("worker", { maxTurns: 4 })]),
			fakeHarness({
				steps: [{ type: "text", text: "Still working." }],
				outcome: { type: "finished", limit: "turns" },
			}),
		);
		expect(payloads(events, "StepEnded")).toHaveLength(1);
		expect(payloads(events, "RunEnded").at(-1)).toMatchObject({
			status: "failed",
			endReason: "guard.turns",
			node: "worker",
		});
		expect(foldRun(events).end?.endReason).toBe("guard.turns");
	});

	test("an Agent that gave up on the network runs again when the commit after it never landed, and keeps the network code", async () => {
		// A step that ended `error` is cut short: the resume reopens it and
		// runs it again. The log has no code for its first end, so the code
		// comes from the run again, never from a guess at the first end.
		const events = await afterLostCommit(
			withPolicy(flowOf([agent("worker")]), { networkGraceMinutes: 0.5 }),
			fakeHarness({
				steps: [{ type: "text", text: "Starting." }],
				outcome: { type: "error", kind: "network", message: "offline" },
			}),
		);
		expect(payloads(events, "StepEnded").map((p) => p.outcome)).toEqual([
			"error",
			"error",
		]);
		expect(payloads(events, "StepReopened")).toHaveLength(1);
		expect(payloads(events, "RunEnded").at(-1)).toMatchObject({
			status: "failed",
			endReason: "agent.network",
		});
		expect(foldRun(events).end?.endReason).toBe("agent.network");
	});

	test("a Call whose Agent gave up on the network keeps the network code when the commit after the Call's end never landed", async () => {
		// The Call ends `fail` on its own: a resume routes it from the log.
		// The log keeps the cause of its end, so the resume reads the code.
		// The run's policy is the policy of its own flow.
		const events = await afterLostCommit(
			withPolicy(flowOf([callNode("inner")]), { networkGraceMinutes: 0.5 }),
			fakeHarness({
				steps: [{ type: "text", text: "Starting." }],
				outcome: { type: "error", kind: "network", message: "offline" },
			}),
			{
				flows: { inner: flowOf([agent("worker")]) },
				diesAfter: (ended) => ended.outcome === "fail",
			},
		);
		const ends = payloads(events, "StepEnded");
		expect(ends.map((p) => p.outcome)).toEqual(["error", "fail"]);
		expect(ends[1]?.endReason).toBe("agent.network");
		expect(payloads(events, "RunEnded").at(-1)).toMatchObject({
			status: "failed",
			endReason: "agent.network",
			node: "call",
		});
		expect(foldRun(events).end?.endReason).toBe("agent.network");
	});
});
