import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { readDeciderSetup } from "./read-decider-setup";

describe("readDeciderSetup", () => {
	test("without a key, new nodes start on Ollama", async () => {
		const twins = inMemoryDeciderSetupPorts({
			ollama: { installed: false, answers: false },
			programs: { brew: "/opt/homebrew/bin/brew" },
		});
		const status = await readDeciderSetup({
			...twins,
			job: createDeciderJob(),
		})(NIGHT_SHIFT, { here: true });
		expect(status.available).toBe(true);
		expect(status.current).toEqual({ decider: "ollama", chosen: false });
		expect(status.local.install).toEqual({
			kind: "brew",
			command: "brew install ollama",
		});
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = readDeciderSetup({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
