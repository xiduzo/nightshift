import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAgentSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createAgentJobs } from "../domain/setup-jobs";
import { signInAgent } from "./sign-in-agent";

describe("signInAgent", () => {
	test("refuses when the CLI is not installed", () => {
		const twins = inMemoryAgentSetupPorts({
			programs: { curl: "/usr/bin/curl" },
		});
		expect(() =>
			signInAgent({ ...twins, jobs: createAgentJobs() })(NIGHT_SHIFT, {
				harness: "claude-code",
				here: true,
			}),
		).toThrow(
			"Claude Code is not installed on this computer. Install it first.",
		);
	});

	test("starts checking when the CLI is here", () => {
		const twins = inMemoryAgentSetupPorts({
			programs: { claude: "/usr/local/bin/claude", curl: "/usr/bin/curl" },
			checks: ["signed_in"],
		});
		const view = signInAgent({ ...twins, jobs: createAgentJobs() })(
			NIGHT_SHIFT,
			{
				harness: "claude-code",
				here: true,
			},
		);
		expect(view.job.state).toBe("checking");
	});
});
