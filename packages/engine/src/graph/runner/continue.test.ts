import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import type { Flow } from "@nightshift/flows";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps, parseCalledFlows, parseRunFlow } from "../../read";
import {
	agent,
	command,
	edge,
	flowOf,
	payloads,
	startRun,
	testRunner,
} from "../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../testing/test-support";
import { DEFAULT_RESUME_PROMPT } from "../context/context";
import { closeOpenWork, openWork } from "./open-work";
import { DAEMON_RESUME_PROMPT } from "./reentry";
import { openThread } from "./thread";

/**
 * What a person says when they continue a run reaches the session that the
 * run page names, once. One Continue is enough, and nothing that ended runs
 * again. Each test walks an Agent through a past: how each call of it
 * ended, and what the person said then. A real runner stops, continues and
 * crashes at the log and checkpoint writes of the walk.
 */

const at = { x: 0, y: 0 };
const ask = (id = "worker", more: object = {}) =>
	agent(id, `Build ${id}`, { ask: "person", ...more });
const call = (more: object = {}) => ({
	id: "sub",
	type: "call" as const,
	position: at,
	flow: "child",
	inputs: {},
	...more,
});
const fanOut = (second: Parameters<typeof flowOf>[0]): Flow => {
	const other = (second as { id: string }[])[0]?.id as string;
	return flowOf(
		[
			command("start", "true"),
			ask(),
			...(second as never[]),
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("f1", "start", "pass", "worker"),
			edge("f2", "start", "pass", other),
			edge("j1", "worker", "pass", "joined"),
			edge("j2", other, "pass", "joined"),
		],
	);
};
const child = (more: object = {}) =>
	flowOf(
		[command("first", "echo x >> ran"), ask()],
		[edge("c", "first", "pass", "worker")],
		more,
	);
const { harness: _h, model: _m, ...climber } = ask();
const tier = { label: "s", model: "sonnet", harness: "claude-code" };
const FLOWS: Record<string, { flow: Flow; flows?: Record<string, Flow> }> = {
	"one Agent": { flow: flowOf([ask()]) },
	"a branch beside a finished one": { flow: fanOut([command("side", "true")]) },
	"two branches that ask": { flow: fanOut([ask("other")]) },
	"a called flow": { flow: flowOf([call()]), flows: { child: child() } },
	"a Call with each": {
		flow: flowOf([
			call({
				each: {
					source: { kind: "json", value: '[{"id":"a","title":"a"}]' },
					as: "item",
					branch: "shared",
				},
			}),
		]),
		flows: {
			child: child({
				inputs: [{ name: "item", type: "json", required: true }],
			}),
		},
	},
	"a cascade": {
		flow: flowOf([{ ...climber, cascade: [{ ...tier, tries: 2 }] } as never]),
	},
};

/**
 * How a call of the Agent ended. `stop`: it asked, and a person stopped the
 * run at the Gate. `drop`: it asked, and the stop came before the Gate was
 * in the checkpoint. `work`: a stop while it works. `answer`: it asked, and
 * a person answered. `sleep`: a usage limit that a person ends early.
 * `park`: it failed. `fail`: it reported `fail`, and no edge leaves it.
 */
type Past = "stop" | "drop" | "work" | "answer" | "sleep" | "park" | "fail";
/** Before which write of the last Continue, and what comes there. */
type Fault = { before: string; kind: "stop" | "crash" };

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

const scriptOf = (past: Past | undefined) => {
	switch (past) {
		case undefined:
			return reportingScript("pass", "Built it.");
		case "work":
			return { steps: [{ type: "wait" as const, ms: 60_000 }] };
		case "sleep":
			return usageLimitScript();
		case "park":
			return failingScript();
		case "fail":
			return reportingScript("fail", "No.");
		default:
			return reportingScript("needs-input", "Which one?");
	}
};

