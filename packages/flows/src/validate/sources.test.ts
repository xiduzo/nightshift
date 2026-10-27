import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	singleAgentFlow,
} from "../document";
import {
	callersOf,
	canonicalFlowJson,
	type FlowSources,
	listFlowSources,
	loadFlowSource,
	parsedFlows,
	scheduleFlowInfos,
} from "./sources";

const quick = (): Flow =>
	flowSchema.parse({
		...singleAgentFlow({
			prompt: "Fix it",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
		description: "A quick fix",
		inputs: [{ name: "issue", type: "text", required: true }],
	});

const unbounded = (): Flow => ({
	...quick(),
	edges: [{ id: "again", from: "agent", outcome: "fail", to: "agent" }],
});

/** A flow whose one node calls `quick`. */
const caller = (): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		description: "Calls quick",
		start: "call",
		nodes: [
			{
				id: "call",
				type: "call",
				position: { x: 0, y: 0 },
				flow: "quick",
				inputs: { issue: "1" },
			},
		],
		edges: [],
	});

const sources = (): FlowSources => ({
	zeta: { json: caller() },
	quick: { json: quick() },
	broken: { jsonError: "Unexpected token" },
	alpha: { json: unbounded() },
});

const pathOf = (name: string) => `/repo/${name}.json`;

describe("listFlowSources", () => {
	test("lists every flow sorted by name, with its errors, inputs and callers", () => {
		expect(listFlowSources(sources(), pathOf)).toEqual([
			{
				name: "alpha",
				path: "/repo/alpha.json",
				description: "A quick fix",
				nodeCount: 1,
				errorCount: 1,
				inputs: quick().inputs,
				callers: [],
			},
			{
				name: "broken",
				path: "/repo/broken.json",
				description: null,
				nodeCount: null,
				errorCount: 1,
				inputs: [],
				callers: [],
			},
			{
				name: "quick",
				path: "/repo/quick.json",
				description: "A quick fix",
				nodeCount: 1,
				errorCount: 0,
				inputs: quick().inputs,
				callers: ["zeta"],
			},
			{
				name: "zeta",
				path: "/repo/zeta.json",
				description: "Calls quick",
				nodeCount: 1,
				errorCount: 0,
				inputs: [],
				callers: [],
			},
		]);
	});

	test("no sources is an empty list", () => {
		expect(listFlowSources({}, pathOf)).toEqual([]);
	});
});

describe("loadFlowSource", () => {
	test("loads one flow and checks its calls against the other sources", () => {
		const loaded = loadFlowSource(sources(), "zeta", pathOf);
		expect(loaded).toMatchObject({
			name: "zeta",
			path: "/repo/zeta.json",
			flow: caller(),
		});
		expect(loaded.issues.filter((i) => i.severity === "error")).toEqual([]);
	});

	test("a call of a flow that is not in the sources is an error", () => {
		const { quick: _gone, ...rest } = sources();
		const loaded = loadFlowSource(rest, "zeta", pathOf);
		expect(loaded.issues.filter((i) => i.severity === "error")).toEqual([
			expect.objectContaining({ nodeId: "call" }),
		]);
	});

	test("a source that is not JSON loads with flow null and one issue", () => {
		expect(loadFlowSource(sources(), "broken", pathOf)).toEqual({
			name: "broken",
			path: "/repo/broken.json",
			flow: null,
			issues: [
				{ severity: "error", message: "Not valid JSON: Unexpected token" },
			],
		});
	});

	test("refuses a missing flow as not found, in words for people", () => {
		let error: unknown;
		try {
			loadFlowSource(sources(), "missing", pathOf);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Refusal);
		expect(error).toMatchObject({
			kind: "not-found",
			message: 'The flow "missing" does not exist.',
		});
	});
});

describe("parsedFlows", () => {
	test("gives each source its flow, and null when it does not parse", () => {
		expect(
			parsedFlows({ ...sources(), shape: { json: { nodes: "no" } } }),
		).toEqual({
			alpha: unbounded(),
			broken: null,
			quick: quick(),
			shape: null,
			zeta: caller(),
		});
	});
});

describe("scheduleFlowInfos", () => {
	test("gives each flow its inputs and its error count, and null when it does not parse", () => {
		expect(scheduleFlowInfos(sources())).toEqual({
			alpha: { inputs: quick().inputs, errorCount: 1 },
			broken: null,
			quick: { inputs: quick().inputs, errorCount: 0 },
			zeta: { inputs: [], errorCount: 0 },
		});
	});
});

describe("callersOf", () => {
	test("names the other flows that call the flow, sorted, and never the flow itself", () => {
		expect(
			callersOf("quick", {
				zeta: caller(),
				quick: caller(),
				beta: caller(),
				broken: null,
			}),
		).toEqual(["beta", "zeta"]);
	});
});

describe("canonicalFlowJson", () => {
	test("is pretty JSON of the current version with a trailing newline", () => {
		const flow = { ...quick(), version: 1 } as unknown as Flow;
		expect(canonicalFlowJson(flow)).toBe(
			`${JSON.stringify({ ...flow, version: FLOW_VERSION }, null, "\t")}\n`,
		);
	});
});
