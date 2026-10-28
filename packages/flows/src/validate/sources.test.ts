import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	singleAgentFlow,
} from "../document";
import { flowNameSchema } from "../nodes";
import {
	callersOf,
	canonicalFlowJson,
	devicesOf,
	type FlowSources,
	flowNameOfFile,
	listFlowSources,
	loadFlowSource,
	parsedFlows,
	scheduleFlowInfos,
	suffixedName,
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
				devices: { names: [], ids: [] },
			},
			{
				name: "broken",
				path: "/repo/broken.json",
				description: null,
				nodeCount: null,
				errorCount: 1,
				inputs: [],
				callers: [],
				devices: { names: [], ids: [] },
			},
			{
				name: "quick",
				path: "/repo/quick.json",
				description: "A quick fix",
				nodeCount: 1,
				errorCount: 0,
				inputs: quick().inputs,
				callers: ["zeta"],
				devices: { names: [], ids: [] },
			},
			{
				name: "zeta",
				path: "/repo/zeta.json",
				description: "Calls quick",
				nodeCount: 1,
				errorCount: 0,
				inputs: [],
				callers: [],
				devices: { names: [], ids: [] },
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

describe("devicesOf", () => {
	const placed = (device: string): Flow => ({
		...quick(),
		nodes: quick().nodes.map((node) => ({ ...node, device })),
	});
	const profiled = (): Flow => ({
		...quick(),
		nodes: quick().nodes.map((node) => ({
			...node,
			device: "ignored",
			profile: { device: "device-id", profile: "p1" },
		})),
	});

	test("names the Devices of the flow and of the flows it calls, once each, sorted", () => {
		expect(
			devicesOf("zeta", { zeta: caller(), quick: placed("studio") }),
		).toEqual({ names: ["studio"], ids: [] });
		expect(devicesOf("quick", { quick: placed("hetzner-1") })).toEqual({
			names: ["hetzner-1"],
			ids: [],
		});
	});

	test("a node's profile names its Device by id, not the node's device", () => {
		expect(devicesOf("quick", { quick: profiled() })).toEqual({
			names: [],
			ids: ["device-id"],
		});
	});

	test("a flow that names no Device, or does not load, needs none", () => {
		expect(devicesOf("quick", { quick: quick() })).toEqual({
			names: [],
			ids: [],
		});
		expect(devicesOf("broken", { broken: null })).toEqual({
			names: [],
			ids: [],
		});
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

describe("suffixedName", () => {
	test("keeps a name that no flow has", () => {
		expect(suffixedName("quick", new Set(["other"]))).toBe("quick");
	});

	test("gives a taken name the first free number from 2", () => {
		expect(suffixedName("quick", new Set(["quick"]))).toBe("quick-2");
		expect(suffixedName("quick", new Set(["quick", "quick-2"]))).toBe(
			"quick-3",
		);
	});

	test("cuts a long name, so the result is still a flow name", () => {
		const long = `${"a".repeat(57)}-bc`;
		const name = suffixedName(long, new Set([long]));
		expect(name).toBe(`${"a".repeat(57)}-2`);
		expect(flowNameSchema.safeParse(name).success).toBe(true);
	});
});

describe("the flow name a file suggests", () => {
	test("is the file name without .json, as a flow name", () => {
		expect(flowNameOfFile("build.json")).toBe("build");
		expect(flowNameOfFile("Build Check.JSON")).toBe("build-check");
		expect(flowNameOfFile("--nightly_run (2).json")).toBe("nightly-run-2");
	});

	test("is cut to the longest flow name, without a dash at the end", () => {
		const name = flowNameOfFile(`${"a".repeat(59)} b.json`);
		expect(name).toBe("a".repeat(59));
	});

	test("is a fixed name when the file name holds no letter or digit", () => {
		expect(flowNameOfFile("___.json")).toBe("imported-flow");
		expect(flowNameOfFile(".json")).toBe("imported-flow");
	});
});
