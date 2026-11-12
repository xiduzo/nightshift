import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "../flow";
import type { AgentNode } from "../nodes";
import { agentNode } from "../nodes/agent";
import { commandNode } from "../nodes/command";
import {
	checkDraft,
	type DraftMessages,
	isSavable,
	type PlaceDevice,
} from "./check";

const messages: DraftMessages = {
	schemaIssue: (_flow, issue) => `schema ${issue.path.map(String).join(".")}`,
	missingConnection: (name) => `connection ${name}`,
	missingProfile: (profile) => `profile ${profile.profile}`,
	missingDevice: (name, node) => `${node.type} on ${name}`,
	missingFlowDevice: () => "",
	programWithoutLogin: (program, tools) =>
		`${program} without ${tools.join(",")}`,
	refusesCommands: (node, mode) => `${node.id} refuses commands in ${mode}`,
	needsFolder: (need, node) => `folder ${need.kind} for ${node.id}`,
};

const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "worker",
	nodes: [
		{
			...agentNode("worker", { x: 0, y: 0 }),
			prompt: "Work.",
			connections: ["github"],
			profile: { device: "mac", profile: "night" },
		},
		{ ...commandNode("check", { x: 0, y: 0 }), command: "" },
	],
	edges: [],
};

describe("checkDraft", () => {
	test("a schema issue points at its node, in the app's words", () => {
		const { issues } = checkDraft(flow, messages);
		expect(issues).toContainEqual({
			severity: "error",
			message: "schema nodes.1.command",
			nodeId: "check",
		});
		expect(isSavable(flow)).toBe(false);
	});

	test("a backup its Device no longer has is marked on its node", () => {
		const withBackup = {
			...flow,
			nodes: [
				{
					...(flow.nodes[0] as AgentNode),
					fallbacks: [{ device: "host", profile: "gone" }],
				},
				flow.nodes[1],
			],
		} as Flow;
		const { issues } = checkDraft(withBackup, messages, {
			devices: [
				{ deviceId: "mac", profiles: [{ id: "night" }] },
				{ deviceId: "host", profiles: [] },
			],
		});
		expect(issues).toContainEqual({
			severity: "error",
			message: "profile gone",
			nodeId: "worker",
		});
	});

	test("connections and profiles count only once they load", () => {
		const loading = checkDraft(flow, messages).issues.map((i) => i.message);
		expect(loading).not.toContain("connection github");
		expect(loading).not.toContain("profile night");
		const loaded = checkDraft(flow, messages, {
			connections: [],
			devices: [{ deviceId: "mac", profiles: [{ id: "day" }] }],
		}).issues;
		expect(loaded).toContainEqual({
			severity: "error",
			message: "connection github",
			nodeId: "worker",
		});
		expect(loaded).toContainEqual({
			severity: "error",
			message: "profile night",
			nodeId: "worker",
		});
	});

	describe("an Agent node in a mode that refuses commands", () => {
		const worker = (fields: Partial<AgentNode>): Flow => ({
			...flow,
			nodes: [
				{
					...agentNode("worker", { x: 0, y: 0 }),
					prompt: "Work.",
					profile: { device: "mac", profile: "night" },
					permissionMode: undefined,
					...fields,
				},
			],
		});
		/** The warnings, with the Device "mac" that has the profile "night" in `mode`. */
		const warnings = (
			draft: Flow,
			mode?: NonNullable<AgentNode["permissionMode"]>,
		) => {
			const devices: PlaceDevice[] = [
				{ deviceId: "mac", profiles: [{ id: "night", permissionMode: mode }] },
			];
			return checkDraft(draft, messages, mode ? { devices } : {}).issues.filter(
				(issue) => issue.severity === "warning",
			);
		};

		test("its profile's mode counts once the profiles load", () => {
			const draft = worker({});
			expect(warnings(draft)).toEqual([]);
			expect(warnings(draft, "acceptEdits")).toEqual([
				{
					severity: "warning",
					message: "worker refuses commands in acceptEdits",
					nodeId: "worker",
				},
			]);
		});

		test("its own mode wins over the profile's", () => {
			expect(
				warnings(worker({ permissionMode: "auto" }), "acceptEdits"),
			).toEqual([]);
			expect(
				warnings(worker({ permissionMode: "default" }), "auto").map(
					(issue) => issue.message,
				),
			).toEqual(["worker refuses commands in default"]);
		});

		test("plan mode and the wider modes do not warn", () => {
			for (const permissionMode of [
				"plan",
				"auto",
				"bypassPermissions",
			] as const) {
				expect(warnings(worker({}), permissionMode)).toEqual([]);
			}
		});
	});

	test("a profile on a Device whose profiles this computer cannot tell is not marked", () => {
		const issues = checkDraft(flow, messages, {
			connections: ["github"],
			devices: [{ deviceId: "mac" }],
		}).issues.map((i) => i.message);
		expect(issues).not.toContain("profile night");
	});

	test("a Decision by a model names a profile too; by a person it reads none", () => {
		const decision = {
			id: "pick",
			type: "decision" as const,
			position: { x: 0, y: 0 },
			prompt: "Go?",
			options: [{ name: "yes" }],
			by: "model" as const,
			profile: { device: "mac", profile: "small" },
		};
		const check = (by: "model" | "person") =>
			checkDraft(
				{ ...flow, nodes: [{ ...decision, by }], start: "pick" },
				messages,
				{ devices: [{ deviceId: "mac", profiles: [{ id: "day" }] }] },
			).issues.map((i) => i.message);
		expect(check("model")).toContain("profile small");
		expect(check("person")).not.toContain("profile small");
	});
	test("a command that calls a program without its login: a warning on its node", () => {
		const draft: Flow = {
			...flow,
			nodes: [
				{
					...commandNode("list", { x: 0, y: 0 }),
					command: "list=$(acli jira workitem search --json | jq .)",
				},
			],
			start: "list",
		};
		const cliTools = [
			{ name: "acli-work", program: "acli", signsIn: true },
			{ name: "gh", program: null, signsIn: true },
		];
		const loading = checkDraft(draft, messages).issues;
		expect(loading.some((i) => i.message.includes("without"))).toBe(false);
		expect(
			checkDraft(draft, messages, { cliTools }).issues.filter((i) =>
				i.message.includes("without"),
			),
		).toEqual([
			{
				severity: "warning",
				message: "acli without acli-work",
				nodeId: "list",
			},
		]);
	});

	test("a node that names a device nobody has is an error, once the devices load", () => {
		const draft: Flow = {
			...flow,
			start: "sync",
			nodes: [
				{
					id: "sync",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:knowledge/folder",
					inputs: {},
					device: "old-mac",
				},
				{
					...commandNode("build", { x: 0, y: 0 }),
					command: "make",
					device: "studio",
				},
			],
		};
		const marked = (ids?: string[]) =>
			checkDraft(
				draft,
				messages,
				ids ? { devices: ids.map((deviceId) => ({ deviceId })) } : {},
			).issues.filter((issue) => issue.message.includes(" on "));
		expect(marked()).toEqual([]);
		expect(marked(["studio"])).toEqual([
			{ severity: "error", message: "call on old-mac", nodeId: "sync" },
		]);
	});

	test("a step that needs the project's folder warns only in a project without one", () => {
		const draft: Flow = {
			...flow,
			start: "publish",
			nodes: [
				{
					id: "publish",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:github/publish-draft-pr",
					inputs: { title: "Notes" },
				},
				{ ...commandNode("commit", { x: 0, y: 0 }), command: "git commit" },
			],
		};
		const folderIssues = (folder?: boolean) =>
			checkDraft(
				draft,
				messages,
				folder === undefined ? {} : { folder },
			).issues.filter((issue) => issue.message.startsWith("folder"));
		expect(folderIssues()).toEqual([]);
		expect(folderIssues(true)).toEqual([]);
		expect(folderIssues(false)).toEqual([
			{
				severity: "warning",
				message: "folder kit for publish",
				nodeId: "publish",
			},
			{
				severity: "warning",
				message: "folder git for commit",
				nodeId: "commit",
			},
		]);
	});
});
