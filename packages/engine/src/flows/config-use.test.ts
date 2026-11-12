import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import type {
	CliTool,
	Connection,
	ProfileView,
	ProjectSecretName,
	SecretView,
} from "../device-config";
import { type Asker, type ConfigUseDeps, createConfigUse } from "./config-use";
import type { FlowRef } from "./flow-use";

/** This computer's id: its profiles are the ones flows name with it. */
const HERE = "d1";
/** Who asks, in which Space. */
const AT: Asker = { spaceId: "s1", personId: "ada" };

/** A secret reference, as a person writes it. */
const ref = (name: string) => `\${${name}}`;

/** A flow with these nodes. The rest of the flow does not matter here. */
const flowOf = (...nodes: unknown[]) =>
	({ nodes, inputs: [], edges: [] }) as never as Flow;

const command = (id: string, ...secrets: string[]) => ({
	id,
	type: "command",
	secrets,
});

/** An Agent node that names these connections, CLI tools and a profile of a Device. */
const agent = (
	id: string,
	fields: {
		connections?: string[];
		clis?: string[];
		profile?: string;
		device?: string;
	},
) => ({
	id,
	type: "agent",
	connections: fields.connections ?? [],
	clis: fields.clis ?? [],
	...(fields.profile
		? { profile: { device: fields.device ?? HERE, profile: fields.profile } }
		: {}),
});

/** A Decision a Model Profile of this computer decides. */
const decision = (id: string, profile: string) => ({
	id,
	type: "decision",
	prompt: "Is it a bug?",
	options: [{ name: "bug" }, { name: "idea" }],
	by: "model",
	profile: { device: HERE, profile },
});

/** A project of the Space: its flows, and the secret of each webhook schedule. */
type Project = {
	id: string;
	name: string;
	flows: Record<string, Flow>;
	webhooks?: Record<string, string>;
};

const project = (
	id: string,
	flows: Record<string, Flow>,
	webhooks?: Record<string, string>,
): Project => ({
	id,
	name: id.toUpperCase(),
	flows,
	...(webhooks ? { webhooks } : {}),
});

/** A flow of a project, as the lists name it. */
const flow = (projectId: string, flowName: string): FlowRef => ({
	projectId,
	projectName: projectId.toUpperCase(),
	flowName,
});

/** A connection whose server reads these secrets. */
const connection = (name: string, ...secrets: string[]): Connection =>
	({
		name,
		description: null,
		variables: secrets.map((secret) => ({ name: secret, source: "missing" })),
		updatedAt: 0,
	}) as never;

/** A CLI tool, with a login that reads these secrets. */
const tool = (name: string, ...secrets: string[]): CliTool => ({
	name,
	program: null,
	description: null,
	login:
		secrets.length > 0
			? { env: Object.fromEntries(secrets.map((s) => [s, ref(s)])) }
			: null,
	git: null,
	updatedAt: 0,
});

/** An Agent Profile that names these connections and CLI tools. */
const agentProfile = (
	id: string,
	fields: { connections?: string[]; clis?: string[] } = {},
): ProfileView =>
	({
		id,
		name: id,
		harness: "claude-code",
		connections: fields.connections ?? [],
		clis: fields.clis ?? [],
	}) as never;

/** A Model Profile whose address reads these secrets: its API key, and a header. */
const modelProfile = (
	id: string,
	secrets: { apiKey?: string; header?: string },
): ProfileView =>
	({
		id,
		name: id,
		decider: "compatible",
		address: {
			baseUrl: "http://models.example.com",
			...(secrets.apiKey ? { apiKey: secrets.apiKey } : {}),
			...(secrets.header
				? { headers: { "X-Team": `team-${ref(secrets.header)}` } }
				: {}),
		},
	}) as never;

/** A secret of a project or of the Space, as Members see it. */
const shared = (name: string): ProjectSecretName => ({
	name,
	setAt: 1,
	setBy: null,
});

/**
 * This computer over a Space of `projects`. `kept` gives the names of the
 * secrets of each project and of the Space (`space`): a Refusal or an
 * error is what reading them throws. `saved`: the names saved here.
 */
