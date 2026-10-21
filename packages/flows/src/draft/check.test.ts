import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "../document";
import { checkDraft, type DraftMessages, isSavable } from "./check";
import { agentNode, commandNode } from "./nodes";

const messages: DraftMessages = {
	schemaIssue: (_flow, issue) => `schema ${issue.path.map(String).join(".")}`,
	missingConnection: (name) => `connection ${name}`,
	missingProfile: (name) => `profile ${name}`,
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
			profile: "night",
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
			profiles: ["day"],
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
});
