import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAgentSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createAgentJobs } from "../domain/setup-jobs";
import { installAgent } from "./install-agent";

describe("installAgent", () => {
	test("starts the vendor's installer", () => {
		const twins = inMemoryAgentSetupPorts();
		const jobs = createAgentJobs();
		const view = installAgent({ ...twins, jobs })(NIGHT_SHIFT, {
			harness: "claude-code",
			here: true,
		});
		expect(view.job.state).toBe("installing");
		expect(twins.started[0]?.argv).toEqual([
			"/bin/sh",
			"-c",
			"curl -fsSL https://claude.ai/install.sh | bash",
		]);
	});

	test("refuses without curl", () => {
		const twins = inMemoryAgentSetupPorts({ programs: {} });
		expect(() =>
			installAgent({ ...twins, jobs: createAgentJobs() })(NIGHT_SHIFT, {
				harness: "codex",
				here: true,
			}),
		).toThrow("Night Shift needs curl to download Codex.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = installAgent({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
