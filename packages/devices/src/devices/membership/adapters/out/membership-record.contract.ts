import { describe, expect, test } from "bun:test";
import type { RowBatch } from "@nightshift/engine";
import type { MembershipRecord } from "../../application/ports";

/** One adapter, and what runs its batches. */
export type MembershipRecordSubject = {
	record: MembershipRecord;
	run(batch: RowBatch): Promise<void>;
};

/**
 * What every adapter of `MembershipRecord` does.
 * `membership-record.contract.test.ts` runs it on both adapters.
 */
export function membershipRecordContract(
	name: string,
	make: () => Promise<MembershipRecordSubject>,
): void {
	describe(`MembershipRecord contract: ${name}`, () => {
		test("plan then unfinished returns the merge", async () => {
			const { record } = await make();
			const row = await record.merges.plan({
				fromSpace: "from",
				hostId: "host",
				personId: "person",
				joined: [],
				backup: "/tmp/b.db",
			});
			expect(row.state).toBe("planned");
			const unfinished = await record.unfinished();
			expect(unfinished).toEqual({ step: "merge", row });
		});

		test("mapped then moved then pushed ends the merge", async () => {
			const { record, run } = await make();
			await record.merges.plan({
				fromSpace: "from",
				hostId: "host",
				personId: "person",
				joined: ["p1"],
				backup: "/tmp/b.db",
			});
			await record.merges.mapped("from", {
				toSpace: "to",
				projectMap: { p1: { spaceId: "to", projectId: "p1" } },
				personMap: { person: "host-person" },
			});
			await run(record.merges.moved("from"));
			await record.merges.pushed("from");
			expect(await record.unfinished()).toBeNull();
			expect((await record.merges.latest())?.state).toBe("pushed");
		});

		test("a done merge goes on for the Projects it left", async () => {
			const { record, run } = await make();
			const from = {
				hostId: "host",
				personId: "ada",
				joined: [],
				backup: "/b",
			};
			await record.merges.plan({ fromSpace: "from", ...from });
			expect(await record.merges.done()).toEqual([]);
			await record.merges.pushed("from");
			expect((await record.merges.done()).map((m) => m.late)).toEqual([[]]);
			const late = {
				projectMap: { p9: { spaceId: "to", projectId: "there" } },
				personMap: { ada: "ada-there" },
			};
			await run(record.merges.late("from", late));
			expect(await record.unfinished()).toMatchObject({
				step: "merge",
				row: { state: "moved", late: ["there"], backup: "/b", ...late },
			});
			expect(await record.merges.done()).toEqual([]);
		});
	});
}
