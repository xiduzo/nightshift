import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { run } from "@nightshift/db/schema";
import type { EndNode } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { Capabilities, Device } from "../device";
import { foldRun } from "../log";

import { readTranscriptFile } from "../log/transcripts";
import { refusalOf } from "../placement";
import { deriveSteps } from "../read/run-views";
import { createRunFolders } from "../run-folders";
import {
	command,
	type Driven,
	drive,
	edge,
	flowOf,
	type Harness,
	MINUTE,
	payloads,
	placementOn,
	type StartOptions,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	TEST_DEVICE_ID,
	testDevice,
} from "../testing/test-support";
import { endingOf } from "./thread";

/**
 * The End node on the compiled graph: a chosen end with a result. The run
 * ends with the End's status as its result and its message as its reason;
 * a `failed` End ends the run `failed`. In a called flow, the Call reads
 * the result: `pass` or `fail`, with `ended` and `end_message`.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const end = (
	id: string,
	status: EndNode["status"],
	message?: string,
): EndNode => ({
	id,
	type: "end",
	position: { x: 0, y: 0 },
	status,
	...(message !== undefined ? { message } : {}),
});

/** look (pass → none: nothing to do; fail → broke: failed). */
const lookFlow = (cmd: string) =>
	flowOf(
		[
			command("look", cmd),
			end("none", "nothing-to-do", "  No open issues for {{label}}\nmore"),
			end("broke", "failed"),
		],
		[edge("e1", "look", "pass", "none"), edge("e2", "look", "fail", "broke")],
		{ inputs: [{ name: "label", type: "text", default: "bugs" }] },
	);

describe("the End node", () => {
	test("ends the run with its status as the result and its message, on one line, as the reason", async () => {
		const h = await startRun(sandbox, lookFlow("true"));
		const driven = await drive(h, { inputs: { label: "bugs" } });
		expect(driven.parked).toEqual([]);
		expect(driven.state.ended).toEqual({
			status: "finished",
			nodeId: "none",
			outcome: "nothing-to-do",
			reason: "No open issues for bugs",
			result: "nothing-to-do",
		});
		expect(driven.state.nodes.none).toEqual({
			message: "No open issues for bugs",
			visit: 1,
			outcome: "nothing-to-do",
		});
		// What the runner appends for it.
		expect(endingOf(driven.outcome)).toEqual({
			status: "finished",
			reason: "No open issues for bugs",
			result: "nothing-to-do",
			endReason: "finished",
		});

		const events = await h.events();
		expect(payloads(events, "StepStarted").map((p) => p.nodeType)).toEqual([
			"command",
			"end",
		]);
		const endStep = deriveSteps(foldRun(events)).find(
			(s) => s.nodeId === "none",
		);
		expect(endStep?.outcome).toBe("nothing-to-do");
		expect(
			(await readTranscriptFile(endStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "end",
				status: "nothing-to-do",
				message: "No open issues for bugs",
			},
		]);
	});

	test("a failed End ends the run failed: a failure its flow chose, with no message", async () => {
		const h = await startRun(sandbox, lookFlow("false"));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({
			nodeId: "broke",
			outcome: "failed",
			reason: null,
			result: "failed",
		});
		const ending = endingOf(driven.outcome);
		expect(ending).toEqual({
			status: "failed",
			reason: null,
			result: "failed",
			endReason: "_OTHER",
		});
		// As the runner logs it, the run reads as failed with its result.
		await h.log.append({
			type: "RunEnded",
			runId: h.runId,
			payload: {
				status: "failed",
				reason: null,
				result: "failed",
			},
		});
		expect(foldRun(await h.events()).end).toMatchObject({
			status: "failed",
			reason: null,
			result: "failed",
			endReason: "_OTHER",
		});
	});
});

