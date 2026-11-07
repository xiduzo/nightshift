import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";

import {
	type FlowsClient,
	type FlowsIo,
	type FlowsOptions,
	flowsOptions,
	runFlows,
} from "./flows";

describe("nightshift flows' arguments", () => {
	const env = { PORT: "4100" };

	test("the project of this folder, on Night Shift of this computer", () => {
		expect(flowsOptions(["list"], env, "/work/app")).toEqual({
			command: { action: "list", json: false },
			project: null,
			daemon: "http://localhost:4100",
			folder: "/work/app",
		});
	});

	test("files and --out are read from the folder the command runs in", () => {
		expect(
			flowsOptions(["save", "fix", "flows/fix.json"], env, "/work/app"),
		).toMatchObject({
			command: {
				action: "save",
				name: "fix",
				file: "/work/app/flows/fix.json",
			},
		});
		expect(
			flowsOptions(["get", "fix", "--out", "fix.json"], env, "/work/app"),
		).toMatchObject({
			command: { action: "get", name: "fix", out: "/work/app/fix.json" },
		});
	});

	test("save and import read stdin without a file, or with -", () => {
		expect(flowsOptions(["save", "fix"], env, "/w")).toMatchObject({
			command: { file: null },
		});
		expect(
			flowsOptions(["import", "-", "--name", "fix"], env, "/w"),
		).toMatchObject({ command: { action: "import", file: null, name: "fix" } });
		expect(flowsOptions(["import"], env, "/w")).toEqual({
			error: "Give the flow's name in --name to import from stdin.",
		});
	});

	test("an import takes its name from the file unless --name gives one", () => {
		expect(flowsOptions(["import", "Fix.json"], env, "/w")).toMatchObject({
			command: { action: "import", file: "/w/Fix.json", name: null },
		});
	});

	test("refuses a name that is no flow name", () => {
		expect(flowsOptions(["get", "Fix It"], env, "/w")).toEqual({
			error:
				'"Fix It" is not a flow name. Use lowercase letters, digits and -, starting with a letter or digit. Example: fix-issue.',
		});
	});

	test("refuses what it does not know", () => {
		expect(flowsOptions([], env, "/w")).toEqual({ error: "Give an action." });
		expect(flowsOptions(["remove", "fix"], env, "/w")).toEqual({
			error: "There is no action remove.",
		});
		expect(flowsOptions(["list", "--nope"], env, "/w")).toEqual({
			error: "There is no option --nope.",
		});
		expect(flowsOptions(["get", "fix", "extra"], env, "/w")).toEqual({
			error: "Too many arguments: extra.",
		});
		expect(flowsOptions(["revision", "fix"], env, "/w")).toEqual({
			error: "Give the revision's id.",
		});
		expect(flowsOptions(["list", "--project"], env, "/w")).toEqual({
			error: "--project needs a value.",
		});
	});

	test("an import takes a profile for each agent, or keeps the agents", () => {
		expect(
			flowsOptions(
				[
					"import",
					"fix.json",
					"--agent",
					"claude-code:sonnet=builder",
					"--agent",
					"acp:goose:qwen3:32b=local",
				],
				env,
				"/w",
			),
		).toMatchObject({
			command: {
				action: "import",
				agents: [
					{ agent: "claude-code:sonnet", profile: "builder" },
					{ agent: "acp:goose:qwen3:32b", profile: "local" },
				],
				keepAgents: false,
			},
		});
		expect(
			flowsOptions(["import", "fix.json", "--keep-agents"], env, "/w"),
		).toMatchObject({ command: { agents: [], keepAgents: true } });
	});

	test("refuses an agent choice it cannot read, or outside an import", () => {
		expect(
			flowsOptions(["import", "fix.json", "--agent", "builder"], env, "/w"),
		).toEqual({
			error:
				'--agent needs an agent and a profile, for example claude-code:opus=reviewer. "builder" is not one.',
		});
		expect(
			flowsOptions(["list", "--agent", "claude-code:opus=a"], env, "/w"),
		).toEqual({ error: "--agent and --keep-agents work with import only." });
		expect(
			flowsOptions(
				["import", "f.json", "--keep-agents", "--agent", "claude-code:opus=a"],
				env,
				"/w",
			),
		).toEqual({ error: "Use --agent or --keep-agents, not both." });
	});
});

