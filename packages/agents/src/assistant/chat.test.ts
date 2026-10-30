import { describe, expect, test } from "bun:test";
import {
	type ChatRequest,
	type Flow,
	type FlowProposal,
	flowSchema,
} from "@nightshift/flows";
import type { BridgedTool } from "../port";
import { fakeHarness } from "../testing/fake";
import {
	type ChatTurnEvent,
	chatCanUseTools,
	chatTurn,
	resumesOnAnotherModel,
} from "./chat";
import {
	AUTHORING_TOOLS,
	type AuthoringPort,
	type AuthoringRun,
	authoringTools,
	RUN_REPORT_LIMIT,
	runReport,
} from "./tools";

const draft: Flow = flowSchema.parse({
	version: 7,
	inputs: [{ name: "issue", type: "text" }],
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

/** The draft with a test step after `build`. */
const withTests: Flow = flowSchema.parse({
	...draft,
	nodes: [
		...draft.nodes,
		{
			id: "test",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
		},
	],
	edges: [{ id: "e1", from: "build", outcome: "pass", to: "test" }],
});

/** A flow that names a profile this computer does not have. */
const broken = {
	...withTests,
	nodes: [{ ...draft.nodes[0], profile: "ghost" }, withTests.nodes[1]],
};

function port(over: Partial<AuthoringPort> = {}): AuthoringPort & {
	proposed: FlowProposal[];
} {
	const proposed: FlowProposal[] = [];
	return {
		proposed,
		draft: async () => ({ name: "fix", flow: draft }),
		flows: async () => ({ fix: draft, release: draft, old: null }),
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
		tools: async () => ({
			clis: [
				{ name: "gh", description: "GitHub", program: null, signsIn: false },
			],
			connections: [{ name: "linear", description: null }],
		}),
		skills: async () => [
			{ name: "tdd", description: "Test first", source: "project" },
		],
		propose: (proposal) => {
			proposed.push(proposal);
		},
		...over,
	};
}

async function call(
	tools: BridgedTool[],
	name: string,
	args: unknown = {},
): Promise<string> {
	const tool = tools.find((t) => t.name === name);
	if (!tool?.execute) throw new Error(`No tool ${name}`);
	return String(await tool.execute(args));
}

describe("authoringTools", () => {
	test("the names the skill uses; get_run only with a run", () => {
		expect(
			authoringTools(port())
				.map((t) => t.name)
				.sort(),
		).toEqual(
			[
				"check_flow",
				"get_draft",
				"get_flow",
				"list_flows",
				"list_profiles",
				"list_skills",
				"list_tools",
				"propose_flow",
			].sort(),
		);
		const withRun = authoringTools(port({ run: async () => null }));
		expect(withRun.map((t) => t.name)).toContain(AUTHORING_TOOLS.getRun);
	});

	test("read tools: the draft, the other flows, profiles without secrets", async () => {
		const tools = authoringTools(port());
		expect(await call(tools, "get_draft")).toContain('"Fix {{issue}}."');
		const flows = JSON.parse(await call(tools, "list_flows"));
		expect(flows).toEqual([
			{
				name: "release",
				description: null,
				inputs: ["issue"],
				outputs: [],
				steps: 1,
			},
			{ name: "old", valid: false },
		]);
		expect(await call(tools, "get_flow", { name: "nope" })).toContain(
			'no flow "nope"',
		);
		expect(JSON.parse(await call(tools, "list_profiles"))).toEqual([
			{
				device: "mac",
				profile: "worker",
				name: "worker",
				deviceName: "MacBook",
				kind: "agent",
				harness: "claude-code",
				model: "sonnet",
			},
		]);
	});

	test("get_draft and get_flow keep the positions and Sections, so a proposal keeps them", async () => {
		const tidy: Flow = flowSchema.parse({
			...withTests,
			sections: [{ id: "work", label: "Work", nodes: ["build", "test"] }],
		});
		const tools = authoringTools(
			port({
				draft: async () => ({ name: "fix", flow: tidy }),
				flows: async () => ({ fix: tidy }),
			}),
		);
		const fromDraft = await call(tools, "get_draft");
		const shown = JSON.parse(fromDraft.slice(fromDraft.indexOf("{")));
		expect(shown.sections).toEqual(tidy.sections);
		expect(shown.nodes[1].position).toEqual({ x: 300, y: 0 });
		const fromFlow = JSON.parse(await call(tools, "get_flow", { name: "fix" }));
		expect(fromFlow.sections).toEqual(tidy.sections);
	});

	test("check_flow: the issues of a flow, checked against this computer", async () => {
		const tools = authoringTools(port());
		expect(await call(tools, "check_flow", { flow: withTests })).not.toContain(
			"error:",
		);
		expect(await call(tools, "check_flow", { flow: broken })).toContain(
			'error: Agent node "build" names the profile "ghost", but Night Shift cannot tell which computer\'s profile it is.',
		);
		const elsewhere = {
			...withTests,
			nodes: [
				{ ...draft.nodes[0], profile: { device: "le2316", profile: "worker" } },
				withTests.nodes[1],
			],
		};
		expect(await call(tools, "check_flow", { flow: elsewhere })).toContain(
			'There is no profile "worker" on the device "le2316". Use a device and a profile from list_profiles.',
		);
	});

	test("propose_flow refuses a flow with errors twice, then passes it with its issues", async () => {
		const p = port();
		const tools = authoringTools(p);
		const args = { flow: broken, summary: "Runs the tests." };
		expect(await call(tools, "propose_flow", args)).toStartWith("Refused");
		expect(await call(tools, "propose_flow", args)).toStartWith("Refused");
		expect(p.proposed).toHaveLength(0);
		expect(await call(tools, "propose_flow", args)).toContain(
			"The person sees your proposal now, with its errors marked.",
		);
		expect(p.proposed).toHaveLength(1);
		expect(p.proposed[0]?.summary).toBe("Runs the tests.");
		expect(
			p.proposed[0]?.issues.some((issue) => issue.severity === "error"),
		).toBe(true);
	});

	test("propose_flow passes a valid flow at once, and never one that is not a flow", async () => {
		const p = port();
		const tools = authoringTools(p);
		expect(
			await call(tools, "propose_flow", { flow: withTests, summary: "Tests." }),
		).toStartWith("The person sees your proposal now.");
		expect(p.proposed[0]?.flow.nodes.map((n) => n.id)).toEqual([
			"build",
			"test",
		]);
		for (let i = 0; i < 4; i++) {
			expect(
				await call(tools, "propose_flow", { flow: { nodes: [] }, summary: "" }),
			).toStartWith("Refused");
		}
		expect(p.proposed).toHaveLength(1);
	});
});

describe("runReport", () => {
	const run: AuthoringRun = {
		id: "r1",
		status: "failed",
		reason: "The step `test` failed and no edge leaves on `fail`.",
		inputs: { issue: "#12" },
		flow: draft,
		steps: [
			{
				id: "s1",
				flow: null,
				nodeId: "build",
				nodeType: "agent",
				visit: 1,
				outcome: "pass",
				error: null,
				note: "Fixed it.",
			},
			{
				id: "s2",
				flow: "build-task",
				nodeId: "test",
				nodeType: "command",
				visit: 1,
				outcome: "fail",
				error: null,
				note: null,
			},
		],
		failedStepId: "s2",
		transcript: Array.from({ length: 5000 }, (_, i) => `line ${i}`),
	};

	test("the status, the steps, and the end of the failed step's transcript, bounded", () => {
		const report = runReport(run, withTests);
		expect(report.length).toBeLessThanOrEqual(RUN_REPORT_LIMIT);
		expect(report).toContain("Status: failed. Why: The step `test` failed");
		expect(report).toContain("- `build` (agent): pass. note: Fixed it.");
		expect(report).toContain(
			'- `test` in the called flow "build-task" (command): fail',
		);
		expect(report).toContain("The step that failed: `test` in the called flow");
		expect(report).toContain("The draft changed since this run: 1 steps added");
		expect(report).toContain("line 4999");
		expect(report).not.toContain("line 10\n");
	});

	test("with cite, each step is the link the chat shows as a citation", () => {
		const report = runReport(run, draft, "The draft", { cite: true });
		expect(report).toContain("- [build](#step-s1) (agent): pass");
		expect(report).toContain(
			'- [test](#step-s2) in the called flow "build-task" (command): fail',
		);
		expect(report).toContain("The step that failed: [test](#step-s2)");
		expect(runReport(run, draft)).not.toContain("#step-");
	});

	test("many long steps stay within the limit", () => {
		const long = "x".repeat(5000);
		const report = runReport(
			{
				...run,
				reason: long,
				steps: Array.from({ length: 500 }, (_, i) => ({
					...run.steps[0],
					id: `s${i}`,
					visit: i + 1,
					error: long,
					note: long,
				})) as AuthoringRun["steps"],
			},
			draft,
		);
		expect(report.length).toBeLessThanOrEqual(RUN_REPORT_LIMIT);
		expect(report).toContain("(the last 40 of 500)");
	});
});

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
	projectId: "p1",
	flowName: "fix",
	flow: draft,
	message: "Run the tests after the build.",
	...over,
});

