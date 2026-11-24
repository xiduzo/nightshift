import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
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

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = sendSignInCode({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
