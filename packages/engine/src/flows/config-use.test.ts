import { describe, expect, test } from "bun:test";

import type {
	CliTool,
	Connection,
	ProfileView,
	SecretList,
	SecretView,
} from "../device-config";
import {
	cliToolsInUse,
	cliToolsOfSecrets,
	connectionsInUse,
	profilesInUse,
} from "./config-use";
import { type FlowRef, type FlowUse, profileUseKey } from "./flow-use";

const flow = (flowName: string): FlowRef => ({
	projectId: "p1",
	projectName: "website",
	flowName,
});

const noUse = (): FlowUse => ({
	connections: new Map(),
	clis: new Map(),
	webhooks: new Map(),
	secrets: new Map(),
	profiles: new Map(),
});

const connection = (name: string): Connection =>
	({ name, description: null, variables: [], updatedAt: 0 }) as never;

const tool = (name: string, fields: Partial<CliTool> = {}): CliTool => ({
	name,
	program: null,
	description: null,
	login: null,
	git: null,
	updatedAt: 0,
	...fields,
});

/** An Agent Profile that names these connections and CLI tools, or a Model Profile (no `harness`). */
const profile = (
	name: string,
	fields: { connections?: string[]; clis?: string[]; model?: true } = {},
): ProfileView =>
	(fields.model
		? { id: name, name, decider: "ollama", model: "llama" }
		: {
				id: name,
				name,
				harness: "claude-code",
				connections: fields.connections ?? [],
				clis: fields.clis ?? [],
			}) as never;

/** The secret store's view: every name it is asked for, none saved. */
const secretsOf = async (
	named: Iterable<string> = [],
): Promise<SecretList> => ({
	personal: "available",
	secrets: [...new Set(named)].sort().map(
		(name): SecretView => ({
			name,
			scope: "computer",
			saved: false,
			inEnv: false,
			usedBy: [],
			setAt: null,
			usedAt: null,
		}),
	),
});

describe("cliToolsOfSecrets", () => {
	test("names the tools whose logins read a secret, and the flows that use each tool", () => {
		const use = noUse();
		use.clis.set("acli-work", [flow("nightly")]);
		const login = {
			env: {},
			folder: "HOME",
			signIn: { command: "acli login", input: "${TOKEN}" },
		};
		const { toolsBySecret, toolFlows } = cliToolsOfSecrets(
			{
				cliTools: {
					list: () => [
						{
							name: "acli-work",
							program: "acli",
							description: null,
							login,
							git: null,
							updatedAt: 1,
						},
					],
				},
				profiles: { list: () => [] },
			},
			use,
		);
		expect(toolsBySecret.get("TOKEN")).toEqual(["acli-work"]);
		expect(toolFlows.get("acli-work")).toEqual([flow("nightly")]);
	});
});

