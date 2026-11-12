import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	validateFlow,
} from "@nightshift/flows";

import { nodeEdits } from "./node-edits";
import { createEditingSession } from "./session/editing-session";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "topic", type: "text" }],
	outputs: [],
	variables: [{ name: "tries", type: "number" }],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo {{topic}}",
			stdout: "text",
			set: [{ variable: "tries", value: "1" }],
		},
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo",
			stdout: "text",
		},
	],
	edges: [{ id: "e1", from: "build", outcome: "pass", to: "check" }],
});

/** Renames `check` the way the inspector does: the refusal, and the session after. */
function rename(next: string) {
	const session = createEditingSession(flow, { saved: true });
	const check = flow.nodes[1];
	if (!check) throw new Error("expected the node check");
	const refusal = nodeEdits(session).renameSelected(check)(next);
	return { refusal, ...session.get() };
}

describe("renaming a node", () => {
	test.each(["vars", "run", "tries", "topic", "build"])(
		"refuses %s, a name the flow already uses",
		(name) => {
			const { refusal, draft } = rename(name);
			expect(refusal).not.toBeNull();
			expect(draft).toBe(flow);
		},
	);

	test("a free name renames the node and selects it, and the flow stays valid", () => {
		const { refusal, draft, selection } = rename("review");
		expect(refusal).toBeNull();
		expect(draft.nodes.map((node) => node.id)).toEqual(["build", "review"]);
		expect(selection).toEqual({ kind: "node", id: "review" });
		expect(validateFlow(draft).filter((i) => i.severity === "error")).toEqual(
			[],
		);
	});
});
