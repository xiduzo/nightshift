import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { Command } from "@langchain/langgraph";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { FlowEdge, JoinNode } from "@nightshift/flows";
import type { FlowInput } from "@nightshift/flows/testing";
import { getRunRow } from "../log/run-row";
import { deriveOpenGate, deriveRunState, deriveSteps } from "../read";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
	testRunner,
} from "../testing/graph";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import { OUTRUN_ERROR } from "./branches";
import { heldOf } from "./state";

/**
 * Parallel branches and the Join (`branches.ts`, `nodes/join.ts`): a
 * fan-out runs its branches in one super-step, the Join goes on once its
 * rule holds and holds each branch's data, a `first` Join stops the other
 * branches, a failing branch parks the run and a resume runs that branch
 * again. The crash at every write of a fan-out is in `crash.test.ts`.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const joinNode = (id: string, wait: JoinNode["wait"] = "all"): JoinNode => ({
	id,
	type: "join",
	position: { x: 0, y: 0 },
	wait,
});

const findings = {
	type: "object",
	properties: { findings: { type: "array", items: { type: "string" } } },
};

/** start → [review (Agent), check (Command)] → joined → after. */
function fanOut(
	branches: FlowInput["nodes"],
	wait: JoinNode["wait"] = "all",
	extra: FlowEdge[] = [],
) {
	const ids = branches.map((n) => n.id);
	return flowOf(
		[
			command("start", "true"),
			...branches,
			joinNode("joined", wait),
			command("after", "true"),
		],
		[
			...ids.map((id) => edge(`start-${id}`, "start", "pass", id)),
			...ids.map((id) => edge(`${id}-joined`, id, "pass", "joined")),
			edge("joined-after", "joined", "done", "after"),
			...extra,
		],
	);
}

const ended = (h: Harness) =>
	h
		.events()
		.then((events) => deriveSteps(events).map((s) => [s.nodeId, s.outcome]));

describe("a fan-out into a Join that waits for all", () => {
	test("an Agent and a Command run at once; the Join holds each branch's data and the run goes on", async () => {
		const harness = fakeHarness({
			...reportingScript("pass", "Reviewed.", { findings: ["typo"] }),
			delayMs: 150,
		});
		const h = await startRun(
			sandbox,
			fanOut([
				agent("review", "Review it", { output: findings }),
				command("check", "sleep 0.15; echo '{\"ok\":true}'", {
					output: "json",
				}),
			]),
			{ harness },
		);
		const began = Date.now();
		const driven = await drive(h, { inputs: {} });
		const took = Date.now() - began;

		expect(driven.outcome.kind).toBe("ended");
		expect(driven.state.ended).toMatchObject({ nodeId: "after" });
		// Side by side: both steps started before either ended.
		const events = await h.events();
		const steps = deriveSteps(events);
		const seqOf = (type: string, nodeId: string) => {
			const step = steps.find((s) => s.nodeId === nodeId);
			return events.find((e) => e.type === type && e.stepId === step?.id)
				?.seq as number;
		};
		expect(seqOf("StepStarted", "review")).toBeLessThan(
			seqOf("StepEnded", "check"),
		);
		expect(seqOf("StepStarted", "check")).toBeLessThan(
			seqOf("StepEnded", "review"),
		);
		expect(took).toBeLessThan(2_000);

		expect(
			payloads(events, "EdgeTaken")
				.map((e) => e.edgeId)
				.sort(),
		).toEqual(
			[
				"check-joined",
				"joined-after",
				"review-joined",
				"start-check",
				"start-review",
			].sort(),
		);
		const joined = steps.find((s) => s.nodeId === "joined");
		expect(joined?.outcome).toBe("done");
		expect(driven.state.nodes.joined).toEqual({
			outcome: "done",
			visit: 1,
			data: expect.objectContaining({
				review: { findings: ["typo"] },
				check: { ok: true },
			}),
		});
		expect(Object.keys(driven.state.nodes.joined?.data as object)).toHaveLength(
			2,
		);
		// One Join step, and the round is closed.
		expect(steps.filter((s) => s.nodeId === "joined")).toHaveLength(1);
		expect(driven.state.joins.joined).toMatchObject({
			round: 1,
			closed: true,
		});
	});

	test("branches of different lengths: the Join waits for the longer one", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("start", "true"),
					command("a1", "true"),
					command("a2", "true"),
					command("b", "true"),
					joinNode("joined"),
				],
				[
					edge("s-a1", "start", "pass", "a1"),
					edge("s-b", "start", "pass", "b"),
					edge("a1-a2", "a1", "pass", "a2"),
					edge("a2-j", "a2", "pass", "joined"),
					edge("b-j", "b", "pass", "joined"),
				],
			),
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({ nodeId: "joined" });
		expect(
			Object.keys(driven.state.nodes.joined?.data as object).sort(),
		).toEqual(["a2", "b"]);
		const steps = (await ended(h)).filter(([id]) => id === "joined");
		expect(steps).toEqual([["joined", "done"]]);
	});
});