describe("the report of an End node", () => {
	const reporting = (text: string): EndNode => ({
		...end("done", "done", "Found {{look.log_tail}}"),
		report: { kind: "text", text },
	});
	const reportFlow = (text: string, cmd = "echo 3 items") =>
		flowOf(
			[command("look", cmd), reporting(text)],
			[edge("e1", "look", "pass", "done")],
		);

	test("renders into the step's outputs and the transcript says it wrote one", async () => {
		const h = await startRun(
			sandbox,
			reportFlow("\n## What is new\n\n- {{look.log_tail}}\n\n"),
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.done).toEqual({
			message: "Found 3 items",
			report: "## What is new\n\n- 3 items",
			visit: 1,
			outcome: "done",
		});
		// Only a Call reads it from the end: the run's report is the step's.
		expect(driven.state.ended).toMatchObject({
			nodeId: "done",
			result: "done",
			report: "## What is new\n\n- 3 items",
		});
		const events = await h.events();
		expect(payloads(events, "RunWarned")).toEqual([]);
		const step = deriveSteps(foldRun(events)).find((s) => s.nodeId === "done");
		expect(
			(await readTranscriptFile(step?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "end",
				status: "done",
				message: "Found 3 items",
				report: { cut: false },
			},
		]);
	});

	test("a blank report keeps an empty text, and the run has no report", async () => {
		const h = await startRun(sandbox, reportFlow("  \n"));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.done).toMatchObject({ report: "" });
		expect(driven.state.ended).not.toHaveProperty("report");
	});

	test("an End without a report has no report output", async () => {
		const h = await startRun(sandbox, lookFlow("true"));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.none).not.toHaveProperty("report");
	});

	test("a report over 64 KB is cut at a line break, with a warning", async () => {
		// 2,000 lines of 40 bytes: 80,000 bytes, then what the step found.
		const line = `${"x".repeat(39)}\n`;
		const h = await startRun(
			sandbox,
			reportFlow(`${line.repeat(2000)}{{look.log_tail}}`),
		);
		const driven = await drive(h, { inputs: {} });
		const report = (driven.state.nodes.done as { report: string }).report;
		// 1,638 whole lines fit in 65,536 bytes.
		expect(report).toBe(line.repeat(1638).trimEnd());
		const events = await h.events();
		const step = deriveSteps(foldRun(events)).find((s) => s.nodeId === "done");
		expect(payloads(events, "RunWarned")).toEqual([
			{
				kind: "report",
				message:
					"This report is longer than 64 KB. Night Shift kept the first 64 KB.",
			},
		]);
		expect(
			(await readTranscriptFile(step?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "end",
				status: "done",
				message: "Found 3 items",
				report: { cut: true },
			},
		]);
	});
});