/** Walks the flow's Agents through `past`, and `fault` on the way out, to its end. */
async function walk(name: string, past: readonly Past[], fault?: Fault) {
	const { flow, flows } = FLOWS[name] as (typeof FLOWS)[string];
	const agents = name === "two branches that ask" ? 2 : 1;
	const calls: { who: string; prompt: string; session: string | undefined }[] =
		[];
	const owners = new Map<string, string>();
	const harness = fakeHarness((input) => {
		const session = input.resumeSessionId;
		const who = session
			? (owners.get(session) as string)
			: (input.prompt.split(" ")[1] as string);
		if (!session) owners.set(`fake-session-${owners.size + 1}`, who);
		const mine = calls.filter((c) => c.who === who).length;
		calls.push({ who, prompt: input.prompt, session });
		return scriptOf(past[mine]);
	});
	const h = await startRun(sandbox, flow, {
		harness,
		...(flows ? { flows } : {}),
	});
	let armed: ((write: string) => Promise<Fault["kind"] | null>) | null = null;
	let died = false;
	function daemon() {
		let dead = false;
		const point = async (write: string) => {
			if (dead) throw new Error("the daemon died");
			const hit = await armed?.(write);
			if (!hit) return;
			armed = null;
			if (hit === "crash") {
				dead = true;
				died = true;
				throw new Error("the daemon died");
			}
			await mine.take(h.runId, { kind: "stop", by: "person" });
		};
		const mine = testRunner(h, {
			overdueSweepMs: 3_600_000,
			openThread: (row, deps) => {
				const thread = openThread(row, deps);
				const { ctx, saver } = thread;
				const { log } = ctx;
				ctx.log = {
					...log,
					append: async (input, writes) => {
						await point(input.type);
						return log.append(input, writes);
					},
				};
				const put = saver.put.bind(saver);
				const putWrites = saver.putWrites.bind(saver);
				saver.put = async (...args) => {
					await point("checkpoint");
					return put(...args);
				};
				saver.putWrites = async (...args) => {
					await point("writes");
					return putWrites(...args);
				};
				return thread;
			},
		});
		return mine;
	}
	let runner = daemon();
	const state = async () => foldRun(await h.events());
	/** The run once it is still: no drive holds it, or its last call hangs. */
	const still = () =>
		waitFor<string>(async () => {
			const run = await state();
			if (!runner.isActive(h.runId)) {
				if (died) return "dead";
				return run.status === "running" ? null : run.status;
			}
			const open = deriveSteps(run).flatMap((s) =>
				s.nodeType === "agent" && s.endedAt === null ? [s.sessions.at(-1)] : [],
			);
			return past[calls.length / agents - 1] === "work" &&
				open.length === agents &&
				open.every((s) => s?.harnessSessionId && !s.ending)
				? "working"
				: null;
		});
	/** Arms the stop that drops the question call `i` asks. */
	const armDrop = (i: number) => {
		const gates =
			agents *
			past.slice(0, i + 1).filter((p) => /stop|drop|answer/.test(p)).length;
		let writes = 0;
		armed = async (write) =>
			(write === "checkpoint" || write === "writes") &&
			payloads(await h.events(), "GateOpened").length >= gates &&
			++writes === 2
				? "stop"
				: null;
	};
	const armFault = ({ before, kind }: Fault) => {
		let ended = false;
		armed = async (write) => {
			if (before !== "the commit of the end") {
				return write === before ? kind : null;
			}
			if (write === "StepEnded") ended = true;
			return ended && write !== "StepEnded" ? kind : null;
		};
	};
	if (past[0] === "drop") armDrop(0);
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	for (const [i, how] of past.entries()) {
		await still();
		const next = past[i + 1];
		if (how === "stop" || how === "work") {
			await runner.take(h.runId, { kind: "stop", by: "person" });
			await still();
		}
		if (next === "drop") armDrop(i + 1);
		else if (!next && fault) armFault(fault);
		const gate = (await state()).gate;
		await runner.take(
			h.runId,
			how === "answer" && gate
				? {
						kind: "answer",
						stepId: gate.stepId,
						choice: "answer",
						note: `P${i}.`,
					}
				: { kind: "resume", by: "person", prompt: `P${i}.` },
		);
	}
	const end = await still();
	if (end === "dead") {
		await runner.release();
		died = false;
		runner = daemon();
		const open = openWork(await state(), { kind: "interrupted" });
		expect(open.endsRun).toBe(true);
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
		await runner.take(h.runId, { kind: "resume", by: "daemon" });
	} else if (fault?.kind === "stop") {
		expect(end).toBe("stopped");
		await runner.take(h.runId, {
			kind: "resume",
			by: "person",
			prompt: "And this.",
		});
	}
	expect(await still()).toBe("finished");
	await runner.release();
	// No step of an Agent or a Command ran a second visit.
	const steps = deriveSteps(await state());
	expect(steps.filter((s) => s.visit > 1)).toEqual([]);
	return { calls: calls.map((c) => [c.who, c.prompt] as const), steps };
}

