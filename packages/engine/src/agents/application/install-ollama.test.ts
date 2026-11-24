import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { installOllama } from "./install-ollama";

describe("installOllama", () => {
	test("refuses when Ollama is already here", async () => {
		const twins = inMemoryDeciderSetupPorts({
			programs: { brew: "/opt/homebrew/bin/brew" },
		});
		await expect(
			installOllama({ ...twins, job: createDeciderJob() })(NIGHT_SHIFT, {
				here: true,
			}),
		).rejects.toThrow("Ollama is on this computer already.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = installOllama({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
