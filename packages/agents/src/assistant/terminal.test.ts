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
import type { TerminalGate, TerminalRunSummary } from "./terminal-runs";

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
			{
				device: "mac",
				profile: "worker",
				name: "worker",
				deviceName: "MacBook",
				kind: "agent",
				harness: "claude-code",
				model: "sonnet",
			},
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
		stopRun: async () => {},
		gates: async () => [],
		answerGate: async () => {},
		digest: async () => null,
		searchKnowledge: async () => [],
		readKnowledge: async () => null,
		runLink: (id, step) =>
			`http://localhost:9/runs/${id}${step ? `?step=${step}` : ""}`,
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
			"answer_gate",
			"check_flow",
			"get_digest",
			"get_flow",
			"get_run",
			"list_flows",
			"list_profiles",
			"list_projects",
			"list_runs",
			"list_skills",
			"list_tools",
			"needs_me",
			"read_knowledge",
			"save_flow",
			"search_knowledge",
			"start_run",
			"stop_run",
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

	test("list_profiles names each profile with its device, and check_flow refuses a pair it does not list", async () => {
		const { call } = await connect(fakePort(), { project: "App" });
		const listed = JSON.parse((await call("list_profiles")).text);
		expect(listed).toEqual([
			expect.objectContaining({
				device: "mac",
				profile: "worker",
				deviceName: "MacBook",
			}),
		]);
		const elsewhere = {
			...flow,
			nodes: [
				{ ...flow.nodes[0], profile: { device: "le2316", profile: "worker" } },
			],
		};
		expect((await call("check_flow", { flow: elsewhere })).text).toContain(
			'There is no profile "worker" on the device "le2316". Use a device and a profile from list_profiles.',
		);
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

const HOUR = 60 * 60_000;
const NOW = Date.UTC(2026, 9, 30, 8);

function summary(
	id: string,
	over: Partial<TerminalRunSummary> = {},
): TerminalRunSummary {
	return {
		id,
		flowName: "existing",
		title: `existing · ${id}`,
		status: "finished",
		reason: null,
		createdAt: NOW - HOUR,
		endedAt: NOW - HOUR / 2,
		cost: { usd: 1.5, estimated: false, missing: 0, calls: 2, basis: null },
		prUrl: null,
		...over,
	};
}

function gate(over: Partial<TerminalGate> = {}): TerminalGate {
	return {
		runId: "run-1",
		stepId: "step-1",
		projectId: "p1",
		projectName: "App",
		flowName: "existing",
		runTitle: "existing · login",
		question: "Merge the pull request?",
		choices: [
			{ name: "merge", description: "Merge it" },
			{ name: "change", needsNote: true },
		],
		openedAt: NOW - 2 * HOUR,
		deadline: null,
		canAnswer: true,
		answerPending: false,
		...over,
	};
}

describe("the run tools of nightshift mcp", () => {
	test("list_runs filters by status and start time, with cost and pull request", async () => {
		const asked: unknown[] = [];
		const { call } = await connect(
			fakePort({
				runs: async (_project, query) => {
					asked.push(query);
					return [
						summary("new", {
							prUrl: "https://github.com/acme/app/pull/7",
							cost: {
								usd: 0.4,
								estimated: true,
								missing: 0,
								calls: 1,
								basis: "estimated",
							},
						}),
						summary("old", { createdAt: NOW - 30 * HOUR }),
					];
				},
			}),
			{ project: "p1", now: () => NOW },
		);
		const result = await call("list_runs", {
			status: ["finished", "failed"],
			since: "1d",
		});
		expect(asked).toEqual([{ limit: 10, statuses: ["finished", "failed"] }]);
		expect(JSON.parse(result.text)).toEqual([
			{
				id: "new",
				flowName: "existing",
				title: "existing · new",
				status: "finished",
				reason: null,
				createdAt: new Date(NOW - HOUR).toISOString(),
				endedAt: new Date(NOW - HOUR / 2).toISOString(),
				cost: "about $0.40",
				prUrl: "https://github.com/acme/app/pull/7",
			},
		]);
		const wrong = await call("list_runs", { status: "done" });
		expect(wrong.isError).toBe(true);
		expect(wrong.text).toContain("running, waiting, sleeping");
		const nothing = await call("list_runs", {
			since: "2026-10-30T07:59:00Z",
		});
		expect(nothing.text).toBe('The project "App" has no runs like that.');
	});

	test("get_run says the cost, the pull request and where to open it", async () => {
		const { call } = await connect(
			fakePort({
				run: async (_project, runId) => ({
					run: {
						id: runId,
						status: "finished",
						reason: null,
						inputs: { issue: "login" },
						flow,
						steps: [],
						failedStepId: null,
						transcript: [],
					},
					flowName: "existing",
					cost: {
						usd: 2,
						estimated: false,
						missing: 1,
						calls: 3,
						basis: "unknown",
					},
					prUrl: "https://github.com/acme/app/pull/7",
				}),
			}),
			{ project: "p1" },
		);
		const lines = (await call("get_run", { run: "run-1" })).text.split("\n");
		const status = lines.findIndex((l) => l.startsWith("Status:"));
		expect(lines.slice(status, status + 4)).toEqual([
			"Status: finished",
			"Cost: at least $2.00",
			"Pull request: https://github.com/acme/app/pull/7",
			"Open it at http://localhost:9/runs/run-1",
		]);
	});

	test("stop_run stops now or after the step", async () => {
		const stops: unknown[] = [];
		const { call } = await connect(
			fakePort({
				stopRun: async (runId, when) => {
					stops.push([runId, when]);
				},
			}),
		);
		expect((await call("stop_run", { run: "run-1" })).text).toBe(
			"Night Shift stops run run-1 now.",
		);
		expect(
			(await call("stop_run", { run: "run-2", when: "after-step" })).text,
		).toBe("Run run-2 stops when the step that runs now ends.");
		expect((await call("stop_run", { run: "x", when: "later" })).isError).toBe(
			true,
		);
		expect(stops).toEqual([
			["run-1", "now"],
			["run-2", "after-step"],
		]);
	});

	test("needs_me lists the Gates that wait in every project, with their options", async () => {
		const { call } = await connect(
			fakePort({
				gates: async () => [
					gate({
						deadline: { at: NOW + HOUR, choose: "merge" },
					}),
					gate({ runId: "run-2", projectId: "p2", projectName: "Site" }),
					gate({ runId: "run-3", answerPending: true }),
				],
			}),
			{ folder: "/work/app" },
		);
		const all = JSON.parse((await call("needs_me")).text);
		expect(all.map((g: { gate: string }) => g.gate)).toEqual([
			"run-1:step-1",
			"run-2:step-1",
		]);
		expect(all[0]).toEqual({
			gate: "run-1:step-1",
			project: "App",
			flow: "existing",
			run: "existing · login",
			question: "Merge the pull request?",
			options: [
				{ option: "merge", description: "Merge it" },
				{ option: "change", needsNote: true },
			],
			waitingSince: new Date(NOW - 2 * HOUR).toISOString(),
			deadline: `Night Shift chooses "merge" at ${new Date(NOW + HOUR).toISOString()} when nobody answers.`,
			open: "http://localhost:9/runs/run-1?step=step-1",
		});
		const site = JSON.parse((await call("needs_me", { project: "Site" })).text);
		expect(site.map((g: { gate: string }) => g.gate)).toEqual(["run-2:step-1"]);
	});

	test("answer_gate sends one of the Gate's options, with a note when it needs one", async () => {
		const answers: unknown[] = [];
		const { call } = await connect(
			fakePort({
				gates: async () => [gate(), gate({ runId: "run-2", canAnswer: false })],
				answerGate: async (answer) => {
					answers.push(answer);
				},
			}),
		);
		const done = await call("answer_gate", {
			gate: "run-1:step-1",
			option: "Merge",
		});
		expect(done).toEqual({
			text: 'Answered "merge" to the Gate of "existing · login". The run continues. Follow it at http://localhost:9/runs/run-1?step=step-1',
			isError: false,
		});
		const noNote = await call("answer_gate", {
			gate: "run-1:step-1",
			option: "change",
		});
		expect(noNote.isError).toBe(true);
		expect(noNote.text).toContain("needs a note");
		await call("answer_gate", {
			gate: "run-1:step-1",
			option: "change",
			note: " Rename the button. ",
		});
		const unknown = await call("answer_gate", {
			gate: "run-1:step-1",
			option: "ship",
		});
		expect(unknown.text).toBe(
			'"ship" is not an option of this Gate. Choose one of: "merge", "change".',
		);
		expect(
			(await call("answer_gate", { gate: "run-9:step-1", option: "merge" }))
				.text,
		).toBe(
			"This Gate does not wait anymore. Call needs_me for the Gates that wait.",
		);
		expect(
			(await call("answer_gate", { gate: "run-2:step-1", option: "merge" }))
				.text,
		).toContain("Your role in this Space does not let you answer Gates.");
		expect(
			(await call("answer_gate", { gate: "run-1", option: "x" })).text,
		).toBe("Give the Gate's id in `gate`, as needs_me gives it.");
		expect(answers).toEqual([
			{ runId: "run-1", stepId: "step-1", choice: "merge" },
			{
				runId: "run-1",
				stepId: "step-1",
				choice: "change",
				note: "Rename the button.",
			},
		]);
	});

	test("get_digest says what happened since a time, or since the last digest", async () => {
		const asked: unknown[] = [];
		const { call } = await connect(
			fakePort({
				digest: async (since) => {
					asked.push(since);
					if (since === NOW) return null;
					return {
						from: since ?? NOW - 10 * HOUR,
						body: "1 run finished, 1 failed. About $1.40 spent. 1 Gate waits for you.",
						runs: [
							{
								runId: "run-1",
								title: "existing · login",
								statusText: "Finished",
								detail: "$1.00",
								prUrl: "https://github.com/acme/app/pull/7",
							},
							{
								runId: "run-2",
								title: "existing · site",
								statusText: "Failed",
								detail: "about $0.40 · The tests failed.",
								prUrl: null,
							},
						],
						gates: [
							{ runId: "run-3", stepId: "step-1", title: "existing · menu" },
						],
					};
				},
			}),
			{ now: () => NOW },
		);
		expect((await call("get_digest")).text).toBe(
			[
				`Since ${new Date(NOW - 10 * HOUR).toISOString()}: 1 run finished, 1 failed. About $1.40 spent. 1 Gate waits for you.`,
				"",
				"Runs:",
				"- existing · login (run run-1): Finished · $1.00 · Pull request: https://github.com/acme/app/pull/7",
				"- existing · site (run run-2): Failed · about $0.40 · The tests failed.",
				"",
				"Gates that wait (needs_me has their questions):",
				"- existing · menu (gate run-3:step-1)",
			].join("\n"),
		);
		await call("get_digest", { since: "12h" });
		expect((await call("get_digest", { since: "0h" })).text).toBe(
			`No run ended since ${new Date(NOW).toISOString()}, and no Gate waits.`,
		);
		expect(asked).toEqual([undefined, NOW - 12 * HOUR, NOW]);
		expect((await call("get_digest", { since: "yesterday" })).isError).toBe(
			true,
		);
	});
});

describe("the knowledge tools", () => {
	test("search_knowledge gives the paths, titles and excerpts in the folder's project", async () => {
		const asked: unknown[] = [];
		const { call } = await connect(
			fakePort({
				searchKnowledge: async (projectId, query, limit) => {
					asked.push({ projectId, query, limit });
					return [
						{
							path: "wiki/deploy.md",
							title: "Deploy",
							snippet: [
								{ text: "We ", match: false },
								{ text: "deploy", match: true },
								{ text: " at night.", match: false },
							],
						},
					];
				},
			}),
			{ folder: "/work/site" },
		);
		const found = await call("search_knowledge", {
			query: " deploy ",
			limit: 99,
		});
		expect(found.isError).toBe(false);
		expect(JSON.parse(found.text)).toEqual([
			{
				path: "wiki/deploy.md",
				title: "Deploy",
				excerpt: "We **deploy** at night.",
			},
		]);
		expect(asked).toEqual([{ projectId: "p2", query: "deploy", limit: 50 }]);
	});

	test("search_knowledge says when nothing matches, and asks for words", async () => {
		const { call } = await connect(fakePort(), { project: "App" });
		expect(
			(await call("search_knowledge", { query: "nothing" })).text,
		).toContain('No file in the knowledge of "App" matches "nothing"');
		expect((await call("search_knowledge", { query: " " })).isError).toBe(true);
	});

	test("read_knowledge gives the text, says when it is cut, and when there is no file", async () => {
		const { call } = await connect(
			fakePort({
				readKnowledge: async (_projectId, path, maxBytes) =>
					path === "big.md"
						? {
								path,
								title: "Big",
								text: "x".repeat(10),
								size: maxBytes * 3,
								truncated: true,
							}
						: path === "a.md"
							? { path, title: "A", text: "# A\n", size: 4, truncated: false }
							: null,
			}),
			{ project: "App" },
		);
		expect((await call("read_knowledge", { path: "a.md" })).text).toBe(
			"a.md: A\n\n# A\n",
		);
		expect((await call("read_knowledge", { path: "big.md" })).text).toContain(
			"The file is 300 KB. This is its first 100 KB.",
		);
		expect((await call("read_knowledge", { path: "gone.md" })).text).toContain(
			'has no file "gone.md"',
		);
	});
});
