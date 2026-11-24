import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
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

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = cancelDeciderSetup({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
