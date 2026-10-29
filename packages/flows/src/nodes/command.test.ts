import { describe, expect, test } from "bun:test";
import { commandNode } from "../draft/nodes";
import { FLOW_VERSION, type Flow } from "../flow";
import { validateFlow } from "../validate";
import { reservedOutcomes } from "./base";
import {
	type CommandNode,
	DEFAULT_COMMAND_EXITS,
	dataExitFor,
	exitFor,
	isChosenExit,
	STANDARD_EXIT_CODES,
} from "./command";

function single(node: CommandNode): Flow {
	return {
		version: FLOW_VERSION,
		start: node.id,
		inputs: [],
		outputs: [],
		nodes: [node],
		edges: [],
	};
}

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
		const errors = validateFlow(single(node)).filter(
			(issue) => issue.severity === "error",
		);
		expect(errors).toEqual([]);
	});
});

describe("Command exits picked by data", () => {
	const exits: CommandNode["exits"] = [
		{ name: "created", code: 0 },
		{ name: "exists", code: "data" },
		{ name: "failure", code: 1 },
		{ name: "other" },
	];

	test("data with an outcome that names an exit picks it, any exit", () => {
		expect(dataExitFor({ exits }, { outcome: "exists" })?.name).toBe("exists");
		expect(dataExitFor({ exits }, { outcome: "failure" })?.name).toBe(
			"failure",
		);
	});

	test("other data leaves the pick to the exit code", () => {
		for (const data of [
			undefined,
			null,
			"exists",
			["exists"],
			{ outcome: 3 },
			{ outcome: "unknown" },
			{ count: 1 },
		]) {
			expect(dataExitFor({ exits }, data)).toBeUndefined();
		}
	});

	test("a node without exits: data picks pass or fail", () => {
		expect(dataExitFor({}, { outcome: "fail" })?.name).toBe("fail");
	});

	test("no exit code matches an exit picked by data", () => {
		expect(exitFor({ exits }, 0)?.name).toBe("created");
		expect(exitFor({ exits }, 7)?.name).toBe("other");
		expect(exitFor({ exits }, null)?.name).toBe("other");
	});

	test("the exit on 0 and the exits picked by data are chosen ends", () => {
		expect(isChosenExit({ exits }, "created")).toBe(true);
		expect(isChosenExit({ exits }, "exists")).toBe(true);
		expect(isChosenExit({ exits }, "failure")).toBe(false);
		expect(isChosenExit({ exits }, "other")).toBe(false);
	});

	test("an exit picked by data is neither a code nor the catch-all", () => {
		const node: CommandNode = {
			...commandNode("check", { x: 0, y: 0 }),
			command: "./make-branch",
			exits: [
				{ name: "created", code: 0 },
				{ name: "exists", code: "data" },
				{ name: "taken", code: "data" },
				{ name: "other" },
			],
		};
		expect(validateFlow(single(node))).toEqual([]);
	});
});
