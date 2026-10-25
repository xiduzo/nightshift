import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { agentSession } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	scriptedHarness,
	waitFor,
} from "../testing/test-support";
import { RunState } from "./state";
import {
	type DriveOutcome,
	driveGraph,
	endingOf,
	inputOf,
	type RunGraph,
} from "./thread";

/**
 * The Thread module: the stream loop the runner and the node tests share
 * (`driveGraph`), how a drive's outcome maps to `RunEnded` (`endingOf`),
 * the fence around a drive, and where a thread is (`state`).
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const checkpoints = async (h: Harness): Promise<number> => {
	const result = await sandbox.db.$client.execute({
		sql: "SELECT count(*) AS n FROM lg_checkpoint WHERE thread_id = ?",
		args: [h.runId],
	});
	return Number(result.rows[0]?.n);
};

describe("driveGraph", () => {
	test("a walk of more than 25 super-steps ends: the step cap is the walk's own", async () => {
		const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
		const h = await startRun(
			sandbox,
			flowOf(
				ids.map((id) => command(id, "true")),
				ids
					.slice(1)
					.map((id, i) => edge(`e${i}`, ids[i] as string, "pass", id)),
			),
		);
		const { outcome } = await drive(
			h,
			inputOf({ kind: "start", inputs: {}, stopAt: null }),
		);
		expect(outcome).toEqual({
			kind: "ended",
			ended: {
				status: "finished",
				nodeId: "n29",
				outcome: "pass",
				reason: null,
			},
		});
		expect(endingOf(outcome)).toEqual({ status: "finished", reason: null });
	});

	test("a step that fails in a Call body parks the run once: only the root's interrupt counts", async () => {
		const body = flowOf([command("bad", "exit 3")]);
		const h = await startRun(
			sandbox,
			flowOf([
				{
					id: "call",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "body",
					inputs: {},
				},
			]),
			{ flows: { body } },
		);
		const { outcome, parked } = await drive(h, { inputs: {} });
		expect(outcome.kind).toBe("parked");
		expect(parked).toHaveLength(1);
		expect(parked[0]).toMatchObject({ kind: "parked", status: "failed" });
		expect(endingOf(outcome)?.status).toBe("failed");
		expect(await h.thread.state()).toMatchObject({
			kind: "interrupted",
			value: { kind: "parked", status: "failed" },
		});
	});

	test("a fence closed mid-drive: the drive is fenced and writes no event and no checkpoint after", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[command("slow", "sleep 0.3"), command("after", "true")],
				[edge("e1", "slow", "pass", "after")],
			),
		);
		const driving = drive(h, { inputs: {} });
		await waitFor(async () => (await h.types()).includes("StepStarted"));
		const types = await h.types();
		const written = await checkpoints(h);
		await h.thread.fence.close();
		const { outcome } = await driving;
		expect(outcome).toEqual({ kind: "fenced" });
		expect(endingOf(outcome)).toBeNull();
		expect(await h.types()).toEqual(types);
		expect(await checkpoints(h)).toBe(written);
	});

	test("a fence closed while a step opens: no session row is written without its SessionStarted", async () => {
		const scripted = scriptedHarness();
		const h = await startRun(sandbox, flowOf([agent("worker", "Build it")]), {
			harness: scripted.harness,
		});
		// The drive waits in the step's opening, after StepStarted; the stop
		// comes then, and the step goes on to start its session.
		const opening = Promise.withResolvers<void>();
		let waiting = false;
		const recorder = h.ctx.recorder;
		h.ctx.recorder = async (stepId) => {
			waiting = true;
			await opening.promise;
			return recorder(stepId);
		};
		const controller = new AbortController();
		const driving = h.thread.drive({ inputs: {} }, { controller });
		await waitFor(() => waiting);
		await h.thread.fence.close();
		controller.abort();
		opening.resolve();
		expect(await driving).toEqual({ kind: "fenced" });

		const rows = await sandbox.db
			.select()
			.from(agentSession)
			.where(eq(agentSession.runId, h.runId));
		const started = (await h.events()).filter(
			(e) => e.type === "SessionStarted",
		);
		expect(rows.map((r) => r.id)).toEqual(started.map((e) => e.sessionId));
		expect(rows).toEqual([]);
		expect(scripted.sessions).toEqual([]);
	});

	test("a graph that stops without an end or an interrupt throws", async () => {
		const graph = new StateGraph(RunState)
			.addNode("noop", () => ({}))
			.addEdge(START, "noop")
			.addEdge("noop", END)
			.compile({ checkpointer: new MemorySaver() }) as unknown as RunGraph;
		const h = await startRun(sandbox, flowOf([command("a", "true")]));
		await expect(
			driveGraph(graph, h.runId, { inputs: {} }, { fence: h.thread.fence }),
		).rejects.toThrow("The graph stopped without an end or an interrupt.");
	});
});

describe("endingOf", () => {
	const at = { stepId: "s1", nodeId: "a" };
	const cases: [string, DriveOutcome, ReturnType<typeof endingOf>][] = [
		[
			"ended",
			{
				kind: "ended",
				ended: {
					status: "finished",
					nodeId: "a",
					outcome: "pass",
					reason: "done",
				},
			},
			{ status: "finished", reason: "done" },
		],
		[
			"a stopped step",
			{
				kind: "parked",
				parked: { kind: "parked", ...at, status: "stopped", reason: null },
				interrupts: [],
			},
			{ status: "stopped", reason: null },
		],
		[
			"a failed step",
			{
				kind: "parked",
				parked: { kind: "parked", ...at, status: "failed", reason: "boom" },
				interrupts: [],
			},
			{ status: "failed", reason: "boom" },
		],
		[
			"a wait",
			{
				kind: "parked",
				parked: {
					kind: "wait",
					...at,
					reason: "signal",
					until: null,
					message: "",
				},
				interrupts: [],
			},
			null,
		],
		[
			"an open Gate",
			{
				kind: "parked",
				parked: { kind: "gate", ...at, question: "Ship?", choices: [] },
				interrupts: [],
			},
			null,
		],
		["a fenced drive", { kind: "fenced" }, null],
	];
	for (const [name, outcome, ending] of cases) {
		test(name, () => {
			expect(endingOf(outcome)).toEqual(ending);
		});
	}
});

describe("the Thread", () => {
	test("is fresh before its first drive, ended after, and a drive's controller is the signal", async () => {
		const h = await startRun(sandbox, flowOf([command("a", "true")]));
		expect(await h.thread.state()).toEqual({ kind: "fresh" });
		expect((await h.thread.snapshot()).hasCheckpoint).toBe(false);

		const controller = new AbortController();
		const outcome = await h.thread.drive(
			inputOf({ kind: "start", inputs: {}, stopAt: null }),
			{ controller },
		);
		expect(outcome.kind).toBe("ended");
		expect(h.thread.ctx.signal()).toBe(controller.signal);
		expect(await h.thread.state()).toMatchObject({
			kind: "ended",
			ended: { status: "finished", nodeId: "a" },
		});
		const snapshot = await h.thread.snapshot();
		expect(snapshot).toMatchObject({ hasCheckpoint: true, hasTasks: false });

		await h.thread.prune();
		expect(await checkpoints(h)).toBe(1);
	});
});
