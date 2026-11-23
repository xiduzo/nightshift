import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCli } from "../../testing/fixtures/cli";
import { opencodeMajor, opencodeNestedToolCalls, opencodeRules } from "./acp";
import { opencodePermission } from "./permissions";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-opencode-acp-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("opencodeRules", () => {
	test("keeps the order, renames 1.x permissions and allows execute last", () => {
		expect(
			opencodeRules({
				"*": "deny",
				read: "allow",
				bash: { "*": "deny", "gh *": "allow" },
				task: "deny",
				tanstack_report_step: "allow",
			}),
		).toEqual([
			{ action: "*", resource: "*", effect: "deny" },
			{ action: "read", resource: "*", effect: "allow" },
			{ action: "shell", resource: "*", effect: "deny" },
			{ action: "shell", resource: "gh *", effect: "allow" },
			{ action: "subagent", resource: "*", effect: "deny" },
			{ action: "tanstack_report_step", resource: "*", effect: "allow" },
			{ action: "execute", resource: "*", effect: "allow" },
		]);
	});

	test("a read-only mode denies edits and commands, and allows the bridged tools", () => {
		const rules = opencodeRules(opencodePermission("default"));
		/** The effect of the last rule that matches, as OpenCode 2.x reads them. */
		const effect = (action: string) =>
			rules.findLast(
				(rule) =>
					rule.resource === "*" &&
					(rule.action === action ||
						rule.action === "*" ||
						(rule.action.endsWith("*") &&
							action.startsWith(rule.action.slice(0, -1)))),
			)?.effect;
		expect(effect("edit")).toBe("deny");
		expect(effect("shell")).toBe("deny");
		expect(effect("question")).toBe("deny");
		expect(effect("read")).toBe("allow");
		expect(effect("tanstack_report_step")).toBe("allow");
		expect(effect("execute")).toBe("allow");
	});
});

describe("opencodeNestedToolCalls", () => {
	const result = (toolCalls: unknown[]) =>
		JSON.stringify({ metadata: { toolCalls, truncated: false } });

	test("reads the bridged calls of an execute result", () => {
		const input = { outcome: "pass", summary: "Done." };
		expect(
			opencodeNestedToolCalls(
				result([
					{ tool: "tanstack.report_step", status: "completed", input },
					{ tool: "tanstack.save_artifact", status: "error", input: {} },
				]),
			),
		).toEqual([
			{ name: "report_step", input, failed: false },
			{ name: "save_artifact", input: {}, failed: true },
		]);
	});

	test("ignores the tools of other MCP servers", () => {
		expect(
			opencodeNestedToolCalls(
				result([{ tool: "other.report_step", status: "completed", input: {} }]),
			),
		).toEqual([]);
	});

	test("other results give none", () => {
		expect(opencodeNestedToolCalls("hello")).toEqual([]);
		expect(opencodeNestedToolCalls('{"metadata":{"truncated":false}}')).toEqual(
			[],
		);
		expect(opencodeNestedToolCalls(undefined)).toEqual([]);
	});
});

describe("opencodeMajor", () => {
	test("reads 2.x and 1.x versions", async () => {
		const v2 = await fakeCli(dir, "opencode2", {
			"--version": { stdout: "opencode v2.0.22\n" },
		});
		const v1 = await fakeCli(dir, "opencode1", {
			"--version": { stdout: "1.19.2\n" },
		});
		expect(await opencodeMajor(v2)).toBe(2);
		expect(await opencodeMajor(v1)).toBe(1);
	});

	test("a missing executable gives undefined", async () => {
		expect(await opencodeMajor("nightshift-no-such-opencode")).toBeUndefined();
	});
});