/** A flow file with an Agent on Claude Code with Sonnet, then one with Opus. */
const FILE = JSON.stringify({
	version: FLOW_VERSION,
	start: "plan",
	nodes: ["sonnet", "opus"].map((model, index) => ({
		id: index === 0 ? "plan" : "build",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Do it",
		harness: "claude-code",
		model,
		permissionMode: "auto",
	})),
	edges: [],
});

const PROFILES = [
	{ id: "p1", name: "builder", harness: "codex", model: "gpt-5" },
	{ id: "p2", name: "deep", harness: "claude-code", model: "opus" },
	{ id: "p3", name: "triage", decider: "ollama" },
];

/** `nightshift flows import fix.json` with these arguments, against a fake Night Shift. */
async function importWith(args: string[], profiles: unknown[] = PROFILES) {
	const options = flowsOptions(["import", "fix.json", ...args], {}, "/w");
	if ("error" in options) throw new Error(options.error);
	const imports: unknown[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const client = {
		projects: {
			list: async () => [{ id: "p", name: "app", repoPath: "/w" }],
		},
		profiles: { list: async () => profiles },
		flows: {
			import: async (input: unknown) => {
				imports.push(input);
				return { name: "fix", issues: [] };
			},
		},
	} as unknown as FlowsClient;
	const io: FlowsIo = {
		out: (text) => out.push(text),
		err: (line) => err.push(line),
		read: async () => FILE,
		write: async () => {},
		isFolder: () => false,
	};
	const code = await runFlows(options as FlowsOptions, client, io);
	return { code, imports, out, err };
}

describe("nightshift flows import and your agents", () => {
	test("each agent takes the prefilled profile, and each choice is printed", async () => {
		const run = await importWith([]);
		expect(run.code).toBe(0);
		expect(run.imports).toEqual([
			{
				projectId: "p",
				name: "fix",
				json: FILE,
				agents: [
					{ harness: "claude-code", model: "sonnet", profile: "p2" },
					{ harness: "claude-code", model: "opus", profile: "p2" },
				],
			},
		]);
		expect(run.err).toEqual([
			"claude-code:sonnet -> deep (claude-code:opus)",
			"claude-code:opus -> deep (claude-code:opus)",
		]);
		expect(run.out).toEqual(["fix\n"]);
	});

	test("--agent picks a profile by its name", async () => {
		const run = await importWith(["--agent", "claude-code:sonnet=builder"]);
		expect(run.imports).toMatchObject([
			{
				agents: [
					{ model: "sonnet", profile: "p1" },
					{ model: "opus", profile: "p2" },
				],
			},
		]);
	});

	test("--keep-agents and no profiles keep the agents the flow names", async () => {
		const kept = await importWith(["--keep-agents"]);
		expect(kept.imports).toMatchObject([{ agents: [] }]);
		expect(kept.err).toEqual([
			"Keeps its agents: claude-code:sonnet, claude-code:opus.",
		]);
		const none = await importWith([], []);
		expect(none.imports).toMatchObject([{ agents: [] }]);
		expect(none.err[0]).toStartWith("Keeps its agents:");
	});

	test("refuses an agent the flow does not name, or a profile this computer lacks", async () => {
		const agent = await importWith(["--agent", "codex:gpt-5=builder"]);
		expect(agent.code).toBe(1);
		expect(agent.imports).toEqual([]);
		expect(agent.err).toEqual([
			"The flow does not name the agent codex:gpt-5. Its agents: claude-code:sonnet, claude-code:opus.",
		]);
		const profile = await importWith(["--agent", "claude-code:opus=triage"]);
		expect(profile.code).toBe(1);
		expect(profile.err).toEqual([
			'This computer has no agent profile "triage". Its profiles: builder, deep.',
		]);
	});
});
