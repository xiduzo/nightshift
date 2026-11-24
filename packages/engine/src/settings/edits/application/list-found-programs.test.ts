import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryEditedCliTools,
	inMemoryEditedProfiles,
	inMemoryEditedSettings,
	inMemoryPrograms,
} from "../adapters/out/in-memory-neighbours";
import { listFoundPrograms } from "./list-found-programs";

describe("listFoundPrograms", () => {
	test("offers the agent CLIs and the kits' tools it finds, agents first", () => {
		const list = listFoundPrograms({
			settings: inMemoryEditedSettings({ bins: { "claude-code": "claude" } }),
			profiles: inMemoryEditedProfiles(),
			cliTools: inMemoryEditedCliTools(),
			programs: inMemoryPrograms(["claude", "pi", "gh", "aws"]),
		});
		expect(list(NIGHT_SHIFT)).toEqual([
			{
				kind: "agent",
				program: "claude",
				harness: "claude-code",
				label: "Claude Code",
			},
			{ kind: "agent", program: "pi", harness: "pi", label: "pi" },
			{ kind: "tool", program: "gh", label: "GitHub CLI" },
		]);
	});

	test("nothing on this computer offers nothing, and a harness's setting names its program", () => {
		const list = (programs: string[]) =>
			listFoundPrograms({
				settings: inMemoryEditedSettings({
					bins: { "claude-code": "claude-beta" },
				}),
				profiles: inMemoryEditedProfiles(),
				cliTools: inMemoryEditedCliTools(),
				programs: inMemoryPrograms(programs),
			})(NIGHT_SHIFT).map((found) => found.program);
		expect(list([])).toEqual([]);
		expect(list(["claude", "claude-beta"])).toEqual(["claude-beta"]);
	});

	test("a tool that runs the program counts as set up", async () => {
		const cliTools = inMemoryEditedCliTools();
		await cliTools.save({ name: "gh-work", program: "gh" });
		const list = listFoundPrograms({
			settings: inMemoryEditedSettings(),
			profiles: inMemoryEditedProfiles(),
			cliTools,
			programs: inMemoryPrograms(["gh", "acli"]),
		});
		expect(list(NIGHT_SHIFT).map((found) => found.program)).toEqual(["acli"]);
	});
});
