import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAgentSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createAgentJobs } from "../domain/setup-jobs";
import { cancelAgentSetup } from "./cancel-agent-setup";

describe("cancelAgentSetup", () => {
	test("returns the view when nothing runs", () => {
		const twins = inMemoryAgentSetupPorts();
		const view = cancelAgentSetup({ ...twins, jobs: createAgentJobs() })(
			NIGHT_SHIFT,
			{ harness: "codex", here: true },
		);
		expect(view.harness).toBe("codex");
		expect(view.job.state).toBe("idle");
	});
});
