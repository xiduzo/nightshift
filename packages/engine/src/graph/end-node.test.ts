import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndNode } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Capabilities, Device } from "../device";
import { foldRun } from "../log";

import { readTranscriptFile } from "../log/transcripts";
import { refusalOf } from "../placement";
import { deriveSteps } from "../read/run-views";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	placementOn,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
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
