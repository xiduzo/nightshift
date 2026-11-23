import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAgentSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createAgentJobs } from "../domain/setup-jobs";
import { readAgentSetup } from "./read-agent-setup";

describe("readAgentSetup", () => {
	test("lists Claude Code and Codex on this computer", () => {
		const twins = inMemoryAgentSetupPorts();
		const jobs = createAgentJobs();
		const status = readAgentSetup({ ...twins, jobs })(NIGHT_SHIFT, {
			here: true,
		});
		expect(status.available).toBe(true);
		expect(status.agents.map((a) => a.harness)).toEqual([
			"claude-code",
			"codex",
		]);
		expect(status.agents[0]?.install.command).toBe(
			"curl -fsSL https://claude.ai/install.sh | bash",
		);
	});

	test("is not available from elsewhere", () => {
		const twins = inMemoryAgentSetupPorts();
		const status = readAgentSetup({ ...twins, jobs: createAgentJobs() })(
			NIGHT_SHIFT,
			{ here: false },
		);
		expect(status).toMatchObject({
			available: false,
			reason: "elsewhere",
			message: "Open Night Shift on that computer to set up an agent there.",
		});
	});
});