function configUse(
	options: {
		projects?: Project[];
		connections?: Connection[];
		tools?: CliTool[];
		profiles?: ProfileView[];
		kept?: Record<string, string[] | Error>;
		saved?: string[];
		personal?: "available" | "unavailable";
		signedInAt?: ConfigUseDeps["toolLaunchers"]["signedInAt"];
	} = {},
) {
	const projects = options.projects ?? [];
	const connections = options.connections ?? [];
	/** Each project's and the Space's names it is asked for, in order. */
	const asked: string[] = [];
	const keptOf = async (key: string) => {
		asked.push(key);
		const kept = options.kept?.[key] ?? [];
		if (kept instanceof Error) throw kept;
		return kept.map(shared);
	};
	const deps: ConfigUseDeps = {
		deviceId: HERE,
		space: (at) => {
			expect(at).toEqual(AT);
			return {
				listProjects: async () =>
					projects.map(({ id, name }) => ({ id, name })),
				listSchedules: async (projectId) => ({
					schedules: Object.entries(
						projects.find((p) => p.id === projectId)?.webhooks ?? {},
					).map(([flowName, secret]) => ({
						flow: flowName,
						webhook: { secret: ref(secret) },
					})),
				}),
				flows: {
					map: async (projectId) =>
						projects.find((p) => p.id === projectId)?.flows ?? {},
				},
			};
		},
		connections: {
			list: () => connections,
			// The store's view: the names asked for and those connections read, none saved but `saved`.
			secrets: async (named = []) => {
				const usedBy = new Map<string, string[]>();
				for (const c of connections) {
					for (const { name } of c.variables) {
						usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
					}
				}
				const names = new Set([
					...named,
					...usedBy.keys(),
					...(options.saved ?? []),
				]);
				return {
					personal: options.personal ?? "available",
					secrets: [...names].sort().map(
						(name): SecretView => ({
							name,
							scope: "computer",
							saved: options.saved?.includes(name) === true,
							inEnv: false,
							usedBy: usedBy.get(name) ?? [],
							setAt: null,
							usedAt: null,
						}),
					),
				};
			},
			projectSecrets: (at, personId) => {
				expect([at.spaceId, personId]).toEqual([AT.spaceId, AT.personId]);
				return keptOf(at.projectId);
			},
			spaceSecrets: (spaceId, personId) => {
				expect([spaceId, personId]).toEqual([AT.spaceId, AT.personId]);
				return keptOf("space");
			},
		},
		cliTools: { list: () => options.tools ?? [] },
		profiles: { list: () => options.profiles ?? [] },
		toolLaunchers: { signedInAt: options.signedInAt ?? (async () => null) },
	};
	return { use: createConfigUse(deps), asked };
}

/** This computer's secrets: each name with what the list says uses it. */
async function computerList(
	options: Parameters<typeof configUse>[0],
): Promise<
	{ name: string; flows: FlowRef[]; usedBy: string[]; tools: string[] }[]
> {
	const listed = await configUse(options).use.connections(AT);
	return listed.secrets.map(({ name, flows, usedBy, tools }) => ({
		name,
		flows,
		usedBy,
		tools,
	}));
}

describe("what uses a secret", () => {
	// A flow uses a secret in four ways: it names it, or names a profile,
	// a Connection or a CLI tool of this computer that reads it.
	const space = {
		projects: [
			project("p1", {
				login: flowOf(command("call", "TOKEN")),
				sort: flowOf(decision("pick", "jev")),
				read: flowOf(agent("look", { connections: ["tracker"] })),
				work: flowOf(agent("do", { profile: "worker" })),
				ship: flowOf(agent("push", { clis: ["acli"] })),
				// Another Device's profile of the same id is another profile.
				far: flowOf(agent("away", { profile: "worker", device: "le2316" })),
			}),
			project("p2", {
				// A flow that calls one that uses it uses it too.
				night: flowOf({ id: "run", type: "call", flow: "login", inputs: {} }),
				login: flowOf(command("call", "TOKEN")),
			}),
		],
		connections: [connection("tracker", "TOKEN")],
		tools: [tool("acli", "TOKEN")],
		profiles: [
			modelProfile("jev", { apiKey: "TOKEN" }),
			agentProfile("worker", { connections: ["tracker"], clis: ["acli"] }),
		],
	};

	test("this computer's list names the flows that name it or a Model Profile that reads it, and its connections and CLI tools", async () => {
		expect(await computerList(space)).toEqual([
			{
				name: "TOKEN",
				flows: [
					flow("p1", "login"),
					flow("p2", "night"),
					flow("p2", "login"),
					flow("p1", "sort"),
				],
				usedBy: ["tracker"],
				tools: ["acli"],
			},
		]);
	});

	test("a project's list names every flow of that project that uses it, and the CLI tools", async () => {
		const { use } = configUse({ ...space, kept: { p1: ["TOKEN"] } });
		expect(await use.sharedSecrets(AT, { projectId: "p1" })).toEqual([
			{
				...shared("TOKEN"),
				flows: ["login", "read", "ship", "sort", "work"],
				tools: ["acli"],
				webhooks: [],
			},
		]);
	});

	test("the Space's list names the flows of every project", async () => {
		const { use } = configUse({ ...space, kept: { space: ["TOKEN"] } });
		expect(await use.sharedSecrets(AT, "space")).toEqual([
			{
				...shared("TOKEN"),
				flows: ["login", "night", "read", "ship", "sort", "work"],
				tools: ["acli"],
				webhooks: [],
			},
		]);
	});

	test("a shared list is null when the Host cannot be reached, and other errors throw", async () => {
		const away = configUse({
			kept: {
				p1: new Refusal("unavailable", "Away."),
				space: new Error("Broken."),
			},
		}).use;
		expect(await away.sharedSecrets(AT, { projectId: "p1" })).toBeNull();
		await expect(away.sharedSecrets(AT, "space")).rejects.toThrow("Broken.");
	});
});

