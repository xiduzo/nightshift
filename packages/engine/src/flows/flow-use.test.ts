import { describe, expect, test } from "bun:test";
import type { LoadedFlow } from "@nightshift/flows";

import { type FlowReader, flowUse, profileUseKey } from "./flow-use";

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
	test("finds the flows that name each connection, CLI tool, secret, and each Device's profile", async () => {
		const flows: Record<string, LoadedFlow> = {
			night: loaded("night", [
				{
					id: "plan",
					type: "agent",
					connections: ["gh"],
					clis: ["jq"],
					profile: { device: "mac", profile: "fast" },
				},
				{
					id: "fix",
					type: "agent",
					connections: ["gh"],
					profile: { device: "mac", profile: "fast" },
				},
				// The same profile id on another Device is another profile.
				{
					id: "far",
					type: "agent",
					profile: { device: "le2316", profile: "fast" },
				},
				// A name left from format 6 names no profile yet.
				{ id: "old", type: "agent", profile: "fast" },
				{ id: "file", type: "tool", connection: "linear" },
				{ id: "login", type: "command", secrets: ["ZAC_USER", "ZAC_PW"] },
				{ id: "again", type: "command", secrets: ["ZAC_USER"] },
			]),
			day: loaded("day", [
				{ id: "a", type: "agent", profile: { device: "mac", profile: "slow" } },
				{ id: "check", type: "command" },
			]),
		};
		const reader: FlowReader = {
			listProjects: async () => [project("p1", "App"), project("p2", "Site")],
			flows: {
				list: async (projectId) => {
					if (projectId === "p2") throw new Error("not on this computer");
					return [
						{
							name: "night",
							path: "",
							description: null,
							nodeCount: 3,
							errorCount: 0,
							inputs: [],
							callers: [],
							devices: { names: [], ids: [] },
							nodeTypes: [],
							gateCount: 0,
						},
						{
							name: "day",
							path: "",
							description: null,
							nodeCount: 1,
							errorCount: 0,
							inputs: [],
							callers: [],
							devices: { names: [], ids: [] },
							nodeTypes: [],
							gateCount: 0,
						},
						{
							name: "broken",
							path: "",
							description: null,
							nodeCount: null,
							errorCount: 1,
							inputs: [],
							callers: [],
							devices: { names: [], ids: [] },
							nodeTypes: [],
							gateCount: 0,
						},
					];
				},
				get: async (_projectId, name) => {
					const flow = flows[name];
					if (!flow) throw new Error("does not parse");
					return flow;
				},
			},
		};
		const use = await flowUse(reader);
		const night = { projectId: "p1", projectName: "App", flowName: "night" };
		expect(use.connections.get("gh")).toEqual([night]);
		expect(use.connections.get("linear")).toEqual([night]);
		expect(use.clis.get("jq")).toEqual([night]);
		expect(use.secrets.get("ZAC_USER")).toEqual([night]);
		expect(use.secrets.get("ZAC_PW")).toEqual([night]);
		expect(use.secrets.size).toBe(2);
		expect(use.profiles.get(profileUseKey("mac", "fast"))).toEqual([
			{ ...night, nodeIds: ["plan", "fix"] },
		]);
		expect(use.profiles.get(profileUseKey("le2316", "fast"))).toEqual([
			{ ...night, nodeIds: ["far"] },
		]);
		expect(use.profiles.size).toBe(3);
		expect(use.profiles.get(profileUseKey("mac", "slow"))).toEqual([
			{ projectId: "p1", projectName: "App", flowName: "day", nodeIds: ["a"] },
		]);
		expect([...use.connections.keys()].sort()).toEqual(["gh", "linear"]);
	});
});
