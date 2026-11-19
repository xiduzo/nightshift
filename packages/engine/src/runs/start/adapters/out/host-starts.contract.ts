import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HostUnreachableError } from "../../../../contract";
import type { HostStarts } from "../../application/ports";

/** One adapter of `HostStarts` to test: a Host that takes starts, and this Replica that the runs reach. */
export type HostStartsUnderTest = {
	hosts: HostStarts;
	/** The starts the Host took, in order. */
	started(): readonly unknown[];
	/** The run's row reaches this Replica. */
	rowArrives(runId: string): Promise<void>;
	/** The run's first event reaches this Replica, and its run list shows it. */
	eventArrives(runId: string): Promise<void>;
	close(): Promise<void>;
};

/** An adapter without a Host to reach. */
export type HostStartsAlone = () => HostStarts;

/**
 * What every adapter of `HostStarts` does. `host-starts.contract.test.ts`
 * runs it on the in-memory adapter and on the one over a Host's Link.
 */
export function hostStartsContract(
	name: string,
	make: () => Promise<HostStartsUnderTest>,
	alone: HostStartsAlone,
): void {
	describe(`HostStarts contract: ${name}`, () => {
		let under: HostStartsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("the Host takes the start with its Space, and gives the run's id", async () => {
			const input = {
				projectId: "project-1",
				flowName: "watch",
				spaceId: "space-1",
			};
			const { runId } = await under.hosts.start(input);
			expect(runId).toBeString();
			expect(under.started()).toEqual([input]);
		});

		test("a run has not arrived until its row and its first event are here", async () => {
			const { runId } = await under.hosts.start({
				projectId: "project-1",
				flowName: "watch",
				spaceId: "space-1",
			});
			const where = { runId, spaceId: "space-1", projectId: "project-1" };
			expect(await under.hosts.arrived(where)).toBeNull();
			await under.rowArrives(runId);
			expect(await under.hosts.arrived(where)).toBeNull();
			await under.eventArrives(runId);
			expect((await under.hosts.arrived(where))?.id).toBe(runId);
		});

		test("without a Host to reach, a start is refused", async () => {
			await expect(
				alone().start({
					projectId: "project-1",
					flowName: "watch",
					spaceId: "space-1",
				}),
			).rejects.toBeInstanceOf(HostUnreachableError);
		});
	});
}
