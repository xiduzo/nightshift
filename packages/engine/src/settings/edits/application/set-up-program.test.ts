import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCliTools } from "../../cli-tools/adapters/out/in-memory-cli-tools";
import { inMemoryConnections } from "../../connections/adapters/out/in-memory-connections";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { inMemorySettings } from "../../settings/adapters/out/in-memory-settings";
import { inMemoryPrograms } from "../adapters/out/in-memory-neighbours";
import { setUpProgram } from "./set-up-program";

function wired(found: string[]) {
	const ports = {
		settings: inMemorySettings({
			harnesses: ["claude-code"],
			agentPermissionMode: "acceptEdits",
			claudeBin: "claude",
		}),
		profiles: inMemoryProfiles(),
		cliTools: inMemoryCliTools(),
		connections: inMemoryConnections(),
		programs: inMemoryPrograms(found),
	};
	return {
		ports,
		setUp: setUpProgram({ ...ports, computerAccess: inMemoryComputer() }),
	};
}

describe("setUpProgram", () => {
	test("an agent CLI gets its harness and a profile named after it", async () => {
		const { ports, setUp } = wired(["pi", "claude"]);
		expect(await setUp(NIGHT_SHIFT, { program: "pi" })).toMatchObject({
			kind: "agent",
			name: "pi",
		});
		expect(ports.settings.current().harnesses).toContain("pi");
		expect(ports.profiles.byName("pi")).toMatchObject({
			harness: "pi",
			permissionMode: "acceptEdits",
		});
	});

	test("a taken profile name gets a number", async () => {
		const { ports, setUp } = wired(["claude"]);
		await ports.profiles.save({ name: "claude", decider: "ollama" });
		expect(await setUp(NIGHT_SHIFT, { program: "claude" })).toMatchObject({
			kind: "agent",
			name: "claude_2",
		});
	});

	test("a CLI tool gets a tool of its name", async () => {
		const { ports, setUp } = wired(["acli"]);
		expect(await setUp(NIGHT_SHIFT, { program: "acli" })).toEqual({
			kind: "tool",
			name: "acli",
		});
		expect(ports.cliTools.get("acli")).not.toBeNull();
	});

	test("refuses a program that is not found, or is set up already", async () => {
		const { setUp } = wired(["gh"]);
		await expect(setUp(NIGHT_SHIFT, { program: "acli" })).rejects.toThrow(
			"Night Shift does not find acli on this computer, or it is set up already.",
		);
		await setUp(NIGHT_SHIFT, { program: "gh" });
		await expect(setUp(NIGHT_SHIFT, { program: "gh" })).rejects.toThrow(
			"set up already",
		);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = setUpProgram({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