describe("variables set on parallel branches", () => {
	test("two branches set the same variable in one super-step: the writes merge, the later wins, the run goes on", async () => {
		const base = fanOut([
			command("left", "true", {
				set: [
					{ variable: "who", value: "left" },
					{ variable: "left_ran", value: "yes" },
				],
			}),
			command("right", "true", {
				set: [
					{ variable: "who", value: "right" },
					{ variable: "right_ran", value: "yes" },
				],
			}),
		]);
		const h = await startRun(sandbox, {
			...base,
			variables: [
				{ name: "who", type: "text" },
				{ name: "left_ran", type: "text" },
				{ name: "right_ran", type: "text" },
			],
		});
		const driven = await drive(h, { inputs: {} });
		expect(driven.outcome.kind).toBe("ended");
		expect(driven.state.vars).toMatchObject({
			left_ran: "yes",
			right_ran: "yes",
		});
		expect(["left", "right"]).toContain(driven.state.vars.who as string);
	});
});

describe("a Join that waits for the first", () => {
	test("the first branch goes on; the step that still runs in the other branch stops", async () => {
		const h = await startRun(
			sandbox,
			fanOut(
				[
					command("fast", 'echo \'{"who":"fast"}\'', { output: "json" }),
					command("slow", "sleep 20"),
				],
				"first",
			),
		);
		const began = Date.now();
		const driven = await drive(h, { inputs: {} });
		expect(Date.now() - began).toBeLessThan(10_000);
		expect(driven.state.ended).toMatchObject({ nodeId: "after" });
		expect(driven.state.nodes.joined?.data).toEqual({ fast: { who: "fast" } });
		const events = await h.events();
		const slow = deriveSteps(events).find((s) => s.nodeId === "slow");
		expect(slow?.outcome).toBe("stopped");
		expect(
			payloads(events, "StepEnded").find(
				(e) => e.outcome === "stopped" && e.error === OUTRUN_ERROR,
			),
		).toBeDefined();
		// The stopped branch took no edge and parked nothing.
		expect(payloads(events, "EdgeTaken").some((e) => e.from === "slow")).toBe(
			false,
		);
		expect(heldOf(driven.state.pending)).toEqual({});
		expect(deriveRunState(events).status).toBe("running");
	});
});

