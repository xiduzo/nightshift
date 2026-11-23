import { describe, expect, test } from "bun:test";
import type { MembershipRecord } from "../../application/ports";

/**
 * What every adapter of `MembershipRecord` does.
 * `membership-record.contract.test.ts` runs it on both adapters.
 */
export function membershipRecordContract(
	name: string,
	make: () => Promise<MembershipRecord> | MembershipRecord,
): void {
	describe(`MembershipRecord contract: ${name}`, () => {
		test("plan then unfinished returns the merge", async () => {
			const record = await make();
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
			const record = await make();
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
			record.merges.moved("from");
			await record.merges.pushed("from");
			expect(await record.unfinished()).toBeNull();
			expect((await record.merges.latest())?.state).toBe("pushed");
		});
	});
}