describe("connectionsInUse", () => {
	test("names the flows and the Agent Profiles that use each connection", async () => {
		const use = noUse();
		use.connections.set("github", [flow("night")]);
		const listed = await connectionsInUse(
			{
				connections: {
					list: () => [connection("github"), connection("linear")],
					secrets: secretsOf,
				},
				cliTools: { list: () => [] },
				profiles: {
					list: () => [
						profile("fast", { connections: ["github"] }),
						profile("slow", { connections: ["linear", "github"] }),
						// A Model Profile names no connections.
						profile("decider", { model: true }),
					],
				},
			},
			use,
		);
		expect(
			listed.connections.map((c) => [c.name, c.usedBy, c.profiles]),
		).toEqual([
			["github", [flow("night")], ["fast", "slow"]],
			["linear", [], ["slow"]],
		]);
	});

	test("lists a secret a Command node or a CLI tool's login names, with what reads it", async () => {
		const use = noUse();
		use.secrets.set("API_USER", [flow("tools")]);
		const listed = await connectionsInUse(
			{
				connections: { list: () => [], secrets: secretsOf },
				cliTools: {
					list: () => [
						tool("gh-work", {
							login: {
								// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
								env: { GH_TOKEN: "${GH_WORK_TOKEN}" },
								folder: "GH_CONFIG_DIR",
								// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
								signIn: { command: "gh auth login", input: "${API_USER}" },
							},
						}),
						tool("jq"),
					],
				},
				profiles: { list: () => [] },
			},
			use,
		);
		expect(listed.secrets.map((s) => [s.name, s.flows, s.tools])).toEqual([
			["API_USER", [flow("tools")], ["gh-work"]],
			["GH_WORK_TOKEN", [], ["gh-work"]],
		]);
	});

	test("leaves out the flows whose project has the secret, and a name nothing else needs", async () => {
		const use = noUse();
		const other: FlowRef = { ...flow("rebalance"), projectId: "p2" };
		// p1 keeps both names. Only p2's flow still reads LAB_DB_URL here.
		use.secrets.set("ALPACA_KEY", [flow("trade")]);
		use.secrets.set("LAB_DB_URL", [flow("mark"), other]);
		const asked: string[] = [];
		const listed = await connectionsInUse(
			{
				connections: { list: () => [], secrets: secretsOf },
				cliTools: { list: () => [] },
				profiles: { list: () => [] },
			},
			use,
			async (projectId) => {
				asked.push(projectId);
				return new Set(projectId === "p1" ? ["ALPACA_KEY", "LAB_DB_URL"] : []);
			},
		);
		expect(listed.secrets.map((s) => [s.name, s.flows])).toEqual([
			["LAB_DB_URL", [other]],
		]);
		expect(asked.sort()).toEqual(["p1", "p2"]);
	});

	test("keeps a saved value when its project has the secret too", async () => {
		const use = noUse();
		use.secrets.set("LAB_DB_URL", [flow("mark")]);
		const listed = await connectionsInUse(
			{
				connections: {
					list: () => [],
					secrets: async (named) => {
						const list = await secretsOf(named);
						return {
							...list,
							secrets: list.secrets.map((s) => ({ ...s, saved: true })),
						};
					},
				},
				cliTools: { list: () => [] },
				profiles: { list: () => [] },
			},
			use,
			async () => new Set(["LAB_DB_URL"]),
		);
		expect(listed.secrets.map((s) => [s.name, s.saved, s.flows])).toEqual([
			["LAB_DB_URL", true, []],
		]);
	});
});

describe("connectionsInUse with a CLI tool's login", () => {
	const acli = tool("acli-work", {
		login: {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			env: { TOKEN: "${ACLI_TOKEN}" },
			folder: null,
			signIn: null,
		} as never,
	});
	const list = (use: FlowUse, keeps: Record<string, string[]>) =>
		connectionsInUse(
			{
				connections: { list: () => [], secrets: secretsOf },
				cliTools: { list: () => [acli] },
				profiles: { list: () => [profile("worker", { clis: ["acli-work"] })] },
			},
			use,
			async (projectId) => new Set(keeps[projectId] ?? []),
		);

	test("leaves out the tool when each flow that uses it is in a project that has the secret", async () => {
		const use = noUse();
		use.secrets.set("ACLI_TOKEN", [flow("demo")]);
		use.clis.set("acli-work", [flow("test")]);
		expect((await list(use, { p1: ["ACLI_TOKEN"] })).secrets).toEqual([]);
	});

	test("keeps the tool when a flow of another project uses it", async () => {
		const use = noUse();
		const other: FlowRef = { ...flow("sync"), projectId: "p2" };
		use.secrets.set("ACLI_TOKEN", [flow("demo")]);
		use.profiles.set(profileUseKey("d1", "worker"), [
			{ ...other, nodeIds: ["a"] },
		]);
		const listed = await list(use, { p1: ["ACLI_TOKEN"] });
		expect(listed.secrets.map((s) => [s.name, s.flows, s.tools])).toEqual([
			["ACLI_TOKEN", [], ["acli-work"]],
		]);
	});

	test("keeps the tool when no flow is known to use it", async () => {
		const listed = await list(noUse(), { p1: ["ACLI_TOKEN"] });
		expect(listed.secrets.map((s) => [s.name, s.tools])).toEqual([
			["ACLI_TOKEN", ["acli-work"]],
		]);
	});
});

