import { describe, expect, test } from "bun:test";
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