describe("a report from a file the run wrote", () => {
	const fromFile = (path: string): EndNode => ({
		...end("done", "done", "Found it"),
		report: { kind: "file", path },
	});
	/** write (a command in the folder the run works in) → done, which reads `path`. */
	const fileFlow = (path: string, cmd = "true") =>
		flowOf(
			[command("write", cmd), fromFile(path)],
			[edge("e1", "write", "pass", "done")],
			{ inputs: [{ name: "name", type: "text", default: "news" }] },
		);
	const warnings = async (h: { events: () => Promise<unknown[]> }) =>
		payloads((await h.events()) as Parameters<typeof payloads>[0], "RunWarned");

	test("keeps the file a step wrote as the report, at a path a template renders", async () => {
		const h = await startRun(
			sandbox,
			fileFlow(
				"./out/{{name}}.md",
				"mkdir -p out && printf '\\n## What is new\\n\\n- one\\n\\n' > out/news.md",
			),
		);
		const driven = await drive(h, { inputs: { name: "news" } });
		expect(driven.state.nodes.done).toEqual({
			message: "Found it",
			report: "## What is new\n\n- one",
			visit: 1,
			outcome: "done",
		});
		expect(driven.state.ended).toMatchObject({
			result: "done",
			report: "## What is new\n\n- one",
		});
		const events = await h.events();
		expect(payloads(events, "RunWarned")).toEqual([]);
		const step = deriveSteps(foldRun(events)).find((s) => s.nodeId === "done");
		expect(
			(await readTranscriptFile(step?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "end",
				status: "done",
				message: "Found it",
				report: { cut: false },
			},
		]);
	});

	test("a missing file warns, and the run ends done without a report", async () => {
		const h = await startRun(sandbox, fileFlow("report.md"));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({
			status: "finished",
			result: "done",
		});
		expect(driven.state.ended).not.toHaveProperty("report");
		expect(driven.state.nodes.done).toMatchObject({
			outcome: "done",
			report: "",
		});
		expect(await warnings(h)).toEqual([
			{
				kind: "report",
				message:
					'Night Shift found no file "report.md" in the folder the run works in on test. The run ends without a report.',
			},
		]);
	});

	test("a file that is not text, or not inside the folder, warns", async () => {
		const outside = join(sandbox.dataDir, "secret.md");
		await mkdir(sandbox.dataDir, { recursive: true });
		await writeFile(outside, "# not the run's");
		await writeFile(
			join(sandbox.repoPath, "chart.png"),
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
		);
		await symlink(outside, join(sandbox.repoPath, "linked.md"));
		const cases: [string, string][] = [
			[
				"chart.png",
				'"chart.png" is not a text file. Write the report as Markdown or plain text.',
			],
			[
				"linked.md",
				'"linked.md" is not a file inside the folder the run works in.',
			],
			[
				"{{name}}/../../secret.md",
				'"news/../../secret.md" is not a file inside the folder the run works in.',
			],
			[
				"/etc/hosts",
				'"/etc/hosts" is not a file inside the folder the run works in.',
			],
			[
				".git/config",
				'".git/config" is not a file inside the folder the run works in.',
			],
			["{{write.log_tail}}", "The path of the report file is empty."],
		];
		for (const [path, why] of cases) {
			const h = await startRun(sandbox, fileFlow(path));
			const driven = await drive(h, { inputs: { name: "news" } });
			expect(driven.state.ended).toMatchObject({ result: "done" });
			expect(driven.state.ended).not.toHaveProperty("report");
			expect(await warnings(h)).toEqual([
				{ kind: "report", message: `${why} The run ends without a report.` },
			]);
		}
	});

	test("a file over 64 KB is cut at a line break, with a warning", async () => {
		// 2,000 lines of 40 bytes: 80,000 bytes.
		const line = `${"x".repeat(39)}\n`;
		await writeFile(join(sandbox.repoPath, "long.md"), line.repeat(2000));
		const h = await startRun(sandbox, fileFlow("long.md"));
		const driven = await drive(h, { inputs: {} });
		expect((driven.state.nodes.done as { report: string }).report).toBe(
			line.repeat(1638).trimEnd(),
		);
		expect(await warnings(h)).toEqual([
			{
				kind: "report",
				message:
					"This report is longer than 64 KB. Night Shift kept the first 64 KB.",
			},
		]);
	});

	test("in a run without a folder, it reads the file from the run's own folder", async () => {
		const h = await startRun(
			sandbox,
			fileFlow("report.md", "printf '# Done' > report.md"),
			{ runFolder: true },
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({
			result: "done",
			report: "# Done",
		});
	});

	describe("when a step on another Device wrote the file", () => {
		/** Device b's copy of the project, or its run folders. */
		let other: string;
		beforeEach(async () => {
			other = await realpath(
				await mkdtemp(join(tmpdir(), "nightshift-device-b-")),
			);
		});
		afterEach(async () => {
			await rm(other, { recursive: true, force: true });
		});

		/**
		 * write (on Device b) → done (on the run's Device), which reads
		 * report.md. The run's Device has its copy at the sandbox's repo, b
		 * at `other`. A Hand-off refuses a copy with a report.md, as git
		 * refuses a file that is not committed.
		 */
		async function onTwoDevices(cmd: string, options: StartOptions = {}) {
			const h = await startRun(
				sandbox,
				flowOf(
					[command("write", cmd, { device: "b" }), fromFile("report.md")],
					[edge("e1", "write", "pass", "done")],
				),
				options,
			);
			// The plan names b, by its id.
			const deviceNames = JSON.stringify({ b: "studio-b" });
			await sandbox.db
				.update(run)
				.set({ deviceNames })
				.where(eq(run.id, h.runId));
			h.ctx.run = { ...h.ctx.run, deviceNames };
			const handOffs: string[] = [];
			const here = testDevice(h.local);
			const onB = {
				...testDevice({ ...h.local, runFolders: createRunFolders(other) }, "b"),
				name: "studio-b",
			};
			h.ctx.placement = placementOn((id) => {
				const device = id === "b" ? onB : here;
				return {
					...device,
					handOff: async ({ cwd }) => {
						handOffs.push(device.name);
						if (existsSync(join(cwd, "report.md"))) {
							throw new Refusal(
								"conflict",
								"The run's copy of the project has changes that are not committed (report.md).",
							);
						}
						return { commit: "c0ffee", branch: "nightshift/test" };
					},
					receiveHandOff: async ({ branch }) => ({
						worktreePath: other,
						branch,
						baseRef: "main",
					}),
				};
			});
			const devices = async () =>
				payloads(await h.events(), "StepStarted").map((s) => [
					s.nodeId,
					s.deviceId,
				]);
			return { h, handOffs, devices };
		}

		test("in a project with a folder, the End reads it on the Device that has the run's copy: no Hand-off, and the run ends done", async () => {
			const { h, handOffs, devices } = await onTwoDevices(
				"printf '# Done' > report.md",
			);
			const driven = await drive(h, { inputs: {} });
			expect(driven.state.ended).toMatchObject({
				status: "finished",
				result: "done",
				report: "# Done",
			});
			// Only the Hand-off to b, for the step that wrote the file.
			expect(handOffs).toEqual(["test"]);
			expect(payloads(await h.events(), "HandedOff")).toHaveLength(1);
			expect(await warnings(h)).toEqual([]);
			expect(await devices()).toEqual([
				["write", "b"],
				["done", "b"],
			]);
		});

		test("a missing file there warns and names that Device: the End keeps its status", async () => {
			const { h } = await onTwoDevices("true");
			const driven = await drive(h, { inputs: {} });
			expect(driven.state.ended).toMatchObject({
				status: "finished",
				result: "done",
			});
			expect(driven.state.ended).not.toHaveProperty("report");
			expect(await warnings(h)).toEqual([
				{
					kind: "report",
					message:
						'Night Shift found no file "report.md" in the folder the run works in on studio-b. The run ends without a report.',
				},
			]);
		});

		test("in a project without a folder, the End reads the run folder on the run's Device: the file on b is missing", async () => {
			const { h, handOffs, devices } = await onTwoDevices(
				"printf '# Done' > report.md",
				{ runFolder: true },
			);
			const driven = await drive(h, { inputs: {} });
			expect(driven.state.ended).toMatchObject({
				status: "finished",
				result: "done",
			});
			expect(driven.state.ended).not.toHaveProperty("report");
			expect(handOffs).toEqual([]);
			expect(await warnings(h)).toEqual([
				{
					kind: "report",
					message:
						'Night Shift found no file "report.md" in the folder the run works in on test. The run ends without a report.',
				},
			]);
			expect(await devices()).toEqual([
				["write", "b"],
				["done", TEST_DEVICE_ID],
			]);
		});
	});

	test("a Device that reads no files: a warning that says to update it", async () => {
		const h = await startRun(sandbox, fileFlow("report.md"));
		const { readFile: _, ...older } = testDevice(h.local);
		h.ctx.placement = placementOn(() => ({ ...older, name: "laptop" }));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({ result: "done" });
		expect(await warnings(h)).toEqual([
			{
				kind: "report",
				message:
					"Night Shift could not read the report file. laptop runs an older version of Night Shift. Update Night Shift on laptop. The run ends without a report.",
			},
		]);
	});

	test("a Device that goes away during the read: the step waits as the network does", async () => {
		const h = await startRun(sandbox, fileFlow("report.md"));
		const device: Device = {
			...testDevice(h.local),
			name: "laptop",
			readFile: async () => {
				throw new Refusal("unavailable", "laptop did not answer in time.");
			},
		};
		h.ctx.placement = placementOn(() => device);
		const first = await drive(h, { inputs: {} });
		expect(first.parked[0]).toMatchObject({ kind: "wait", reason: "network" });
		expect(first.state.ended).toBeFalsy();
	});

	describe("a Device that does not answer for the network grace", () => {
		/** The engine's clock: each wake moves it to the wait's time. */
		let clock: number;
		beforeEach(() => {
			clock = 1_000_000;
		});

		/** fileFlow with a network grace of 5 min: waits of 1 and 2 min fit, the next one does not. */
		const graceFlow = () => ({
			...fileFlow("report.md"),
			policy: { networkGraceMinutes: 5 },
		});

		async function notAnswering(options: StartOptions = {}) {
			const h = await startRun(sandbox, graceFlow(), {
				now: () => clock,
				...options,
			});
			const reads: string[] = [];
			const device: Device = {
				...testDevice(h.local),
				name: "laptop",
				readFile: async () => {
					reads.push(`read at ${clock}`);
					throw new Refusal("unavailable", "laptop did not answer in time.");
				},
			};
			h.ctx.placement = placementOn(() => device);
			return { h, reads };
		}

		/** Wakes the run at its wait's time, as the runner's timer does. */
		async function wake(h: Harness, parked: Driven["parked"]) {
			const [wait] = parked;
			if (wait?.kind !== "wait") throw new Error("The run does not wait.");
			clock = wait.until ?? clock;
			await h.log.append({
				type: "WaitEnded",
				runId: h.runId,
				stepId: wait.stepId,
				payload: { early: false },
			});
			return drive(h, new Command({ resume: { kind: "wake", early: false } }));
		}

		test("once the network grace runs out, the End warns and keeps its status: the run ends done", async () => {
			const { h, reads } = await notAnswering();
			const first = await drive(h, { inputs: {} });
			expect(first.parked[0]).toMatchObject({
				kind: "wait",
				reason: "network",
				until: clock + MINUTE,
			});
			const second = await wake(h, first.parked);
			expect(second.parked[0]).toMatchObject({
				kind: "wait",
				reason: "network",
				until: clock + 2 * MINUTE,
			});
			// 1 + 2 min have passed: a wait of 5 more would pass the grace.
			const third = await wake(h, second.parked);
			expect(reads).toHaveLength(3);
			expect(third.parked).toEqual([]);
			expect(third.state.ended).toMatchObject({
				status: "finished",
				nodeId: "done",
				outcome: "done",
				reason: "Found it",
				result: "done",
			});
			expect(third.state.ended).not.toHaveProperty("report");
			expect(third.state.nodes.done).toEqual({
				message: "Found it",
				report: "",
				visit: 1,
				outcome: "done",
			});
			const events = await h.events();
			expect(await warnings(h)).toEqual([
				{
					kind: "report",
					message:
						"Night Shift could not read the report file on laptop. The run ends without a report.",
				},
			]);
			const [step] = deriveSteps(foldRun(events)).filter(
				(s) => s.nodeId === "done",
			);
			expect(step).toMatchObject({ outcome: "done", error: null });
			expect(
				(await readTranscriptFile(step?.transcriptPath as string))
					.map((e) => e.event)
					.filter((e) => e.type === "end"),
			).toEqual([
				{
					type: "end",
					status: "done",
					message: "Found it",
					report: { cut: false },
				},
			]);
		});

		test("a Device that stays offline: the End sleeps for the grace, then warns and keeps its status", async () => {
			// The End alone: the Device is offline from the start.
			const h = await startRun(
				sandbox,
				flowOf([fromFile("report.md")], [], {
					policy: { networkGraceMinutes: 5 },
				}),
				{ now: () => clock },
			);
			const reads: string[] = [];
			const device: Device = {
				...testDevice(h.local),
				name: "laptop",
				state: async () => ({ online: false }),
				readFile: async () => {
					reads.push("read");
					return { kind: "missing" };
				},
			};
			h.ctx.placement = placementOn(() => device);
			const start = clock;
			let driven = await drive(h, { inputs: {} });
			const looks: number[] = [];
			while (driven.parked[0]?.kind === "wait" && looks.length < 10) {
				expect(driven.parked[0]).toMatchObject({ reason: "device-offline" });
				looks.push((clock - start) / MINUTE);
				driven = await wake(h, driven.parked);
			}
			// It looks again each minute: a look past 5 min would pass the grace.
			expect(looks).toEqual([0, 1, 2, 3, 4]);
			expect(clock - start).toBe(5 * MINUTE);
			expect(reads).toEqual([]);
			expect(driven.parked).toEqual([]);
			expect(driven.state.ended).toMatchObject({
				status: "finished",
				result: "done",
				reason: "Found it",
			});
			expect(driven.state.ended).not.toHaveProperty("report");
			expect(await warnings(h)).toEqual([
				{
					kind: "report",
					message:
						"Night Shift could not read the report file on laptop. The run ends without a report.",
				},
			]);
		});

		test("a stop during the read still stops: the step ends stopped, with no warning", async () => {
			const stop = new AbortController();
			const h = await startRun(sandbox, graceFlow(), { signal: stop.signal });
			const device: Device = {
				...testDevice(h.local),
				name: "laptop",
				// The call ends when the stop aborts it.
				readFile: ({ signal }) =>
					new Promise((_resolve, reject) => {
						signal?.addEventListener("abort", () =>
							reject(new Refusal("unavailable", "The call was stopped.")),
						);
					}),
			};
			h.ctx.placement = placementOn(() => device);
			setTimeout(() => stop.abort(), 100);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked[0]).toMatchObject({ status: "stopped", reason: null });
			expect(state.ended).toBeFalsy();
			expect(payloads(await h.events(), "StepEnded").at(-1)).toEqual({
				outcome: "stopped",
				outputs: { outcome: "stopped", message: "", visit: 1 },
				error: null,
			});
			expect(await warnings(h)).toEqual([]);
		});
	});

	test("run start refuses a Device that reads no files, and names the nodes", () => {
		const has: Capabilities = {
			elsewhere: "laptop",
			harnesses: [],
			connections: [],
			clis: [],
			programs: {},
			profiles: {},
			decider: null,
			requests: true,
			flowVersion: Number.MAX_SAFE_INTEGER,
		};
		const nodes = [fromFile("report.md"), end("none", "nothing-to-do")];
		expect(refusalOf(nodes, has)).toBe(
			"The flow ends with a report from a file (done), but laptop runs an older version of Night Shift. Update Night Shift on laptop.",
		);
		expect(refusalOf(nodes, { ...has, readFiles: true })).toBeNull();
		expect(refusalOf([end("none", "done")], has)).toBeNull();
	});
});

