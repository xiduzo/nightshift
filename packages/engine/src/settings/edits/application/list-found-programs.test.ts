import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCliTools } from "../../cli-tools/adapters/out/in-memory-cli-tools";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { inMemorySettings } from "../../settings/adapters/out/in-memory-settings";
import { inMemoryPrograms } from "../adapters/out/in-memory-neighbours";
import { listFoundPrograms } from "./list-found-programs";

describe("listFoundPrograms", () => {
	test("offers the agent CLIs and the kits' tools it finds, agents first", () => {
		const list = listFoundPrograms({
			computerAccess: inMemoryComputer(),
			settings: inMemorySettings({ claudeBin: "claude" }),
			profiles: inMemoryProfiles(),
			cliTools: inMemoryCliTools(),
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
				computerAccess: inMemoryComputer(),
				settings: inMemorySettings({
					claudeBin: "claude-beta",
				}),
				profiles: inMemoryProfiles(),
				cliTools: inMemoryCliTools(),
				programs: inMemoryPrograms(programs),
			})(NIGHT_SHIFT).map((found) => found.program);
		expect(list([])).toEqual([]);
		expect(list(["claude", "claude-beta"])).toEqual(["claude-beta"]);
	});

	test("a tool that runs the program counts as set up", async () => {
		const cliTools = inMemoryCliTools();
		await cliTools.save({ name: "gh-work", program: "gh" });
		const list = listFoundPrograms({
			computerAccess: inMemoryComputer(),
			settings: inMemorySettings(),
			profiles: inMemoryProfiles(),
			cliTools,
			programs: inMemoryPrograms(["gh", "acli"]),
		});
		expect(list(NIGHT_SHIFT).map((found) => found.program)).toEqual(["acli"]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = listFoundPrograms({ computerAccess } as never);
	expect(await computerAccess.whoMay((actor) => act(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});
