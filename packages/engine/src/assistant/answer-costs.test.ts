import { describe, expect, test } from "bun:test";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { answerCost } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { NIGHT_SHIFT } from "../contract";
import type { AnswerCost, SentAnswerCost } from "./domain/answer-costs";
import { type Assistant, wireAssistant } from "./wire";

/**
 * The answer costs of the slice as `wireAssistant` binds them, on libsql
 * in memory: one database per Replica. The exchange between a Host and its
 * Devices runs as the Device's loop runs it.
 */

type Replica = { db: Database; cases: Assistant };

async function replica(): Promise<Replica> {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return { db, cases: wireAssistant({ db }) };
}

const cost = (fields: Partial<AnswerCost> = {}): AnswerCost => ({
	at: 1_000,
	agent: "builder",
	entry: "flow.build",
	projectId: "p1",
	spaceId: "space-a",
	personId: "ada",
	inputTokens: 1200,
	outputTokens: 300,
	costUsd: 0.42,
	...fields,
});

const listOf = (on: Replica, spaceId: string, since?: number) =>
	on.cases.listAnswerCosts(NIGHT_SHIFT, {
		spaceId,
		...(since === undefined ? {} : { since }),
	});

describe("answer costs", () => {
	test("keeps each answer and lists a Space's, the oldest first", async () => {
		const here = await replica();
		const late = cost({ at: 3_000, agent: "explainer", entry: "run.why" });
		const early = cost({ at: 2_000, agent: "field-writer", costUsd: null });
		await here.cases.keepAnswerCost(late);
		await here.cases.keepAnswerCost(early);
		await here.cases.keepAnswerCost(cost({ spaceId: "space-b" }));

		expect(await listOf(here, "space-a")).toEqual([early, late]);
		expect(await listOf(here, "space-b")).toEqual([
			cost({ spaceId: "space-b" }),
		]);
		const keys = (await here.db.select().from(answerCost)).map((r) => r.key);
		expect(new Set(keys).size).toBe(3);
	});

	test("lists only the answers that ended at or after `since`", async () => {
		const here = await replica();
		for (const at of [1_000, 2_000, 3_000]) {
			await here.cases.keepAnswerCost(cost({ at }));
		}
		const listed = await listOf(here, "space-a", 2_000);
		expect(listed.map((each) => each.at)).toEqual([2_000, 3_000]);
	});

	test("keeps an answer without a project or an entry", async () => {
		const here = await replica();
		const bare = cost({ projectId: null, entry: null });
		await here.cases.keepAnswerCost(bare);
		expect(await listOf(here, "space-a")).toEqual([bare]);
	});

	test("leaves out a row of an agent it does not know, and an entry it does not know", async () => {
		const here = await replica();
		await here.db.insert(answerCost).values([
			{
				key: "k-decider",
				spaceId: "space-a",
				personId: "ada",
				agent: "decider",
				inputTokens: 1,
				outputTokens: 1,
				at: asDate(1_000),
			},
			{
				key: "k-improver",
				spaceId: "space-a",
				personId: "ada",
				agent: "improver",
				entry: "somewhere.new",
				inputTokens: 1,
				outputTokens: 1,
				at: asDate(2_000),
			},
		]);
		expect(await listOf(here, "space-a")).toEqual([
			cost({
				at: 2_000,
				agent: "improver",
				entry: null,
				projectId: null,
				inputTokens: 1,
				outputTokens: 1,
				costUsd: null,
			}),
		]);
	});
});