describe("an End node in a called flow", () => {
	const callOnce = (id: string, flow: string) =>
		({ id, type: "call", position: { x: 0, y: 0 }, flow, inputs: {} }) as const;
	const report = command(
		"report",
		'echo "{{sub.outcome}}|{{sub.ended}}|{{sub.end_message}}"',
	);

	test("done and nothing-to-do end the Call pass, with the status as ended and the message as end_message", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[callOnce("sub", "look"), report],
				[edge("e1", "sub", "pass", "report")],
			),
			{ flows: { look: lookFlow("true") } },
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.sub).toMatchObject({
			outcome: "pass",
			ended: "nothing-to-do",
			end_message: "No open issues for bugs",
		});
		expect(driven.state.nodes.report).toMatchObject({
			log_tail: "pass|nothing-to-do|No open issues for bugs",
		});
		// The run itself ends plainly: only an End of its own flow gives it a result.
		expect(driven.state.ended).toEqual({
			status: "finished",
			nodeId: "report",
			outcome: "pass",
			reason: null,
		});
	});

	test("a failed End ends the Call fail, and the run goes on along its fail edge", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[callOnce("sub", "look"), report],
				[edge("e1", "sub", "fail", "report")],
			),
			{ flows: { look: lookFlow("false") } },
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.sub).toMatchObject({
			outcome: "fail",
			ended: "failed",
			end_message: "",
		});
		const sub = deriveSteps(foldRun(await h.events())).find(
			(s) => s.nodeId === "sub",
		);
		expect(sub?.error).toBe('The flow ended as failed at node "broke".');
		expect(driven.state.nodes.report).toMatchObject({
			log_tail: "fail|failed|",
		});
	});

	test("the Call gives the End's report as end_report, and an empty one without a report", async () => {
		const written = flowOf([
			{
				...end("found", "done", "Found it"),
				report: { kind: "text", text: "## Found\n\n{{label}}" },
			},
		]);
		const h = await startRun(
			sandbox,
			flowOf(
				[callOnce("sub", "write"), callOnce("bare", "look")],
				[edge("e1", "sub", "pass", "bare")],
			),
			{
				flows: {
					write: {
						...written,
						inputs: [{ name: "label", type: "text", default: "news" }],
					},
					look: lookFlow("true"),
				},
			},
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.sub).toMatchObject({
			outcome: "pass",
			ended: "done",
			end_message: "Found it",
			end_report: "## Found\n\nnews",
		});
		expect(driven.state.nodes.bare).toMatchObject({
			ended: "nothing-to-do",
			end_report: "",
		});
	});

	test("in a Call with each, a failed End fails the element and the others go on", async () => {
		const h = await startRun(
			sandbox,
			flowOf([
				{
					id: "all",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "pick",
					inputs: {},
					each: {
						source: { kind: "json", value: '["a","b"]' },
						as: "item",
						branch: "shared",
					},
				},
			]),
			{
				flows: {
					pick: flowOf(
						[
							{
								id: "which",
								type: "decision",
								position: { x: 0, y: 0 },
								by: "rule",
								prompt: "",
								options: [
									{ name: "bad", when: 'item = "a"' },
									{ name: "good" },
								],
							},
							end("no", "failed", "Item {{item}} is bad"),
							end("yes", "done"),
						],
						[
							edge("p1", "which", "bad", "no"),
							edge("p2", "which", "good", "yes"),
						],
						{ inputs: [{ name: "item", type: "json" }] },
					),
				},
			},
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.all).toMatchObject({
			outcome: "done",
			done_count: 1,
			failed_count: 1,
		});
		expect(
			payloads(await h.events(), "ItemEnded").map((p) => [p.state, p.reason]),
		).toEqual([
			["failed", "Item a is bad"],
			["done", null],
		]);
	});
});