describe("a failing branch", () => {
	test("parks the run as failed; the other branch's step ends; a resume runs that branch again and the Join goes on", async () => {
		const flag = joinPath(sandbox.repoPath, "fixed");
		const h = await startRun(
			sandbox,
			fanOut([
				command("good", "echo '{\"n\":1}'", { output: "json" }),
				command("bad", `test -f ${flag}`),
			]),
		);
		const first = await drive(h, { inputs: {} });
		expect(first.outcome).toMatchObject({
			kind: "parked",
			parked: { kind: "parked", nodeId: "bad", status: "failed" },
		});
		expect(first.parked).toHaveLength(1);
		const before = await ended(h);
		expect(before).toContainEqual(["good", "pass"]);
		expect(before).toContainEqual(["bad", "fail"]);
		expect(before.some(([id]) => id === "joined")).toBe(false);
		// The good branch arrived and waits in the round.
		expect(first.state.joins.joined?.arrived.map((a) => a.from)).toEqual([
			"good",
		]);

		writeFileSync(flag, "");
		expect(existsSync(flag)).toBe(true);
		const second = await drive(
			h,
			new Command({ resume: { kind: "resume" } }),
			h.graph(),
		);
		expect(second.outcome.kind).toBe("ended");
		const after = await ended(h);
		// The good branch ran once; the bad one again.
		expect(after.filter(([id]) => id === "good")).toEqual([["good", "pass"]]);
		expect(after.filter(([id]) => id === "bad")).toEqual([
			["bad", "fail"],
			["bad", "pass"],
		]);
		expect(after).toContainEqual(["joined", "done"]);
		expect(second.state.ended).toMatchObject({ nodeId: "after" });
	});

	test("two branches that fail at once park the run once; one resume runs both again", async () => {
		const flag = joinPath(sandbox.repoPath, "fixed-both");
		const h = await startRun(
			sandbox,
			fanOut([
				command("one", `test -f ${flag}`),
				command("two", `test -f ${flag}`),
			]),
		);
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			await settle(runner, h, "failed");
			const thread = await h.thread.state();
			expect(thread).toMatchObject({ kind: "interrupted" });
			if (thread.kind === "interrupted") {
				expect(thread.interrupts.map((i) => i.value.nodeId).sort()).toEqual([
					"one",
					"two",
				]);
			}
			writeFileSync(flag, "");
			await runner.take(h.runId, { kind: "resume", by: "person" });
			await settle(runner, h, "finished");
			const steps = await ended(h);
			expect(steps.filter(([, o]) => o === "pass").map(([id]) => id)).toEqual(
				expect.arrayContaining(["start", "one", "two", "after"]),
			);
			expect(steps).toContainEqual(["joined", "done"]);
		} finally {
			await runner.release();
		}
	});
});

describe("an Agent that asks a person, on each of two branches", () => {
	test("both ask at once; each answer goes on in its own session, and the Join goes on after both", async () => {
		// Each session asks first, then passes once it has the answer.
		const harness = fakeHarness((input) =>
			input.resumeSessionId
				? reportingScript("pass", `Done with ${input.prompt}`)
				: reportingScript("needs-input", "Which one?"),
		);
		const h = await startRun(
			sandbox,
			fanOut([
				agent("left", "Do the left part", { ask: "person" }),
				agent("right", "Do the right part", { ask: "person" }),
			]),
			{ harness },
		);
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		const openGates = async () =>
			deriveSteps(await h.events()).filter(
				(s) => s.gate !== null && s.endedAt === null,
			);
		const answer = async (nodeId: string, note: string) => {
			const step = (await openGates()).find((s) => s.nodeId === nodeId);
			await runner.take(h.runId, {
				kind: "answer",
				stepId: step?.id ?? "",
				choice: "answer",
				note,
			});
		};
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			await settle(runner, h, "waiting");
			expect((await openGates()).map((s) => s.nodeId).sort()).toEqual([
				"left",
				"right",
			]);
			await answer("right", "the red one");
			await settle(runner, h, "waiting");
			// The answer is kept; the right session goes on once the left
			// Gate no longer holds the walk (branches pause while one waits).
			expect(harness.calls.filter((call) => call.resumeSessionId)).toEqual([]);
			await answer("left", "the blue one");
			await settle(runner, h, "finished");
			const resumed = harness.calls
				.filter((call) => call.resumeSessionId)
				.map((call) => call.prompt)
				.sort();
			expect(resumed).toEqual(["the blue one", "the red one"]);
			const steps = await ended(h);
			expect(steps).toContainEqual(["left", "pass"]);
			expect(steps).toContainEqual(["right", "pass"]);
			expect(steps).toContainEqual(["joined", "done"]);
		} finally {
			await runner.release();
		}
	});
});

