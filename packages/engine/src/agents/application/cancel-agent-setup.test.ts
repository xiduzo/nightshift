import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
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

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = cancelAgentSetup({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
