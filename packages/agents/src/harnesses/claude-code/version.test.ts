import { describe, expect, test } from "bun:test";
import {
	claudeCodeVersion,
	claudeKnowsThinkingDisplay,
	knowsThinkingDisplay,
} from "./version";

describe("claudeCodeVersion", () => {
	test("reads the first line of `claude --version`", () => {
		expect(claudeCodeVersion("2.1.314 (Claude Code)\n")).toEqual([2, 1, 314]);
		expect(claudeCodeVersion("\n  2.1.94\n")).toEqual([2, 1, 94]);
	});

	test("no version in other text", () => {
		expect(claudeCodeVersion("")).toBeNull();
		expect(claudeCodeVersion("error: unknown option")).toBeNull();
		expect(claudeCodeVersion("Claude Code 2.1.94")).toBeNull();
	});
});

describe("knowsThinkingDisplay", () => {
	test("from 2.1.94 on", () => {
		expect(knowsThinkingDisplay([2, 1, 93])).toBe(false);
		expect(knowsThinkingDisplay([2, 1, 94])).toBe(true);
		expect(knowsThinkingDisplay([2, 1, 314])).toBe(true);
		expect(knowsThinkingDisplay([2, 2, 0])).toBe(true);
		expect(knowsThinkingDisplay([3, 0, 0])).toBe(true);
		expect(knowsThinkingDisplay([1, 9, 999])).toBe(false);
		expect(knowsThinkingDisplay(null)).toBe(false);
	});
});

describe("claudeKnowsThinkingDisplay", () => {
	const answers = (stdout: string, code = 0) => {
		const calls: string[][] = [];
		const run = async (argv: string[]) => {
			calls.push(argv);
			return { code, stdout, stderr: "" };
		};
		return { calls, run };
	};

	test("probes each executable once", async () => {
		const { calls, run } = answers("2.1.314 (Claude Code)\n");
		expect(await claudeKnowsThinkingDisplay("/opt/a/claude", run)).toBe(true);
		expect(await claudeKnowsThinkingDisplay("/opt/a/claude", run)).toBe(true);
		expect(calls).toEqual([["/opt/a/claude", "--version"]]);
	});

	test("an older version, a failed probe or garbage gives false", async () => {
		expect(
			await claudeKnowsThinkingDisplay(
				"/opt/b/claude",
				answers("2.1.93 (Claude Code)").run,
			),
		).toBe(false);
		expect(
			await claudeKnowsThinkingDisplay(
				"/opt/c/claude",
				answers("2.1.314 (Claude Code)", 1).run,
			),
		).toBe(false);
		expect(
			await claudeKnowsThinkingDisplay("/opt/d/claude", answers("garbage").run),
		).toBe(false);
		expect(
			await claudeKnowsThinkingDisplay("/opt/e/claude", async () => {
				throw new Error("not there");
			}),
		).toBe(false);
	});

	test("splits the executable on spaces, as the adapter does", async () => {
		const { calls, run } = answers("2.1.94");
		expect(await claudeKnowsThinkingDisplay("/opt/f/claude --debug", run)).toBe(
			true,
		);
		expect(calls).toEqual([["/opt/f/claude", "--debug", "--version"]]);
	});
});
