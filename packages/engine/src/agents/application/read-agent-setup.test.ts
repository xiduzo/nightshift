import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
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

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = readAgentSetup({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
