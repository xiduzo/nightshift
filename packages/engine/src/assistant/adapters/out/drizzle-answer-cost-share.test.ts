import { beforeEach, describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import type { AnswerCostShare } from "../../application/ports";
import type {
	SentAnswerCost,
	ServedAnswerCost,
} from "../../domain/answer-costs";
import { drizzleAnswerCostShare } from "./drizzle-answer-cost-share";
import { drizzleAnswerCostStore } from "./drizzle-answer-cost-store";

const sent = (
	key: string,
	fields: Partial<SentAnswerCost> = {},
): SentAnswerCost => ({
	key,
	spaceId: "space-a",
	projectId: "p1",
	agent: "builder",
	entry: "flow.build",
	inputTokens: 1,
	outputTokens: 1,
	costUsd: 0.1,
	at: 1_000,
	...fields,
});

const served = (
	key: string,
	seq: number,
	fields: Partial<ServedAnswerCost> = {},
): ServedAnswerCost => ({
	...sent(key),
	seq,
	deviceId: "laptop",
	personId: "ada",
	...fields,
});

/**
 * The contract of `AnswerCostShare`, with the store of the same Replica, on
 * libsql in memory. No use case reads the port, so it has no twin.
 */

const make = async () => {
	const db = await migratedDb();
	return {
		answerCostShare: drizzleAnswerCostShare(db),
		own: drizzleAnswerCostStore(db),
	};
};

describe("AnswerCostShare over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let share: AnswerCostShare;
	beforeEach(async () => {
		under = await make();
		share = under.answerCostShare;
	});

	const own = (key: string, spaceId = "space-a") =>
		under.own.add({ ...sent(key, { spaceId }), personId: "ada" });

	test("no Spaces: nothing unsent, no cursors, nothing served", async () => {
		await own("k1");
		expect(await share.unsent([], 10)).toEqual([]);
		expect(await share.cursors([])).toEqual({});
		expect(
			await share.after({ spaces: [], cursors: {}, selfId: "h", limit: 10 }),
		).toEqual([]);
	});

	test("this computer's own answers are unsent until the Host has them", async () => {
		await own("k1");
		await own("k2");
		await own("k3", "space-b");
		expect(await share.unsent(["space-a"], 10)).toEqual([
			sent("k1"),
			sent("k2"),
		]);
		expect((await share.unsent(["space-a"], 1)).map((r) => r.key)).toEqual([
			"k1",
		]);
		await share.sent([], 9_000);
		await share.sent(["k1"], 9_000);
		expect((await share.unsent(["space-a"], 10)).map((r) => r.key)).toEqual([
			"k2",
		]);
	});

	test("what a Host served is kept with its number, and is no answer of this computer", async () => {
		await share.ingest([served("h1", 4), served("h2", 7)], 9_000);
		await share.ingest(
			[served("h3", 2, { spaceId: "space-b", deviceId: "other" })],
			9_000,
		);
		expect(await share.cursors(["space-a", "space-b", "space-c"])).toEqual({
			"space-a": 7,
			"space-b": 2,
		});
		expect(await share.unsent(["space-a", "space-b"], 10)).toEqual([]);
		const [kept] = await share.after({
			spaces: ["space-b"],
			cursors: {},
			selfId: "this-one",
			limit: 10,
		});
		expect(kept).toMatchObject({
			...served("h3", 2, { spaceId: "space-b", deviceId: "other" }),
			seq: expect.any(Number),
		});
	});

	test("an own answer that comes back takes the Host's number and stays this computer's", async () => {
		await own("k1");
		await share.ingest(
			[served("k1", 5, { personId: "ada-there", costUsd: 0.5 })],
			9_000,
		);
		expect(await share.cursors(["space-a"])).toEqual({ "space-a": 5 });
		const [back] = await share.after({
			spaces: ["space-a"],
			cursors: {},
			selfId: "this-one",
			limit: 10,
		});
		expect(back).toMatchObject({
			key: "k1",
			deviceId: "this-one",
			personId: "ada",
			costUsd: 0.1,
		});
	});

	test("a Host keeps what a Device gives once, as that Device's and its Person's", async () => {
		const from = { deviceId: "laptop", personId: "ada-there" };
		expect(await share.take([sent("a1"), sent("a2")], from)).toEqual([
			"a1",
			"a2",
		]);
		expect(
			await share.take([sent("a1", { costUsd: 99 })], {
				deviceId: "desktop",
				personId: "bob",
			}),
		).toEqual(["a1"]);
		expect(await share.unsent(["space-a"], 10)).toEqual([]);
		const rows = await share.after({
			spaces: ["space-a"],
			cursors: {},
			selfId: "the-host",
			limit: 10,
		});
		expect(rows.map((r) => [r.key, r.deviceId, r.personId, r.costUsd])).toEqual(
			[
				["a1", "laptop", "ada-there", 0.1],
				["a2", "laptop", "ada-there", 0.1],
			],
		);
	});

	test("a Host serves after each Space's cursor, in the order it kept them, at most the limit", async () => {
		const from = { deviceId: "laptop", personId: "ada" };
		await own("mine");
		await share.take(
			[sent("a1"), sent("b1", { spaceId: "space-b" }), sent("a2")],
			from,
		);
		const all = await share.after({
			spaces: ["space-a", "space-b"],
			cursors: {},
			selfId: "the-host",
			limit: 10,
		});
		expect(all.map((r) => [r.key, r.deviceId])).toEqual([
			["mine", "the-host"],
			["a1", "laptop"],
			["b1", "laptop"],
			["a2", "laptop"],
		]);
		const seqOf = (key: string) =>
			all.find((r) => r.key === key)?.seq ?? Number.NaN;
		const after = (
			cursors: Record<string, number>,
			limit = 10,
			spaces = ["space-a"],
		) =>
			share
				.after({ spaces, cursors, selfId: "h", limit })
				.then((rows) => rows.map((r) => r.key));
		expect(await after({ "space-a": seqOf("a1") })).toEqual(["a2"]);
		expect(await after({}, 2)).toEqual(["mine", "a1"]);
		// A Space without a cursor is read from its start.
		expect(
			await after({ "space-a": seqOf("a2") }, 10, ["space-a", "space-b"]),
		).toEqual(["b1"]);
	});
});
