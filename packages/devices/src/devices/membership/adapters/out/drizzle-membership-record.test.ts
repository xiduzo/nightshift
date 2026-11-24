import { describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import { batchesOf } from "../../test-support";
import { drizzleMembershipRecord } from "./drizzle-membership-record";

const make = async () => {
	const db = await migratedDb();
	return {
		record: drizzleMembershipRecord(db),
		run: batchesOf(db).run,
	};
};

describe("MembershipRecord over drizzle", () => {
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

	test("a split says what it paused once its rows moved, and only a planned one is forgotten", async () => {
		const { record, run } = await make();
		await record.splits.plan({
			toSpace: "to",
			fromSpace: "from",
			hostId: "host",
			hostName: "Studio",
			personId: "ada",
			hostPersonId: "ada-there",
			backup: "/b",
		});
		await record.splits.forget("other");
		expect(await record.splits.of("from")).toMatchObject({
			paused: [],
			waiting: {},
		});
		expect(await record.splits.paused()).toEqual([]);
		const paused = [{ projectId: "p1", scheduleId: "night" }];
		await run(
			record.splits.moved("to", {
				projects: ["p1"],
				runs: 0,
				unpinned: 1,
				paused,
				waiting: { old: "p1" },
			}),
		);
		const moved = { hostId: "host", fromSpace: "from", paused };
		expect(await record.splits.paused()).toMatchObject([moved]);
		expect(await record.splits.of("from")).toMatchObject({
			waiting: { old: "p1" },
		});
		await record.splits.forget("to");
		await record.splits.done("to");
		await record.splits.forget("to");
		expect(await record.splits.paused()).toMatchObject([moved]);
	});

	test("a planned split can be forgotten", async () => {
		const { record } = await make();
		await record.splits.plan({
			toSpace: "to",
			fromSpace: "from",
			hostId: "host",
			hostName: "Studio",
			personId: "ada",
			hostPersonId: "ada-there",
			backup: "/b",
		});
		await record.splits.forget("to");
		expect(await record.unfinished()).toBeNull();
		expect(await record.splits.of("from")).toBeNull();
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
		expect((await record.merges.done()).map((m) => m.late)).toEqual([null]);
		const late = {
			projectMap: { p9: { spaceId: "to", projectId: "there" } },
			personMap: { ada: "ada-there" },
		};
		await run(record.merges.late("from", late));
		expect(await record.unfinished()).toMatchObject({
			step: "merge",
			row: { state: "moved", late, backup: "/b", projectMap: {} },
		});
		expect(await record.merges.done()).toEqual([]);
	});
});
