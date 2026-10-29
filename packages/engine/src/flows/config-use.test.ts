import { describe, expect, test } from "bun:test";

import type {
	CliTool,
	Connection,
	ProfileView,
	SecretView,
} from "../device-config";
import { cliToolsInUse, connectionsInUse, profilesInUse } from "./config-use";
import { type FlowRef, type FlowUse, profileUseKey } from "./flow-use";

const flow = (flowName: string): FlowRef => ({
	projectId: "p1",
	projectName: "website",
	flowName,
});

const noUse = (): FlowUse => ({
	connections: new Map(),
	clis: new Map(),
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
const secretsOf = (named: Iterable<string> = []): SecretView[] =>
	[...new Set(named)].sort().map((name) => ({
		name,
		saved: false,
		inEnv: false,
		usedBy: [],
		setAt: null,
		usedAt: null,
	}));

describe("connectionsInUse", () => {
	test("names the flows and the Agent Profiles that use each connection", () => {
		const use = noUse();
		use.connections.set("github", [flow("night")]);
		const listed = connectionsInUse(
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

	test("lists a secret a Command node or a CLI tool's login names, with what reads it", () => {
		const use = noUse();
		use.secrets.set("ZAC_USER", [flow("tools")]);
		const listed = connectionsInUse(
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
								signIn: { command: "gh auth login", input: "${ZAC_USER}" },
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
			["GH_WORK_TOKEN", [], ["gh-work"]],
			["ZAC_USER", [flow("tools")], ["gh-work"]],
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
