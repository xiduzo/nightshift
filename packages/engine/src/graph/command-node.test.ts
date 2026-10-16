import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { step } from "@nightshift/db/schema/nightshift";
import { templateEnvName } from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { deriveSteps } from "../events";
import { createSandbox, type Sandbox } from "../test-support";
import { readTranscriptFile } from "../transcripts";
import { drive, flowOf, payloads, startRun } from "./test-support";

/**
 * The Command node on the compiled graph, with a real shell, run log and
 * MemorySaver. The event log, the transcript and the log file are compared
 * with what the engine writes today (engine.test.ts "a command step").
 */

const command = (
	id: string,
	cmd: string,
	extra: Record<string, unknown> = {},
) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: cmd,
	...extra,
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the Command node", () => {
	test("exit 0 passes: the log, the transcript, the log file and the state are as the engine writes them", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "task" }],
				start: "ship",
				nodes: [command("ship", 'echo "shipped: {{task}}"')],
				edges: [],
			}),
		);
		const { parked, events, state, next } = await drive(h, {
			inputs: { task: "the thing" },
		});
		expect(parked).toEqual([]);
		expect(next).toEqual([]);
		expect(await h.types()).toEqual(["RunStarted", "StepStarted", "StepEnded"]);

		const logged = await h.events();
		const [derived] = deriveSteps(logged);
		const stepId = derived?.id as string;
		const logPath = join(sandbox.dataDir, "logs", h.runId, `${stepId}.log`);
		expect(payloads(logged, "StepStarted")).toEqual([
			{
				nodeId: "ship",
				nodeType: "command",
				visit: 1,
				transcriptPath: join(
					sandbox.dataDir,
					"transcripts",
					h.runId,
					`${stepId}.ndjson`,
				),
				logPath,
				scope: null,
			},
		]);
		expect(payloads(logged, "StepEnded")).toEqual([
			{
				outcome: "pass",
				outputs: {
					outcome: "pass",
					exit_code: 0,
					log_tail: "shipped: the thing",
					visit: 1,
				},
				error: null,
			},
		]);

		// The value went in as an environment variable, never as shell text.
		const env = templateEnvName("task", []);
		const transcript = await readTranscriptFile(
			derived?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event)).toEqual([
			{ type: "command-start", command: `echo "shipped: \${${env}}"` },
			{
				type: "command-output",
				stream: "stdout",
				text: "shipped: the thing\n",
			},
			{ type: "command-exit", exitCode: 0 },
		]);
		expect(transcript.every((e) => e.sessionId === null)).toBe(true);
		expect(transcript.map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(await readFile(logPath, "utf8")).toBe("shipped: the thing\n");

		// The row, the state and the custom stream.
		const [row] = await sandbox.db
			.select()
			.from(step)
			.where(eq(step.runId, h.runId));
		expect(row).toMatchObject({ id: stepId, nodeType: "command", visit: 1 });
		expect(state.nodes.ship).toEqual({
			outcome: "pass",
			exit_code: 0,
			log_tail: "shipped: the thing",
			visit: 1,
		});
		expect(state.visits).toEqual({ ship: 1 });
		expect(state.pending).toBeNull();
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "ship",
			outcome: "pass",
			reason: null,
		});
		expect(events.map((e) => e.type)).toEqual([
			"step-started",
			"transcript",
			"transcript",
			"transcript",
			"step-ended",
		]);
		expect(events.at(-1)).toEqual({
			type: "step-ended",
			stepId,
			nodeId: "ship",
			visit: 1,
			outcome: "pass",
		});
	});

	test("a non-zero exit fails with the exit code and the tail of both streams, and takes the fail edge", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "check",
				nodes: [
					command("check", "echo attempt; echo oops >&2; exit 3"),
					command("fixed", "true"),
				],
				edges: [{ id: "e1", from: "check", outcome: "fail", to: "fixed" }],
			}),
		);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("fixed");

		const logged = await h.events();
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				exit_code: 3,
				log_tail: "attempt\noops",
				visit: 1,
			},
			error: null,
		});
		expect(payloads(logged, "EdgeTaken")).toEqual([
			{
				edgeId: "e1",
				from: "check",
				to: "fixed",
				outcome: "fail",
				scope: null,
			},
		]);
		const [check] = deriveSteps(logged);
		const transcript = await readTranscriptFile(
			check?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event)).toEqual([
			{ type: "command-start", command: "echo attempt; echo oops >&2; exit 3" },
			{ type: "command-output", stream: "stdout", text: "attempt\n" },
			{ type: "command-output", stream: "stderr", text: "oops\n" },
			{ type: "command-exit", exitCode: 3 },
		]);
	});

	test("a failure without an edge parks the run as failed, with today's reason", async () => {
		const h = await startRun(
			sandbox,
			flowOf({ start: "check", nodes: [command("check", "false")], edges: [] }),
		);
		const { parked, next, state } = await drive(h, { inputs: {} });
		const [check] = deriveSteps(await h.events());
		expect(next).toEqual(["park__check"]);
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: check?.id as string,
				nodeId: "check",
				status: "failed",
				reason:
					'Node "check" ended with "fail" and no edge leaves it on that outcome.',
			},
		]);
		expect(state.nodes.check).toEqual({
			outcome: "fail",
			exit_code: 1,
			log_tail: "",
			visit: 1,
		});
	});

	test("a stop while the command runs kills it, ends the step stopped and parks the run", async () => {
		const controller = new AbortController();
		const h = await startRun(
			sandbox,
			flowOf({
				start: "slow",
				nodes: [command("slow", "echo started; sleep 30")],
				edges: [],
			}),
			{ signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 200);
		const { parked, state } = await drive(h, { inputs: {} });
		const [slow] = deriveSteps(await h.events());
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: slow?.id as string,
				nodeId: "slow",
				status: "stopped",
				reason: null,
			},
		]);
		// Killed: no exit code, only the tail.
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "stopped",
				outputs: { outcome: "stopped", log_tail: "started", visit: 1 },
				error: null,
			},
		]);
		expect(state.pending).toMatchObject({
			kind: "parked",
			stepId: slow?.id,
			nodeId: "slow",
			visit: 1,
			status: "stopped",
		});
		const transcript = await readTranscriptFile(slow?.transcriptPath as string);
		expect(transcript.at(-1)?.event).toEqual({
			type: "command-exit",
			exitCode: null,
		});
	});

	test("a command past its time budget ends with an error", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "slow",
				nodes: [command("slow", "sleep 30", { timeoutMinutes: 1 })],
				edges: [],
			}),
		);
		h.ctx.minuteMs = 50;
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason: 'Node "slow" failed: The step ran past its time budget of 1 min.',
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			outputs: { outcome: "error", log_tail: "", visit: 1 },
			error: "The step ran past its time budget of 1 min.",
		});
	});

	test("a parked command resumes as a new visit", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "check",
				nodes: [command("check", "test -f fixed")],
				edges: [],
			}),
		);
		const first = await drive(h, { inputs: {} });
		expect(first.parked[0]).toMatchObject({ status: "failed" });
		await Bun.write(join(sandbox.repoPath, "fixed"), "");
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: { nodeId: "check", stepId: null, prompt: null, by: "person" },
		});
		// A new compile over the same saver: a new daemon.
		const resumed = await drive(
			h,
			new Command({ resume: { kind: "resume" } }),
			h.graph(),
		);
		expect(resumed.state.ended?.status).toBe("finished");
		expect(
			deriveSteps(await h.events()).map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "fail"],
			[2, "pass"],
		]);
		expect(await h.types()).not.toContain("StepReopened");
	});
});