describe("cliToolsInUse", () => {
	test("names the flows and Agent Profiles that use each tool, and when a login signed in", async () => {
		const use = noUse();
		use.clis.set("jq", [flow("night")]);
		const signedIn: string[] = [];
		const listed = await cliToolsInUse(
			{
				connections: {
					secrets: async () => ({ secrets: [], personal: "available" }),
				},
				cliTools: {
					list: () => [
						tool("jq"),
						tool("gh-work", {
							login: {
								env: {},
								folder: "GH_CONFIG_DIR",
								signIn: { command: "gh auth login" },
							},
						}),
					],
				},
				profiles: { list: () => [profile("fast", { clis: ["jq"] })] },
				toolLaunchers: {
					signedInAt: async (name) => {
						signedIn.push(name);
						return 42;
					},
				},
			},
			use,
			{ list: async () => [], secretNames: async () => new Set() },
		);
		expect(
			listed.map((t) => [t.name, t.usedBy, t.profiles, t.signedInAt]),
		).toEqual([
			["jq", [flow("night")], ["fast"], null],
			["gh-work", [], [], 42],
		]);
		// Only a tool with a sign-in has a time to read.
		expect(signedIn).toEqual(["gh-work"]);
	});
});

describe("cliToolsInUse: where a login finds its secrets", () => {
	const acli = tool("acli-work", {
		program: "acli",
		login: {
			env: {},
			folder: "HOME",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			signIn: { command: "acli login", input: "${TOKEN}" },
		},
	});
	const acme = { id: "acme", name: "Acme" };

	async function stateOf(options: {
		here?: boolean;
		personal?: "available" | "unavailable";
		keeps?: ReadonlySet<string> | null;
	}) {
		const [listed] = await cliToolsInUse(
			{
				connections: {
					secrets: async () => ({
						secrets: [
							{
								name: "TOKEN",
								scope: "computer",
								saved: options.here === true,
								inEnv: false,
								usedBy: [],
								setAt: null,
								usedAt: null,
							},
						],
						personal: options.personal ?? "available",
					}),
				},
				cliTools: { list: () => [acli] },
				profiles: { list: () => [] },
				toolLaunchers: {
					signedInAt: async (_name, projectId) =>
						projectId === "acme" ? 42 : null,
				},
			},
			noUse(),
			{
				list: async () => [acme],
				secretNames: async () =>
					options.keeps === undefined ? new Set() : options.keeps,
			},
		);
		return listed?.loginState;
	}

	test("a value here signs in here", async () => {
		expect(await stateOf({ here: true })).toEqual({
			signsInHere: true,
			projects: [],
			missing: [],
		});
	});

	test("a project's token signs in for that project, not here", async () => {
		expect(await stateOf({ keeps: new Set(["TOKEN"]) })).toEqual({
			signsInHere: false,
			projects: [{ projectId: "acme", projectName: "Acme", signedInAt: 42 }],
			missing: [],
		});
	});

	test("no value anywhere names the secret", async () => {
		expect(await stateOf({})).toEqual({
			signsInHere: false,
			projects: [],
			missing: ["TOKEN"],
		});
	});

	test("secrets that cannot be read now never say a secret is missing", async () => {
		const expected = { signsInHere: true, projects: [], missing: [] };
		expect(await stateOf({ keeps: null })).toEqual(expected);
		expect(await stateOf({ personal: "unavailable" })).toEqual(expected);
	});
});

describe("connectionsInUse: webhooks", () => {
	test("names the flow a webhook starts, unless its project keeps the secret", async () => {
		const use = noUse();
		use.webhooks.set("HOOK", [flow("deploy")]);
		const listedWith = (kept: ReadonlySet<string>) =>
			connectionsInUse(
				{
					connections: { list: () => [], secrets: secretsOf },
					cliTools: { list: () => [] },
					profiles: { list: () => [] },
				},
				use,
				async () => kept,
			);
		const shown = await listedWith(new Set());
		expect(shown.secrets.map((s) => [s.name, s.webhooks])).toEqual([
			["HOOK", [flow("deploy")]],
		]);
		const covered = await listedWith(new Set(["HOOK"]));
		expect(covered.secrets).toEqual([]);
	});
});

describe("profilesInUse", () => {
	test("names the nodes that use each profile of this computer only", () => {
		const use = noUse();
		const nodes = { ...flow("night"), nodeIds: ["plan"] };
		use.profiles.set(profileUseKey("mac", "fast"), [nodes]);
		use.profiles.set(profileUseKey("le2316", "slow"), [nodes]);
		const listed = profilesInUse(
			{ profiles: { list: () => [profile("fast"), profile("slow")] } },
			use,
			"mac",
		);
		expect(listed.map((p) => [p.name, p.usedBy])).toEqual([
			["fast", [nodes]],
			["slow", []],
		]);
	});
});