describe("this computer's Secrets list: the scopes of ADR 13 and 18", () => {
	test("leaves out the flows whose project or Space has the secret, and a name nothing else needs", async () => {
		const { use, asked } = configUse({
			projects: [
				project("p1", {
					trade: flowOf(command("buy", "ALPACA_KEY", "LAB_DB_URL")),
				}),
				project("p2", {
					rebalance: flowOf(command("mark", "LAB_DB_URL", "SPACE_KEY")),
				}),
			],
			kept: { p1: ["ALPACA_KEY", "LAB_DB_URL"], space: ["SPACE_KEY"] },
		});
		const listed = await use.connections(AT);
		expect(listed.secrets.map((s) => [s.name, s.flows])).toEqual([
			["LAB_DB_URL", [flow("p2", "rebalance")]],
		]);
		// The Space's names are read once.
		expect(asked.sort()).toEqual(["p1", "p2", "space"]);
	});

	test("a project whose secrets cannot be read covers nothing", async () => {
		expect(
			await computerList({
				projects: [
					project("p1", { mark: flowOf(command("run", "LAB_DB_URL")) }),
				],
				kept: { p1: new Error("Away.") },
			}),
		).toEqual([
			{
				name: "LAB_DB_URL",
				flows: [flow("p1", "mark")],
				usedBy: [],
				tools: [],
			},
		]);
	});

	test("keeps a saved value when its project has the secret too", async () => {
		const listed = await configUse({
			projects: [project("p1", { mark: flowOf(command("run", "LAB_DB_URL")) })],
			kept: { p1: ["LAB_DB_URL"] },
			saved: ["LAB_DB_URL"],
		}).use.connections(AT);
		expect(listed.secrets.map((s) => [s.name, s.saved, s.flows])).toEqual([
			["LAB_DB_URL", true, []],
		]);
	});

	test("a CLI tool that reads it goes when each flow that uses it or the name gets it from its project", async () => {
		expect(
			await computerList({
				projects: [
					project("p1", {
						demo: flowOf(command("call", "TOKEN")),
						test: flowOf(
							agent("check", { connections: ["tracker"], clis: ["acli"] }),
						),
					}),
				],
				connections: [connection("tracker", "TOKEN")],
				tools: [tool("acli", "TOKEN")],
				kept: { p1: ["TOKEN"] },
			}),
		).toEqual([{ name: "TOKEN", flows: [], usedBy: ["tracker"], tools: [] }]);
	});

	test("it stays when a flow of another project uses it through a profile of this computer", async () => {
		expect(
			await computerList({
				projects: [
					project("p1", { demo: flowOf(command("call", "TOKEN")) }),
					project("p2", { sync: flowOf(agent("pull", { profile: "worker" })) }),
				],
				tools: [tool("acli", "TOKEN")],
				profiles: [agentProfile("worker", { clis: ["acli"] })],
				kept: { p1: ["TOKEN"] },
			}),
		).toEqual([{ name: "TOKEN", flows: [], usedBy: [], tools: ["acli"] }]);
	});

	test("it stays when no flow is known to use the name: a test or a sign-in reads it here", async () => {
		expect(
			await computerList({
				connections: [connection("tracker", "TOKEN")],
				tools: [tool("acli", "TOKEN")],
				kept: { p1: ["TOKEN"] },
			}),
		).toEqual([
			{ name: "TOKEN", flows: [], usedBy: ["tracker"], tools: ["acli"] },
		]);
	});

	test("names the flow a webhook starts, unless its project keeps the secret", async () => {
		const projects = [project("p1", { deploy: flowOf() }, { deploy: "HOOK" })];
		const shown = await configUse({ projects }).use.connections(AT);
		expect(shown.secrets.map((s) => [s.name, s.webhooks])).toEqual([
			["HOOK", [flow("p1", "deploy")]],
		]);
		const covered = await configUse({
			projects,
			kept: { p1: ["HOOK"] },
		}).use.connections(AT);
		expect(covered.secrets).toEqual([]);
	});

	test("lists a secret only a Model Profile's address reads, with the flows that use the profile", async () => {
		expect(
			await computerList({
				projects: [project("p1", { sort: flowOf(decision("pick", "jev")) })],
				profiles: [
					modelProfile("jev", { apiKey: "JEV_KEY", header: "TEAM_ID" }),
					// No flow uses it: its key is not asked for.
					modelProfile("idle", { apiKey: "IDLE_KEY" }),
				],
			}),
		).toEqual([
			{ name: "JEV_KEY", flows: [flow("p1", "sort")], usedBy: [], tools: [] },
			{ name: "TEAM_ID", flows: [flow("p1", "sort")], usedBy: [], tools: [] },
		]);
	});
});

