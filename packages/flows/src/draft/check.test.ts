import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "../flow";
import { checkDraft, type DraftMessages, isSavable } from "./check";
import { agentNode, commandNode } from "./nodes";

const messages: DraftMessages = {
	schemaIssue: (_flow, issue) => `schema ${issue.path.map(String).join(".")}`,
	missingConnection: (name) => `connection ${name}`,
	missingProfile: (profile) => `profile ${profile.profile}`,
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

	test("connections and profiles count only once they load", () => {
		const loading = checkDraft(flow, messages).issues.map((i) => i.message);
		expect(loading).not.toContain("connection github");
		const loaded = checkDraft(flow, messages, {
			connections: [],
			profiles: [{ device: "mac", profile: "day" }],
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

	test("a profile on a Device whose profiles this computer cannot tell is not marked", () => {
		const issues = checkDraft(flow, messages, {
			connections: ["github"],
			profiles: [],
			untoldDevices: ["mac"],
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
				{ profiles: [{ device: "mac", profile: "day" }] },
			).issues.map((i) => i.message);
		expect(check("model")).toContain("profile small");
		expect(check("person")).not.toContain("profile small");
	});
});
