import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import { deriveSteps } from "../read/derive-steps";
import { command, drive, edge, flowOf, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { compileFlow } from "./compile";

/**
 * Sections are for the editor only: the LangGraph compile and the run do
 * not read them. A flow with Sections compiles to the same graph and runs
 * the same steps as the flow without.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const plain = flowOf(
	[command("build", "true"), command("check", "true"), command("fix", "true")],
	[edge("e1", "build", "pass", "check"), edge("e2", "check", "fail", "fix")],
);
const sectioned: Flow = {
	...plain,
	sections: [
		{ id: "make", label: "Make", color: "blue", nodes: ["build", "check"] },
		// A Section that is not valid changes nothing either.
		{ id: "odd", label: "Odd", nodes: ["fix", "nowhere"] },
	],
};

/** The compiled graph's nodes and edges, as LangGraph draws them. */
async function shape(flow: Flow, ctx: Parameters<typeof compileFlow>[1]) {
	const graph = await compileFlow(flow, ctx).compile().getGraphAsync();
	return {
		nodes: Object.keys(graph.nodes).sort(),
		edges: graph.edges
			.map((e) => `${e.source}->${e.target}${e.conditional ? "?" : ""}`)
			.sort(),
	};
}

describe("Sections", () => {
	test("compile to the same graph", async () => {
		const h = await startRun(sandbox, sectioned);
		expect(await shape(sectioned, h.ctx)).toEqual(await shape(plain, h.ctx));
	});

	test("run the same steps", async () => {
		const runOf = async (flow: Flow) => {
			const h = await startRun(sandbox, flow);
			const { parked, next } = await drive(h, { inputs: {} });
			const events = await h.events();
			return {
				parked,
				next,
				types: events.map((e) => e.type),
				steps: deriveSteps(events).map((s) => [s.nodeId, s.outcome]),
			};
		};
		const withSections = await runOf(sectioned);
		expect(withSections.steps).toEqual([
			["build", "pass"],
			["check", "pass"],
		]);
		expect(withSections).toEqual(await runOf(plain));
	});
});