async function turn(
	input: Parameters<typeof chatTurn>[0],
): Promise<ChatTurnEvent[]> {
	const events: ChatTurnEvent[] = [];
	for await (const event of chatTurn(input)) events.push(event);
	return events;
}

describe("chatTurn", () => {
	test("a first message: the chat prompt, the tools, text, then the proposal and done", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "tool", name: "get_draft" },
				{
					type: "tool",
					name: "propose_flow",
					input: { flow: withTests, summary: "Adds a test step." },
				},
				{ type: "text", text: "I added a test step." },
			],
		});
		const { propose: _p, ...rest } = port();
		const events = await turn({
			request: request(),
			harness,
			profile: { model: "haiku" },
			cwd: "/repo",
			port: rest,
			signal: new AbortController().signal,
		});
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"activity",
			"activity",
			"proposal",
			"text",
			"text",
			"text",
			"usage",
			"done",
		]);
		expect(events[1]).toEqual({ type: "activity", text: "Reads your flow" });
		const proposal = events.find((e) => e.type === "proposal");
		expect(proposal).toMatchObject({
			proposal: { summary: "Adds a test step.", issues: [] },
		});
		const input = harness.calls[0];
		expect(input?.readOnly).toBe(true);
		expect(input?.resumeSessionId).toBeUndefined();
		expect(input?.prompt).toContain('# The flow "fix"');
		expect(input?.prompt).toContain("Run the tests after the build.");
		expect(input?.prompt).toContain("# Writing Night Shift flows");
		expect(input?.tools?.map((t) => t.name)).toContain("propose_flow");
		expect(input?.tools?.map((t) => t.name)).not.toContain("get_run");
	});

	test("a later message resumes the session; a new run asks for get_run", async () => {
		const harness = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const { propose: _p, ...rest } = port({ run: async () => null });
		const events = await turn({
			request: request({ message: "Why did it fail?", runId: "r1" }),
			harness,
			profile: { model: "haiku" },
			cwd: "/repo",
			port: rest,
			resumeSessionId: "s-1",
			newRun: true,
			signal: new AbortController().signal,
		});
		expect(events[0]).toEqual({ type: "session", sessionId: "s-1" });
		expect(events.at(-1)).toEqual({ type: "done" });
		const input = harness.calls[0];
		expect(input?.resumeSessionId).toBe("s-1");
		expect(input?.prompt).toStartWith("The person's next message.");
		expect(input?.prompt).toContain("This chat is about run r1");
		expect(input?.prompt).toContain("(#step-<step id>)");
		expect(input?.prompt).not.toContain("# Writing Night Shift flows");
		expect(input?.tools?.map((t) => t.name)).toContain("get_run");
	});

	test("a new session of a chat on another agent gets the chat so far", async () => {
		const harness = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const { propose: _p, ...rest } = port();
		await turn({
			request: request({ message: "Then add it." }),
			harness,
			profile: { model: "haiku" },
			cwd: "/repo",
			port: rest,
			history: [{ message: "What is missing?", answer: "A lint step." }],
			signal: new AbortController().signal,
		});
		const prompt = harness.calls[0]?.prompt ?? "";
		expect(prompt).toContain("# The chat so far");
		expect(prompt.indexOf("What is missing?")).toBeLessThan(
			prompt.indexOf("Then add it."),
		);
		expect(prompt).toContain("A lint step.");
	});

	test("which harnesses resume on another model", () => {
		expect(resumesOnAnotherModel("claude-code")).toBe(true);
		expect(resumesOnAnotherModel("acp:goose")).toBe(false);
		expect(resumesOnAnotherModel("gemini")).toBe(false);
	});

	test("which harnesses a chat can run on", () => {
		expect(chatCanUseTools("claude-code")).toBe(true);
		expect(chatCanUseTools("codex")).toBe(true);
		expect(chatCanUseTools("opencode")).toBe(true);
		expect(chatCanUseTools("acp:goose")).toBe(true);
		expect(chatCanUseTools("pi")).toBe(false);
		expect(chatCanUseTools("grok-build")).toBe(false);
	});
});
