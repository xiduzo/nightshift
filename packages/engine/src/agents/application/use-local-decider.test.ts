import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { useLocalDecider } from "./use-local-decider";

describe("useLocalDecider", () => {
	test("refuses without Ollama", async () => {
		const twins = inMemoryDeciderSetupPorts({
			ollama: { installed: false, answers: false },
		});
		await expect(
			useLocalDecider({ ...twins, job: createDeciderJob() })(NIGHT_SHIFT, {
				here: true,
			}),
		).rejects.toThrow("Ollama is not on this computer. Install it first.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = useLocalDecider({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
