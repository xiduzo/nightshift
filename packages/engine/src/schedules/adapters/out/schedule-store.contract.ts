import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Flow, Schedule, ScheduleIssue } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { ScheduleStore } from "../../application/ports";

/** One store to test: what an adapter of `ScheduleStore` gives the suite. */
export type ScheduleStoreUnderTest = {
	store: ScheduleStore;
	/** A project the store can read, with the flow `night` and no schedule. */
	projectId: string;
	/** The flow `night` of that project, as it was saved. */
	night: Flow;
	close(): Promise<void>;
};

function nightly(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	};
}

/** What the store refuses with, or null. */
async function refusalOf(work: Promise<unknown>): Promise<unknown> {
	try {
		await work;
	} catch (error) {
		return error;
	}
	return null;
}

/**
 * What every adapter of `ScheduleStore` does.
 * `schedule-store.contract.test.ts` runs it on the in-memory adapter and
 * on the one over the flow documents.
 */
export function scheduleStoreContract(
	name: string,
	make: () => Promise<ScheduleStoreUnderTest>,
): void {
	describe(`ScheduleStore contract: ${name}`, () => {
		let under: ScheduleStoreUnderTest;
		let store: ScheduleStore;
		let P: string;

		beforeEach(async () => {
			under = await make();
			store = under.store;
			P = under.projectId;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project without schedules lists none, with no issue", async () => {
			const list = await store.list(P);
			expect(list.schedules).toEqual([]);
			expect(list.issues).toEqual([]);
			expect(typeof list.path).toBe("string");
		});

		test("lists the saved schedules, in the saved order", async () => {
			const schedules = [
				nightly({ id: "b" }),
				nightly({ id: "a", cron: "0 7 * * *", timeZone: "Asia/Tokyo" }),
				nightly({ id: "c", stopAt: "07:00", lateMinutes: 60 }),
			];
			expect(await store.save(P, schedules)).toEqual([]);
			expect((await store.list(P)).schedules).toEqual(schedules);
			expect((await store.list(P, { validate: false })).schedules).toEqual(
				schedules,
			);
		});

		test("a save replaces every schedule", async () => {
			await store.save(P, [nightly({ id: "a" }), nightly({ id: "b" })]);
			await store.save(P, [nightly({ id: "b", enabled: false })]);
			expect((await store.list(P)).schedules).toEqual([
				nightly({ id: "b", enabled: false }),
			]);
		});

		test("a pause tonight is kept with its schedule", async () => {
			const paused = nightly({ pausedUntil: 1_800_000_000_000 });
			await store.save(P, [paused]);
			expect((await store.list(P)).schedules).toEqual([paused]);
			await store.save(P, [nightly()]);
			expect((await store.list(P)).schedules[0]?.pausedUntil).toBeUndefined();
		});

		test("a schedule whose flow is missing is saved, and is an error of that schedule", async () => {
			const gone = nightly({ flow: "gone" });
			const issue: ScheduleIssue = {
				severity: "error",
				message: 'The flow "gone" does not exist.',
				scheduleId: "nightly",
			};
			expect(await store.save(P, [gone])).toEqual([issue]);
			const list = await store.list(P);
			expect(list.schedules).toEqual([gone]);
			expect(list.issues).toEqual([issue]);
		});

		test("without the check, a list has no issue of a flow", async () => {
			await store.save(P, [nightly({ flow: "gone" })]);
			expect((await store.list(P, { validate: false })).issues).toEqual([]);
		});

		test("gives the project's flows by name", async () => {
			const flows = await store.flows(P);
			expect(Object.keys(flows)).toEqual(["night"]);
			expect(flows.night).toMatchObject({ json: under.night });
		});

		test("refuses a project it does not have", async () => {
			for (const work of [
				store.list("no-such-project"),
				store.save("no-such-project", [nightly()]),
				store.flows("no-such-project"),
			]) {
				const refused = await refusalOf(work);
				expect(refused).toBeInstanceOf(Refusal);
				expect(refused).toMatchObject({ kind: "not-found" });
			}
		});
	});
}
