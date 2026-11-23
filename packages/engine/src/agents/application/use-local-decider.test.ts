import { describe, expect, test } from "bun:test";
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