/** The prompts that `past` sends, one per call after the first. */
const told = (past: readonly Past[]) => [
	"Build worker",
	...past.map((_, i) => `P${i}.`),
];

const PASTS: [string, Past[]][] = [
	["one Agent", ["stop", "work", "stop"]],
	["one Agent", ["drop", "drop"]],
	["one Agent", ["sleep", "drop", "work"]],
	["one Agent", ["park", "drop"]],
	// The run's end names the node: `waitingSession` reads those words.
	["one Agent", ["fail", "fail"]],
	["one Agent", ["answer", "drop", "answer"]],
	["a branch beside a finished one", ["stop", "drop", "work"]],
	["a called flow", ["stop", "drop", "work"]],
	["a Call with each", ["drop", "stop"]],
	["a cascade", ["stop", "drop", "work"]],
];
for (const [name, past] of PASTS) {
	test(`${name}, ${past.join(" then ")}: one Continue each, and each prompt once`, async () => {
		const { calls } = await walk(name, past);
		expect(calls.map(([, prompt]) => prompt)).toEqual(told(past));
	});
}

test("two branches that ask: the prompt goes to the Agent that started last", async () => {
	const past: Past[] = ["stop", "drop", "stop"];
	const { calls, steps } = await walk("two branches that ask", past);
	// The Agent whose step started last in the log, not the one the harness
	// was called for last: two branches call it in either order.
	const last = steps
		.filter((s) => s.nodeType === "agent")
		.reduce((a, b) => (b.startSeq > a.startSeq ? b : a)).nodeId;
	const of = (mine: boolean) =>
		calls.filter(([who]) => (who === last) === mine).map(([, p]) => p);
	expect(of(true).slice(1)).toEqual(["P0.", "P1.", "P2."]);
	expect(of(false).slice(1)).toEqual(Array(3).fill(DEFAULT_RESUME_PROMPT));
});

const crash = (before: string): Fault => ({ before, kind: "crash" });
const stop = (before: string): Fault => ({ before, kind: "stop" });
const AND = "\n\nAnd this.";
const DIED = `\n\n${DAEMON_RESUME_PROMPT}`;
/** The fault, and the calls from the last Continue on. `P` is what the person said last. */
const FAULTS: [Fault, (P: string) => string[]][] = [
	[crash("checkpoint"), (P) => [P + DIED]],
	[crash("StepReopened"), (P) => [P + DIED]],
	[crash("SessionStarted"), (P) => [P + DIED]],
	// The log cannot tell whether the session got it: it goes again.
	[crash("HarnessSessionAssigned"), (P) => [P, P + DIED]],
	[crash("SessionEnded"), (P) => [P, DAEMON_RESUME_PROMPT]],
	[crash("the commit of the end"), (P) => [P]],
	[stop("checkpoint"), (P) => [P + AND]],
	[stop("StepReopened"), (P) => [P + AND]],
	[stop("SessionStarted"), (P) => [P + AND]],
	[stop("HarnessSessionAssigned"), (P) => [P, P + AND]],
];
for (const [fault, expected] of FAULTS) {
	for (const past of [["stop"], ["park", "drop"]] as Past[][]) {
		test(`after ${past.join(" then ")}, a ${fault.kind} before ${fault.before}: the prompt is not lost, and no end runs again`, async () => {
			const { calls } = await walk("one Agent", past, fault);
			expect(calls.map(([, prompt]) => prompt)).toEqual([
				...told(past).slice(0, -1),
				...expected(`P${past.length - 1}.`),
			]);
		});
	}
}
