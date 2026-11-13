import { describe, expect, test } from "bun:test";
import { BUILTIN_AGENTS } from "@nightshift/flows";
import {
	BUILTIN_TOOLS,
	BUILTIN_TOP_TIER,
	TOOL_TIERS,
	toolAnnotations,
	withinTier,
} from "./builtin-tools";
import { HISTORY_TOOLS } from "./history";
import { TERMINAL_TOOLS } from "./terminal";
import { RUN_TOOLS } from "./terminal-runs";
import { AUTHORING_TOOLS } from "./tools";

/** Every tool Night Shift hands to an agent, in the chat or in a terminal. */
const NAMES = [
	...Object.values(AUTHORING_TOOLS),
	...Object.values(HISTORY_TOOLS),
	...Object.values(TERMINAL_TOOLS),
	...Object.values(RUN_TOOLS),
];

describe("the tiers of the tools", () => {
	test("every tool has a tier", () => {
		for (const name of NAMES) expect(TOOL_TIERS[name]).toBeDefined();
	});

	test("a built-in agent lists only tools that exist, at most at the propose tier", () => {
		for (const { id } of BUILTIN_AGENTS) {
			for (const name of BUILTIN_TOOLS[id]) {
				const tier = TOOL_TIERS[name];
				expect(tier).toBeDefined();
				if (tier) expect(withinTier(tier, BUILTIN_TOP_TIER)).toBe(true);
			}
		}
	});

	test("only an agent that works in turns has tools", () => {
		for (const { id, takes } of BUILTIN_AGENTS) {
			if (takes !== "agent-with-tools") expect(BUILTIN_TOOLS[id]).toEqual([]);
		}
	});

	test("the Builder reads no run, the Improver does", () => {
		expect(BUILTIN_TOOLS.builder).not.toContain("list_runs");
		expect(BUILTIN_TOOLS.builder).not.toContain("get_run");
		expect(BUILTIN_TOOLS.improver).toContain("list_runs");
	});

	test("a tool that acts is marked for the client of a terminal agent", () => {
		expect(toolAnnotations("save_flow")).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
		});
		expect(toolAnnotations("list_runs")).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
		});
	});
});
