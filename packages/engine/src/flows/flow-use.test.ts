import { describe, expect, test } from "bun:test";
import type { LoadedFlow } from "@nightshift/flows";

import { type FlowReader, flowUse } from "./flow-use";

const project = (id: string, name: string) => ({ id, name });

/** A loaded flow with these nodes. The rest of the flow does not matter here. */
const loaded = (name: string, nodes: unknown[]) =>
	({
		name,
		path: `/${name}.json`,
		flow: { nodes },
		issues: [],
	}) as never as LoadedFlow;

describe("flowUse", () => {
	test("finds the flows that name each connection, CLI tool and profile", async () => {
		const flows: Record<string, LoadedFlow> = {
			night: loaded("night", [
				{
					id: "plan",
					type: "agent",
					connections: ["gh"],
					clis: ["jq"],
					profile: "fast",
				},
				{ id: "fix", type: "agent", connections: ["gh"], profile: "fast" },
				{ id: "file", type: "tool", connection: "linear" },
			]),
			day: loaded("day", [{ id: "a", type: "agent", profile: "slow" }]),
		};
		const reader: FlowReader = {
			listProjects: async () => [project("p1", "App"), project("p2", "Site")],
			listFlows: async (projectId) => {
				if (projectId === "p2") throw new Error("not on this computer");
				return [
					{
						name: "night",
						path: "",
						description: null,
						nodeCount: 3,
						errorCount: 0,
					},
					{
						name: "day",
						path: "",
						description: null,
						nodeCount: 1,
						errorCount: 0,
					},
					{
						name: "broken",
						path: "",
						description: null,
						nodeCount: null,
						errorCount: 1,
					},
				];
			},
			getFlow: async (_projectId, name) => {
				const flow = flows[name];
				if (!flow) throw new Error("does not parse");
				return flow;
			},
		};
		const use = await flowUse(reader);
		const night = { projectId: "p1", projectName: "App", flowName: "night" };
		expect(use.connections.get("gh")).toEqual([night]);
		expect(use.connections.get("linear")).toEqual([night]);
		expect(use.clis.get("jq")).toEqual([night]);
		expect(use.profiles.get("fast")).toEqual([
			{ ...night, nodeIds: ["plan", "fix"] },
		]);
		expect(use.profiles.get("slow")).toEqual([
			{ projectId: "p1", projectName: "App", flowName: "day", nodeIds: ["a"] },
		]);
		expect([...use.connections.keys()].sort()).toEqual(["gh", "linear"]);
	});
});
