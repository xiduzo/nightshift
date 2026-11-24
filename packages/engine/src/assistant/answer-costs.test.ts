import { describe, expect, test } from "bun:test";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { answerCost } from "@nightshift/db/schema";
import { instantOrNull } from "@nightshift/time";
import { inMemoryAccess } from "../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../contract";
import type { AnswerCost } from "./domain/answer-costs";
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
	return { db, cases: wireAssistant({ db, access: inMemoryAccess() }) };
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

describe("shared answer costs", () => {
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
		const rows = await here.shared.unsent(spaces, 100);
		const taken = await there.shared.take(rows, { deviceId, personId });
		const served = await there.shared.after({
			spaces,
			cursors: await here.shared.cursors(spaces),
			selfId: "the-host",
			limit: 100,
		});
		await here.shared.ingest(served, 9_000);
		await here.shared.sent(taken, 9_500);
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
		expect(
			own.map((row) => [
				row.spaceId,
				row.deviceId,
				row.personId,
				instantOrNull(row.sentAt),
			]),
		).toEqual([
			// Sent at the first time the Host had it.
			["space-a", null, "ada-here", 9_000],
			["space-b", null, "ada", null],
		]);
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
});
