import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema, singleAgentFlow } from "../flow";
import type { FlowSources } from "../validate";
import { scheduleFlowInfos } from "./flow-infos";

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
