import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type ConvertNode,
	type ValueNode,
	valuePreset,
} from "@nightshift/flows";
import { foldRun } from "../log";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/run-views";
import { command, drive, flowOf, payloads, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * The Convert node on the compiled graph, with a real run log: it reads
 * its value, converts it with no Device and no shell, and ends `pass` with
 * `data` or `text`, or `fail` with why in `note`. A Value preset after it
 * reads the rows it made.
 */

const convert = (extra: Partial<ConvertNode> = {}): ConvertNode => ({
	id: "rows",
	type: "convert",
	position: { x: 0, y: 0 },
	from: "csv",
	to: "json",
	value: "{{sheet}}",
	...extra,
});

/** A flow: the Convert node, then `done` on pass and `again` on fail. */
const around = (node: ConvertNode, inputType: "text" | "json" = "text") =>
	flowOf({
		inputs: [{ name: "sheet", type: inputType }],
		start: node.id,
		nodes: [node, command("done", "true"), command("again", "true")],
		edges: [
			{ id: "ok", from: node.id, outcome: "pass", to: "done" },
			{ id: "no", from: node.id, outcome: "fail", to: "again" },
		],
	});

const SHEET = "name,city\nAnn,Oslo\nBo,Rome\n";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the Convert node", () => {
	test("reads CSV into rows: the log, the transcript, the state and the edge, with no wait node", async () => {
		const h = await startRun(sandbox, around(convert()));
		expect(h.graph().getGraph().nodes).not.toHaveProperty("wait__rows");
		const { parked, state } = await drive(h, { inputs: { sheet: SHEET } });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("done");
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "rows",
			nodeType: "convert",
			logPath: null,
		});
		const rows = [
			{ name: "Ann", city: "Oslo" },
			{ name: "Bo", city: "Rome" },
		];
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "pass",
			outputs: { outcome: "pass", data: rows, text: "", note: "", visit: 1 },
			error: null,
		});
		const [step] = deriveSteps(foldRun(logged));
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((entry) => entry.event)).toEqual([
			{ type: "convert", from: "csv", to: "json", bytes: 27, problem: null },
		]);
	});

	test("from JSON, one reference keeps its value, and the text comes out as text", async () => {
		const node = convert({ from: "json", to: "markdown-table" });
		const h = await startRun(sandbox, around(node, "json"));
		const { state } = await drive(h, {
			inputs: { sheet: [{ name: "Ann" }, { name: "Bo" }] },
		});
		expect(state.nodes.rows).toEqual({
			outcome: "pass",
			data: null,
			text: "| name |\n| ---- |\n| Ann  |\n| Bo   |",
			note: "",
			visit: 1,
		});
	});

	test("a value that does not fit its format fails the step, with why in the note, and takes the fail edge", async () => {
		const h = await startRun(sandbox, around(convert({ from: "feed" })));
		const { state } = await drive(h, { inputs: { sheet: SHEET } });
		expect(state.ended?.nodeId).toBe("again");
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				data: null,
				text: "",
				note: "The value is not an RSS, Atom or JSON feed.",
				visit: 1,
			},
			error: null,
		});
	});

	test("a value past the size limit fails before it is read", async () => {
		const h = await startRun(sandbox, around(convert({ maxBytes: 10 })));
		const { state } = await drive(h, { inputs: { sheet: SHEET } });
		expect(state.nodes.rows?.note).toBe(
			"The value has 27 bytes, and this node reads at most 10 bytes. Send less, or raise its size limit.",
		);
	});

	test("a confirmed output schema fails data that does not match; an inferred one leaves it to the format's shape", async () => {
		const output = {
			type: "array",
			items: { type: "object", required: ["email"] },
		};
		const confirmed = await startRun(sandbox, around(convert({ output })));
		const strict = await drive(confirmed, { inputs: { sheet: SHEET } });
		expect(strict.state.nodes.rows?.outcome).toBe("fail");
		expect(strict.state.nodes.rows?.note).toBe(
			"The data does not match the output schema: data/0 must have required property 'email'; data/1 must have required property 'email'.",
		);
		const inferred = await startRun(
			sandbox,
			around(convert({ output, outputInferred: true })),
		);
		const loose = await drive(inferred, { inputs: { sheet: SHEET } });
		expect(loose.state.nodes.rows?.outcome).toBe("pass");
	});

	test("a Value preset reads the rows a Convert node made", async () => {
		const preset = valuePreset(
			{
				preset: "filter",
				source: "rows.data",
				field: "city",
				compare: "equals",
				value: "Rome",
			},
			{ type: "object", additionalProperties: { type: "string" } },
		);
		const value: ValueNode = {
			id: "rome",
			type: "value",
			position: { x: 0, y: 0 },
			by: "rule",
			...preset,
		};
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "sheet", type: "text" }],
				start: "rows",
				nodes: [convert(), value],
				edges: [{ id: "next", from: "rows", outcome: "pass", to: "rome" }],
			}),
		);
		const { state } = await drive(h, { inputs: { sheet: SHEET } });
		expect(state.nodes.rome).toEqual({
			outcome: "pass",
			data: { items: [{ name: "Bo", city: "Rome" }] },
			note: "",
			visit: 1,
		});
	});
});