describe("shared answer costs", () => {
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

	/** One exchange of `device` with `host`, as the Device's loop does it. */
	async function exchange(
		device: Replica,
		host: Replica,
		deviceId: string,
		personId = "ada",
	) {
		const here = device.cases;
		const there = host.cases;
		const spaces = ["space-a"];
		const rows = await here.listUnsentAnswerCosts({ spaces, limit: 100 });
		const taken = await there.takeSentAnswerCosts({
			rows,
			from: { deviceId, personId },
		});
		const served = await there.serveAnswerCosts({
			spaces,
			cursors: await here.readAnswerCostCursors({ spaces }),
			selfId: "the-host",
			limit: 100,
		});
		await here.ingestServedAnswerCosts({ rows: served, now: 9_000 });
		await here.markAnswerCostsSent({ keys: taken, now: 9_000 });
		return { rows, served };
	}

	test("a Device's own answers reach the Host once, as that Device's and its Person's there", async () => {
		const device = await replica();
		const host = await replica();
		await device.cases.keepAnswerCost(cost({ personId: "ada-here" }));
		await device.cases.keepAnswerCost(cost({ spaceId: "space-b" }));

		const first = await exchange(device, host, "laptop", "ada-there");
		expect(first.rows).toHaveLength(1);
		expect(first.served.map((row) => [row.deviceId, row.personId])).toEqual([
			["laptop", "ada-there"],
		]);
		// The Host has it: nothing goes again, and the Device keeps one row of it, its own.
		const second = await exchange(device, host, "laptop", "ada-there");
		expect(second).toEqual({ rows: [], served: [] });
		expect(await listOf(host, "space-a")).toHaveLength(1);
		const own = await device.db.select().from(answerCost);
		expect(own.map((row) => [row.spaceId, row.deviceId, row.personId])).toEqual(
			[
				["space-a", null, "ada-here"],
				["space-b", null, "ada"],
			],
		);
	});

	test("a second Device reads what the first one and the Host spent, each once", async () => {
		const device = await replica();
		const host = await replica();
		const other = await replica();
		await device.cases.keepAnswerCost(cost({ at: 1_000 }));
		await host.cases.keepAnswerCost(cost({ at: 2_000, agent: "explainer" }));
		await exchange(device, host, "laptop");
		await other.cases.keepAnswerCost(cost({ at: 3_000, agent: "improver" }));

		const { served } = await exchange(other, host, "desktop");
		expect(served.map((row) => row.deviceId).sort()).toEqual([
			"desktop",
			"laptop",
			"the-host",
		]);
		await exchange(other, host, "desktop");
		await exchange(device, host, "laptop");
		for (const each of [device, other, host]) {
			expect((await listOf(each, "space-a")).map((c) => c.agent)).toEqual([
				"builder",
				"explainer",
				"improver",
			]);
		}
	});

	test("a Host serves a Space from its own cursor, and no Space the reader did not name", async () => {
		const host = await replica();
		await host.cases.takeSentAnswerCosts({
			rows: [sent("a1"), sent("b1", { spaceId: "space-b" }), sent("a2")],
			from: { deviceId: "laptop", personId: "ada" },
		});
		const after = (cursors: Record<string, number>, spaces = ["space-a"]) =>
			host.cases
				.serveAnswerCosts({ spaces, cursors, selfId: "the-host", limit: 10 })
				.then((rows) => rows.map((row) => row.key));

		expect(await after({})).toEqual(["a1", "a2"]);
		expect(await after({ "space-a": 1 })).toEqual(["a2"]);
		expect(await after({ "space-a": 1 }, ["space-a", "space-b"])).toEqual([
			"b1",
			"a2",
		]);
		expect(await after({}, [])).toEqual([]);
	});

	test("a row that comes again is the same answer", async () => {
		const host = await replica();
		const from = { deviceId: "laptop", personId: "ada" };
		expect(
			await host.cases.takeSentAnswerCosts({ rows: [sent("a1")], from }),
		).toEqual(["a1"]);
		expect(
			await host.cases.takeSentAnswerCosts({
				rows: [sent("a1", { costUsd: 99 })],
				from,
			}),
		).toEqual(["a1"]);
		expect((await listOf(host, "space-a")).map((c) => c.costUsd)).toEqual([
			0.1,
		]);
	});
});
