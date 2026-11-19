import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Waits } from "../../application/ports";

/** One adapter of `Waits` to test. */
export type WaitsUnderTest = {
	waits: Waits;
	/**
	 * Adds a run of the project with a step `s1` that started. With `wait`,
	 * the step then sleeps for that reason, on that signal when it names one.
	 * With `woke`, it ended its wait since.
	 */
	add(run: {
		id: string;
		projectId: "project-1" | "project-2";
		here: boolean;
		wait?: { reason: "signal" | "lease" | "device-offline"; signal?: string };
		woke?: boolean;
	}): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `Waits` does: the sleeps and the signals of the
 * runs this computer walks, and of no other run.
 * `waits.contract.test.ts` runs it on the in-memory adapter and on the
 * real one over libsql in memory.
 */
export function waitsContract(
	name: string,
	make: () => Promise<WaitsUnderTest>,
): void {
	describe(`Waits contract: ${name}`, () => {
		let under: WaitsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("sleeping gives the sleep of each run this computer walks, and null for a run that does not sleep", async () => {
			await under.add({
				id: "run-lease",
				projectId: "project-1",
				here: true,
				wait: { reason: "lease" },
			});
			await under.add({ id: "run-busy", projectId: "project-1", here: true });
			await under.add({
				id: "run-far",
				projectId: "project-1",
				here: false,
				wait: { reason: "lease" },
			});
			const sleeping = await under.waits.sleeping();
			expect([...sleeping.keys()].sort()).toEqual(["run-busy", "run-lease"]);
			expect(sleeping.get("run-lease")).toMatchObject({
				stepId: "s1",
				reason: "lease",
			});
			expect(sleeping.get("run-busy")).toBeNull();
		});

		test("waitedFor gives the runs of that project here that waited for a signal of that name", async () => {
			const deployed = { reason: "signal" as const, signal: "deployed" };
			await under.add({
				id: "run-1",
				projectId: "project-1",
				here: true,
				wait: deployed,
			});
			await under.add({
				id: "run-other-name",
				projectId: "project-1",
				here: true,
				wait: { reason: "signal", signal: "merged" },
			});
			await under.add({
				id: "run-other-project",
				projectId: "project-2",
				here: true,
				wait: deployed,
			});
			await under.add({
				id: "run-far",
				projectId: "project-1",
				here: false,
				wait: deployed,
			});
			expect(await under.waits.waitedFor("project-1", "deployed")).toEqual([
				"run-1",
			]);
		});

		test("waitedFor keeps a run that waited once and moved on: its log says so", async () => {
			await under.add({
				id: "run-1",
				projectId: "project-1",
				here: true,
				wait: { reason: "signal", signal: "deployed" },
				woke: true,
			});
			expect(await under.waits.waitedFor("project-1", "deployed")).toEqual([
				"run-1",
			]);
			expect((await under.waits.sleeping()).get("run-1")).toBeNull();
		});
	});
}