describe("this computer's connections, CLI tools and profiles", () => {
	test("names the flows and the Agent Profiles that use each connection", async () => {
		const listed = await configUse({
			projects: [
				project("p1", {
					night: flowOf(agent("plan", { connections: ["github"] })),
				}),
			],
			connections: [connection("github"), connection("linear")],
			profiles: [
				agentProfile("fast", { connections: ["github"] }),
				agentProfile("slow", { connections: ["linear", "github"] }),
				// A Model Profile names no connections.
				modelProfile("decider", {}),
			],
		}).use.connections(AT);
		expect(
			listed.connections.map((c) => [c.name, c.usedBy, c.profiles]),
		).toEqual([
			["github", [flow("p1", "night")], ["fast", "slow"]],
			["linear", [], ["slow"]],
		]);
	});

	test("names the flows and Agent Profiles that use each tool, and when a login signed in", async () => {
		const signedIn: string[] = [];
		const listed = await configUse({
			projects: [
				project("p1", { night: flowOf(agent("plan", { clis: ["jq"] })) }),
			],
			tools: [
				tool("jq"),
				{
					...tool("gh-work"),
					login: {
						env: {},
						folder: "GH_CONFIG_DIR",
						signIn: { command: "gh auth login" },
					},
				},
			],
			profiles: [agentProfile("fast", { clis: ["jq"] })],
			signedInAt: async (name) => {
				signedIn.push(name);
				return 42;
			},
		}).use.cliTools(AT);
		expect(
			listed.map((t) => [t.name, t.usedBy, t.profiles, t.signedInAt]),
		).toEqual([
			["jq", [flow("p1", "night")], ["fast"], null],
			["gh-work", [], [], 42],
		]);
		// Only a tool with a sign-in has a time to read.
		expect(signedIn).toEqual(["gh-work"]);
	});

	test("names the nodes that use each profile of this computer only", async () => {
		const listed = await configUse({
			projects: [
				project("p1", {
					night: flowOf(
						agent("plan", { profile: "fast" }),
						agent("far", { profile: "slow", device: "le2316" }),
					),
				}),
			],
			profiles: [agentProfile("fast"), agentProfile("slow")],
		}).use.profiles(AT);
		expect(listed.map((p) => [p.name, p.usedBy])).toEqual([
			["fast", [{ ...flow("p1", "night"), nodeIds: ["plan"] }]],
			["slow", []],
		]);
	});
});

describe("a CLI tool's login: where it finds its secrets", () => {
	const acli: CliTool = {
		...tool("acli"),
		program: "acli",
		login: {
			env: {},
			folder: "HOME",
			signIn: { command: "acli login", input: ref("TOKEN") },
		},
	};

	async function stateOf(options: {
		here?: boolean;
		personal?: "available" | "unavailable";
		kept?: string[] | Error;
	}) {
		const [listed] = await configUse({
			projects: [project("acme", {})],
			tools: [acli],
			saved: options.here ? ["TOKEN"] : [],
			...(options.personal ? { personal: options.personal } : {}),
			kept: { acme: options.kept ?? [] },
			signedInAt: async (_name, projectId) =>
				projectId === "acme" ? 42 : null,
		}).use.cliTools(AT);
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
		expect(await stateOf({ kept: ["TOKEN"] })).toEqual({
			signsInHere: false,
			projects: [{ projectId: "acme", projectName: "ACME", signedInAt: 42 }],
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
		expect(await stateOf({ kept: new Error("Away.") })).toEqual(expected);
		expect(await stateOf({ personal: "unavailable" })).toEqual(expected);
	});
});
