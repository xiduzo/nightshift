import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { HandOffFailure } from "../../log";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	placementOn,
	startRun,
} from "../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	testDevice,
} from "../../testing/test-support";

/**
 * A Hand-off that fails is a fact of the step it fails: `StepEnded`
 * says which side failed (`handOffFailed`). The error keeps its words for
 * a person, and no reader looks in them.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/**
 * one (on the run's Device) → two (on Device b). The run's work moves to
 * b before two: `fails` names the side of the Hand-off that refuses.
 */
async function handOff(fails: HandOffFailure) {
	const h = await startRun(
		sandbox,
		flowOf(
			[command("one", "true"), command("two", "true", { device: "b" })],
			[edge("e1", "one", "pass", "two")],
		),
	);
	const deviceNames = JSON.stringify({ b: "studio-b" });
	await sandbox.db.update(run).set({ deviceNames }).where(eq(run.id, h.runId));
	h.ctx.run = { ...h.ctx.run, deviceNames };
	const here = testDevice(h.local);
	const onB = { ...testDevice(h.local, "b"), name: "studio-b" };
	h.ctx.placement = placementOn((id) => ({
		...(id === "b" ? onB : here),
		handOff: async () => {
			if (fails === "send") {
				throw new Refusal("conflict", "The copy has changes.");
			}
			return { commit: "c0ffee", branch: "nightshift/test" };
		},
		receiveHandOff: async ({ branch }) => {
			if (fails === "receive") {
				throw new Refusal("unavailable", "The fetch failed.");
			}
			return { worktreePath: sandbox.repoPath, branch, baseRef: "main" };
		},
	}));
	await drive(h, { inputs: {} });
	return payloads(await h.events(), "StepEnded");
}

describe("a Hand-off that fails", () => {
	test("the work cannot be sent: the step ends error, and its end says so", async () => {
		const [one, two] = await handOff("send");
		expect(one?.handOffFailed).toBeUndefined();
		expect(two).toMatchObject({ outcome: "error", handOffFailed: "send" });
		expect(two?.error).toContain("cannot move to studio-b");
	});

	test("the step's Device cannot take the work: the step ends error, and its end says so", async () => {
		const [, two] = await handOff("receive");
		expect(two).toMatchObject({ outcome: "error", handOffFailed: "receive" });
		expect(two?.error).toContain("studio-b could not take the run's work");
	});
});
