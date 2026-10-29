import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { step } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/derive-steps";
import { drive, flowOf, held, payloads, startRun } from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	TEST_DEVICE_ID,
} from "../testing/test-support";

/**
 * The Command node on the compiled graph, with a real shell, run log and
 * checkpoint saver. The event log, the transcript and the log file are compared
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
				deviceId: TEST_DEVICE_ID,
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
		const env = "NS_TASK";
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
		expect(held(state)).toBeNull();
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
		expect(held(state)).toMatchObject({
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

	test("output json: what the command prints is `data`, and a later node reads a path into it", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "check",
				nodes: [
					command("check", `echo '{"tests": 3, "names": ["a", "b"]}'`, {
						output: "json",
					}),
					command(
						"report",
						`echo "{{check.data.tests}}:{{check.data.names.1}}"`,
					),
				],
				edges: [{ id: "e1", from: "check", outcome: "pass", to: "report" }],
			}),
		);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("report");
		const logged = await h.events();
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "pass",
			outputs: {
				outcome: "pass",
				exit_code: 0,
				log_tail: '{"tests": 3, "names": ["a", "b"]}',
				data: { tests: 3, names: ["a", "b"] },
				visit: 1,
			},
			error: null,
		});
		// One reference keeps the JSON value; a path reads into it.
		expect(state.nodes.check?.data).toEqual({ tests: 3, names: ["a", "b"] });
		expect(payloads(logged, "StepEnded")[1]?.outputs.log_tail).toBe("3:b");
	});

	test("output json: output that is not JSON fails the step with a plain reason", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "check",
				nodes: [
					command("check", "echo not json", { output: "json" }),
					command("after", "true"),
				],
				edges: [{ id: "e1", from: "check", outcome: "fail", to: "after" }],
			}),
		);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("after");
		const logged = await h.events();
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				exit_code: 0,
				log_tail: "not json",
				visit: 1,
			},
			error: "The command's output is not valid JSON.",
		});
	});

	test("output text keeps stdout out of the outputs", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "check",
				nodes: [command("check", `echo '{"a": 1}'`)],
				edges: [],
			}),
		);
		await drive(h, { inputs: {} });
		const [ended] = payloads(await h.events(), "StepEnded");
		expect(ended?.outputs).not.toHaveProperty("data");
	});

	describe("secrets", () => {
		const secrets = { ZAC_USER: "behandelaar", ZAC_PASSWORD: "s3cr3t-pw" };
		const withSecrets = (h: Awaited<ReturnType<typeof startRun>>) => {
			h.local.secretEnv = async (names) => {
				const missing = names.filter((name) => !(name in secrets));
				if (missing.length > 0) return { ok: false, missing };
				return {
					ok: true,
					env: Object.fromEntries(
						names.map((name) => [name, secrets[name as keyof typeof secrets]]),
					),
				};
			};
			return h;
		};

		test("each secret reaches the command by name; its value is ••• in the transcript, the log file, log_tail and data", async () => {
			const h = withSecrets(
				await startRun(
					sandbox,
					flowOf({
						start: "login",
						nodes: [
							command(
								"login",
								// The command checks the value it got; the output prints it.
								`[ "$ZAC_PASSWORD" = "s3cr3t-pw" ] && printf '{"user": "%s", "token": "%s"}\\n' "$ZAC_USER" "$ZAC_PASSWORD" && echo "$ZAC_PASSWORD" >&2`,
								{ output: "json", secrets: ["ZAC_USER", "ZAC_PASSWORD"] },
							),
						],
						edges: [],
					}),
				),
			);
			const { parked } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			const logged = await h.events();
			const [ended] = payloads(logged, "StepEnded");
			expect(ended?.outcome).toBe("pass");
			expect(ended?.outputs.data).toEqual({ user: "•••", token: "•••" });
			expect(ended?.outputs.log_tail).not.toContain("s3cr3t-pw");
			expect(ended?.outputs.log_tail).toContain('"token": "•••"');

			const [derived] = deriveSteps(logged);
			const transcript = await readTranscriptFile(
				derived?.transcriptPath as string,
			);
			expect(
				transcript
					.flatMap((e) =>
						e.event.type === "command-output"
							? [`${e.event.stream}: ${e.event.text}`]
							: [],
					)
					// The two streams may arrive in either order.
					.sort(),
			).toEqual(["stderr: •••\n", 'stdout: {"user": "•••", "token": "•••"}\n']);
			const log = await readFile(derived?.logPath as string, "utf8");
			expect(log).toContain("•••");
			expect(log).not.toContain("s3cr3t-pw");
			expect(log).not.toContain("behandelaar");
		});

		test("a secret value the command writes to NS_OUTPUT is ••• in data", async () => {
			const h = withSecrets(
				await startRun(
					sandbox,
					flowOf({
						start: "login",
						nodes: [
							command(
								"login",
								`printf '{"token": "%s"}' "$ZAC_PASSWORD" > "$NS_OUTPUT"`,
								{ secrets: ["ZAC_PASSWORD"] },
							),
						],
						edges: [],
					}),
				),
			);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.nodes.login?.data).toEqual({ token: "•••" });
		});

		test("a secret the Device does not have errors the step before the command runs", async () => {
			const marker = join(sandbox.repoPath, "ran");
			const h = withSecrets(
				await startRun(
					sandbox,
					flowOf({
						start: "login",
						nodes: [
							command("login", `touch ${marker}`, {
								secrets: ["ZAC_USER", "ZAC_BEHANDELAAR_PASSWORD"],
							}),
						],
						edges: [],
					}),
				),
			);
			const { parked } = await drive(h, { inputs: {} });
			const reason =
				"The command needs the secret ZAC_BEHANDELAAR_PASSWORD, but it is not saved. Save it under Agents → Secrets, or remove it from the node.";
			expect(parked[0]).toMatchObject({
				status: "failed",
				reason: `Node "login" failed: ${reason}`,
			});
			const [ended] = payloads(await h.events(), "StepEnded");
			expect(ended).toEqual({
				outcome: "error",
				outputs: { outcome: "error", visit: 1 },
				error: reason,
			});
			expect(await Bun.file(marker).exists()).toBe(false);
		});
	});

	describe("exits", () => {
		const exits = [
			{ name: "success", code: 0 },
			{ name: "not-found", code: 127 },
			{ name: "other" },
		];

		test("the exit code picks its exit and that edge", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command("check", "exit 127", { exits }),
						command("install", "true"),
					],
					edges: [
						{ id: "e1", from: "check", outcome: "not-found", to: "install" },
					],
				}),
			);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.ended?.nodeId).toBe("install");
			expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
				outcome: "not-found",
				outputs: {
					outcome: "not-found",
					exit_code: 127,
					log_tail: "",
					visit: 1,
				},
				error: null,
			});
		});

		test("a code without an exit ends on the catch-all", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command("check", "exit 4", { exits }),
						command("after", "true"),
					],
					edges: [{ id: "e1", from: "check", outcome: "other", to: "after" }],
				}),
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.ended?.nodeId).toBe("after");
			expect(state.nodes.check?.outcome).toBe("other");
			expect(state.nodes.check?.exit_code).toBe(4);
		});

		test("exit 0 without an edge finishes the run; another exit without an edge fails it", async () => {
			const ok = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [command("check", "true", { exits })],
					edges: [],
				}),
			);
			const passed = await drive(ok, { inputs: {} });
			expect(passed.parked).toEqual([]);
			expect(passed.state.ended).toMatchObject({
				status: "finished",
				outcome: "success",
				reason: null,
			});

			const bad = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [command("check", "exit 127", { exits })],
					edges: [],
				}),
			);
			const failed = await drive(bad, { inputs: {} });
			expect(failed.parked[0]).toMatchObject({
				status: "failed",
				reason:
					'Node "check" ended with "not-found" and no edge leaves it on that outcome.',
			});
		});

		test("without a catch-all, a code that is not listed errors the step", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command("check", "exit 5", {
							exits: [{ name: "success", code: 0 }],
						}),
					],
					edges: [],
				}),
			);
			const { parked } = await drive(h, { inputs: {} });
			expect(parked[0]).toMatchObject({
				status: "failed",
				reason:
					'Node "check" failed: The command exited with code 5, and the node has no exit for it.',
			});
		});

		test("output json that is not JSON ends on the catch-all", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command("check", "echo not json", { output: "json", exits }),
						command("after", "true"),
					],
					edges: [{ id: "e1", from: "check", outcome: "other", to: "after" }],
				}),
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.ended?.nodeId).toBe("after");
			const [ended] = payloads(await h.events(), "StepEnded");
			expect(ended).toMatchObject({
				outcome: "other",
				error: "The command's output is not valid JSON.",
			});
		});
	});

	describe("NS_OUTPUT", () => {
		test("the JSON the command writes there is `data`; stdout stays the log", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command(
							"check",
							`echo "counting"; echo '{"tests": 3}' > "$NS_OUTPUT"; echo done`,
						),
						command("report", `echo "{{check.data.tests}}"`),
					],
					edges: [{ id: "e1", from: "check", outcome: "pass", to: "report" }],
				}),
			);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.nodes.check?.data).toEqual({ tests: 3 });
			expect(state.nodes.check?.log_tail).toBe("counting\ndone");
			expect(payloads(await h.events(), "StepEnded")[1]?.outputs.log_tail).toBe(
				"3",
			);
		});

		test("the file wins over stdout with output json; an empty file leaves stdout", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "file",
					nodes: [
						command(
							"file",
							`echo '{"from": "stdout"}'; echo '{"from": "file"}' > "$NS_OUTPUT"`,
							{ output: "json" },
						),
						command("printed", `echo '{"from": "stdout"}'`, {
							output: "json",
						}),
					],
					edges: [{ id: "e1", from: "file", outcome: "pass", to: "printed" }],
				}),
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.nodes.file?.data).toEqual({ from: "file" });
			expect(state.nodes.printed?.data).toEqual({ from: "stdout" });
		});

		test("each step gets a new, empty file of its own, and it goes when the step ends", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "first",
					nodes: [
						command(
							"first",
							`echo "$NS_OUTPUT"; echo '{"n": 1}' > "$NS_OUTPUT"`,
						),
						command("second", `test ! -s "$NS_OUTPUT" && echo "$NS_OUTPUT"`),
					],
					edges: [{ id: "e1", from: "first", outcome: "pass", to: "second" }],
				}),
			);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			const first = String(state.nodes.first?.log_tail);
			const second = String(state.nodes.second?.log_tail);
			expect(first).not.toBe("");
			expect(second).not.toBe(first);
			expect(existsSync(first)).toBe(false);
			expect(state.nodes.second?.data).toBeUndefined();
		});

		test("a file that is not JSON ends on the catch-all, whatever output says", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "check",
					nodes: [
						command("check", `echo 'count=3' > "$NS_OUTPUT"`),
						command("after", "true"),
					],
					edges: [{ id: "e1", from: "check", outcome: "fail", to: "after" }],
				}),
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.ended?.nodeId).toBe("after");
			expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
				outcome: "fail",
				error: "The data the command wrote is not valid JSON.",
			});
		});
	});

	describe("data.outcome", () => {
		const exits = [
			{ name: "created", code: 0 },
			{ name: "exists", code: "data" },
			{ name: "failure", code: 1 },
			{ name: "other" },
		];
		const pick = (cmd: string) =>
			startRun(
				sandbox,
				flowOf({
					start: "branch",
					nodes: [
						command("branch", cmd, { exits }),
						command("reuse", "true"),
						command("fix", "true"),
					],
					edges: [
						{ id: "e1", from: "branch", outcome: "exists", to: "reuse" },
						{ id: "e2", from: "branch", outcome: "failure", to: "fix" },
					],
				}),
			);

		test("data that names an exit ends on it and takes its edge", async () => {
			const h = await pick(`echo '{"outcome": "exists"}' > "$NS_OUTPUT"`);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.ended?.nodeId).toBe("reuse");
			expect(state.nodes.branch).toMatchObject({
				outcome: "exists",
				exit_code: 0,
				data: { outcome: "exists" },
			});
		});

		test("the data wins over the exit code", async () => {
			const h = await pick(
				`echo '{"outcome": "exists"}' > "$NS_OUTPUT"; exit 1`,
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.nodes.branch?.outcome).toBe("exists");
			expect(state.nodes.branch?.exit_code).toBe(1);
		});

		test("data that names no exit leaves the pick to the exit code", async () => {
			const h = await pick(`echo '{"outcome": "nope"}' > "$NS_OUTPUT"; exit 1`);
			const { state } = await drive(h, { inputs: {} });
			expect(state.ended?.nodeId).toBe("fix");
			expect(state.nodes.branch?.outcome).toBe("failure");
		});

		test("stdout JSON with output json picks too", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "branch",
					nodes: [
						command("branch", `echo '{"outcome": "exists"}'`, {
							exits,
							output: "json",
						}),
					],
					edges: [],
				}),
			);
			const { state } = await drive(h, { inputs: {} });
			expect(state.nodes.branch?.outcome).toBe("exists");
		});

		test("an exit only data picks ends the run as chosen when it has no edge", async () => {
			const h = await startRun(
				sandbox,
				flowOf({
					start: "branch",
					nodes: [
						command("branch", `echo '{"outcome": "exists"}' > "$NS_OUTPUT"`, {
							exits,
						}),
					],
					edges: [],
				}),
			);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.ended).toMatchObject({
				status: "finished",
				outcome: "exists",
				reason: null,
			});
		});
	});
});
