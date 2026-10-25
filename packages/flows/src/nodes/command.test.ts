import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "../document";
import { commandNode } from "../draft/nodes";
import { validateFlow } from "../validate";
import { reservedOutcomes } from "./base";
import { DEFAULT_COMMAND_EXITS, STANDARD_EXIT_CODES } from "./command";

describe("Command exits", () => {
	test("no exit a Command node starts with or offers uses an outcome the engine keeps", () => {
		const reserved: readonly string[] = reservedOutcomes;
		const names = [...DEFAULT_COMMAND_EXITS, ...STANDARD_EXIT_CODES].map(
			(exit) => exit.name,
		);
		expect(names.filter((name) => reserved.includes(name))).toEqual([]);
	});

	test("a new Command node has no errors", () => {
		const node = { ...commandNode("check", { x: 0, y: 0 }), command: "true" };
		const flow: Flow = {
			version: FLOW_VERSION,
			start: "check",
			inputs: [],
			outputs: [],
			nodes: [node],
			edges: [],
		};
		const errors = validateFlow(flow).filter(
			(issue) => issue.severity === "error",
		);
		expect(errors).toEqual([]);
	});
});
