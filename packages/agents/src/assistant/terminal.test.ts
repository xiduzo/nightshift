import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	type Flow,
	type FlowIssue,
	flowSchema,
	type ProjectFlowMap,
} from "@nightshift/flows";
import { serveTools } from "./mcp";
import { type TerminalPort, terminalTools } from "./terminal";

const flow: Flow = flowSchema.parse({
	version: 7,
	inputs: [{ name: "issue", type: "text" }],
	outputs: [],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: "mac", profile: "worker" },
			prompt: "Fix {{issue}}.",
		},
	],
	edges: [],
});

/** Night Shift in memory: two projects, flows saved in a map. */
function fakePort(
	overrides: Partial<TerminalPort> = {},
): TerminalPort & { saved: Record<string, ProjectFlowMap> } {
	const saved: Record<string, ProjectFlowMap> = {
		p1: { existing: flow },
		p2: {},
	};
	return {
		saved,
		projects: async () => [
			{ id: "p1", name: "App", path: "/work/app" },
			{ id: "p2", name: "Site", path: "/work/site" },
		],
		flows: async (projectId) => ({ ...saved[projectId] }),
		profiles: async () => [
			{ name: "worker", harness: "claude-code", model: "sonnet" },
		],
		tools: async () => ({ clis: [], connections: [] }),
		skills: async () => [],
		saveFlow: async (projectId, name, next): Promise<FlowIssue[]> => {
			saved[projectId] = { ...saved[projectId], [name]: next };
			return [];
		},
		startRun: async () => ({ id: "run-1", status: "running" }),
		runs: async () => [],
		run: async () => null,
		runLink: (id) => `http://localhost:9/runs/${id}`,
		flowLink: (p, name) => `http://localhost:9/projects/${p}/flows/${name}`,
		...overrides,
	};
}

async function connect(
	port: TerminalPort,
	options: Parameters<typeof terminalTools>[1] = {},
) {
	const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
	await serveTools(
		terminalTools(port, options),
		{ name: "nightshift", version: "0" },
		serverEnd,
	);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientEnd);
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const result = await client.callTool({ name, arguments: args });
		const content = result.content as { type: string; text: string }[];
		return {
			text: content.map((c) => c.text).join("\n"),
			isError: result.isError === true,
		};
	};
	return { client, call };
}

describe("nightshift mcp tools", () => {
	test("lists the terminal tool set: no draft, no proposal", async () => {
		const { client } = await connect(fakePort());
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		expect(names).toEqual([
			"check_flow",
			"get_flow",
			"get_run",
			"list_flows",
			"list_profiles",
			"list_projects",
			"list_runs",
			"list_skills",
			"list_tools",
			"save_flow",
			"start_run",
		]);
	});

	test("check_flow, save_flow and get_flow round trip in the folder's project", async () => {
		const port = fakePort();
		const { call } = await connect(port, { folder: "/work/site/src" });
		const fresh = { ...flow, description: "Fixes an issue" };
		expect((await call("check_flow", { flow: fresh })).text).toBe("No issues.");
		const saved = await call("save_flow", { name: "fix", flow: fresh });
		expect(saved.isError).toBe(false);
		expect(saved.text).toContain('Saved the flow "fix" in "Site"');
		expect(port.saved.p2?.fix?.description).toBe("Fixes an issue");
		const read = await call("get_flow", { name: "fix" });
		expect(JSON.parse(read.text).description).toBe("Fixes an issue");
		expect((await call("list_projects")).text).toContain('"current": true');
	});

	test("save_flow refuses a flow with errors and saves nothing", async () => {
		const port = fakePort();
		const { call } = await connect(port, { project: "App" });
		const broken = {
			...flow,
			nodes: [{ ...flow.nodes[0], profile: "nobody" }],
		};
		const result = await call("save_flow", { name: "broken", flow: broken });
		expect(result.text).toStartWith("Refused: the flow has errors.");
		expect(result.text).toContain("nobody");
		expect(port.saved.p1?.broken).toBeUndefined();
		const notAFlow = await call("save_flow", { name: "x", flow: { a: 1 } });
		expect(notAFlow.text).toStartWith("Refused");
	});

	test("without a project of the folder it asks for one", async () => {
		const { call } = await connect(fakePort(), { folder: "/elsewhere" });
		const result = await call("list_flows");
		expect(result.isError).toBe(true);
		expect(result.text).toContain("list_projects");
		const named = await call("list_flows", { project: "p1" });
		expect(named.text).toContain('"existing"');
	});

	test("start_run gives the run's id and its link", async () => {
		const { call } = await connect(fakePort(), { project: "p1" });
		const result = await call("start_run", {
			flow: "existing",
			inputs: { issue: "Fix the login" },
		});
		expect(result.text).toBe(
			'Started run run-1 of "existing" (running). Follow it at http://localhost:9/runs/run-1',
		);
	});

	test("a port that fails answers with its words as an error", async () => {
		const down =
			"Night Shift is not running on this computer. Start it, then try again.";
		const { call } = await connect(
			fakePort({
				projects: async () => {
					throw new Error(down);
				},
			}),
		);
		const result = await call("list_flows");
		expect(result).toEqual({ text: down, isError: true });
	});
});
