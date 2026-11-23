import { describe, expect, test } from "bun:test";
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