describe("a Gate on a branch", () => {
	test("two branches each hold an open Gate: each answer goes to its own Gate, and the Join goes on after both", async () => {
		const gate = (id: string) => ({
			id,
			type: "decision" as const,
			position: { x: 0, y: 0 },
			prompt: `${id}?`,
			by: "person" as const,
			options: [{ name: "pass" }],
		});
		const h = await startRun(sandbox, fanOut([gate("left"), gate("right")]));
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		const openGates = async () =>
			deriveSteps(await h.events()).filter(
				(s) => s.gate !== null && s.endedAt === null,
			);
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			await settle(runner, h, "waiting");
			expect((await openGates()).map((s) => s.nodeId).sort()).toEqual([
				"left",
				"right",
			]);
			const thread = await h.thread.state();
			expect(thread.kind === "interrupted" && thread.interrupts.length).toBe(2);

			const left = (await openGates()).find((s) => s.nodeId === "left");
			await runner.take(h.runId, {
				kind: "answer",
				stepId: left?.id ?? "",
				choice: "pass",
				note: "",
			});
			await settle(runner, h, "waiting");
			expect((await openGates()).map((s) => s.nodeId)).toEqual(["right"]);
			expect(await ended(h)).not.toContainEqual(["joined", "done"]);

			const right = (await openGates())[0];
			await runner.take(h.runId, {
				kind: "answer",
				stepId: right?.id ?? "",
				choice: "pass",
				note: "",
			});
			await settle(runner, h, "finished");
			const steps = await ended(h);
			expect(steps).toContainEqual(["left", "pass"]);
			expect(steps).toContainEqual(["right", "pass"]);
			expect(steps).toContainEqual(["joined", "done"]);
		} finally {
			await runner.release();
		}
	});

	test("the other branch's step ends first; an answer while it runs is refused; then the answer goes on to the Join", async () => {
		const h = await startRun(
			sandbox,
			fanOut([
				{
					id: "ask",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "Go?",
					by: "person",
					options: [{ name: "pass" }],
				},
				command("work", "sleep 1"),
			]),
		);
		const runner = testRunner(h, { overdueSweepMs: 3_600_000 });
		try {
			await runner.take(h.runId, {
				kind: "start",
				prepare: async () => ({
					row: await getRunRow(sandbox.db, h.runId),
					inputs: {},
					stopAt: null,
				}),
			});
			const gate = await waitFor(
				async () => deriveOpenGate(await h.events()) ?? false,
				{ label: "the Gate to open" },
			);
			if (runner.isActive(h.runId)) {
				await expect(
					runner.take(h.runId, {
						kind: "answer",
						stepId: gate.stepId,
						choice: "pass",
						note: "",
					}),
				).rejects.toThrow("Another branch of this run is still working");
			}
			await settle(runner, h, "waiting");
			await runner.take(h.runId, {
				kind: "answer",
				stepId: gate.stepId,
				choice: "pass",
				note: "",
			});
			await settle(runner, h, "finished");
			expect(await ended(h)).toContainEqual(["joined", "done"]);
		} finally {
			await runner.release();
		}
	});
});

/** Waits until no drive holds the run and its status is `status`. */
async function settle(
	runner: ReturnType<typeof testRunner>,
	h: Harness,
	status: string,
): Promise<void> {
	await waitFor(
		async () =>
			!runner.isActive(h.runId) &&
			deriveRunState(await h.events()).status === status,
		{ label: `the run to be ${status}`, timeoutMs: 20_000 },
	);
}
