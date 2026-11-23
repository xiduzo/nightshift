import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { useTypesafeDecider } from "./use-typesafe-decider";

describe("useTypesafeDecider", () => {
	test("asks for a key when none is saved", async () => {
		const twins = inMemoryDeciderSetupPorts();
		await expect(
			useTypesafeDecider({ ...twins, job: createDeciderJob() })(NIGHT_SHIFT, {
				key: null,
				here: true,
			}),
		).rejects.toThrow("Paste the key TypeSafe gave you.");
	});
});
