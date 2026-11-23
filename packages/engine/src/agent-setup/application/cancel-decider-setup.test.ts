import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { cancelDeciderSetup } from "./cancel-decider-setup";

describe("cancelDeciderSetup", () => {
	test("returns the status when nothing runs", async () => {
		const twins = inMemoryDeciderSetupPorts();
		const status = await cancelDeciderSetup({
			...twins,
			job: createDeciderJob(),
		})(NIGHT_SHIFT, { here: true });
		expect(status.job.state).toBe("idle");
	});
});
