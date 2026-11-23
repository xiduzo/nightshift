import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAgentSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createAgentJobs } from "../domain/setup-jobs";
import { sendSignInCode } from "./send-sign-in-code";

describe("sendSignInCode", () => {
	test("refuses when no sign-in waits", () => {
		const twins = inMemoryAgentSetupPorts();
		expect(() =>
			sendSignInCode({ ...twins, jobs: createAgentJobs() })(NIGHT_SHIFT, {
				harness: "claude-code",
				code: "abc",
				here: true,
			}),
		).toThrow(
			"Claude Code is not waiting for a code. Start the sign-in again.",
		);
	});
});
