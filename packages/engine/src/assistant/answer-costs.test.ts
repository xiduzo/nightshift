import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { answerCost } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	type AnswerCost,
	keepAnswerCost,
	listAnswerCosts,
	type SentAnswerCost,
	sharedAnswerCosts,
} from "./answer-costs";

let sandbox: Sandbox;

beforeEach(async () => {
	sandbox = await createSandbox();
});

afterEach(async () => {
	await sandbox.cleanup();
});

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

describe("answer costs", () => {
	test("keeps each answer and lists a Space's, the oldest first", async () => {
		const late = cost({ at: 3_000, agent: "explainer", entry: "run.why" });
		const early = cost({ at: 2_000, agent: "field-writer", costUsd: null });
		await keepAnswerCost(sandbox.db, late);
		await keepAnswerCost(sandbox.db, early);
		await keepAnswerCost(sandbox.db, cost({ spaceId: "space-b" }));

		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([early, late]);
		expect(await listAnswerCosts(sandbox.db, "space-b")).toEqual([
			cost({ spaceId: "space-b" }),
		]);
	});

	test("lists only the answers that ended at or after `since`", async () => {
		await keepAnswerCost(sandbox.db, cost({ at: 1_000 }));
		await keepAnswerCost(sandbox.db, cost({ at: 2_000 }));
		await keepAnswerCost(sandbox.db, cost({ at: 3_000 }));

		const listed = await listAnswerCosts(sandbox.db, "space-a", 2_000);
		expect(listed.map((each) => each.at)).toEqual([2_000, 3_000]);
	});

	test("keeps an answer without a project or an entry", async () => {
		const bare = cost({ projectId: null, entry: null });
		await keepAnswerCost(sandbox.db, bare);
		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([bare]);
	});

	test("leaves out a row of an agent it does not know, and an entry it does not know", async () => {
		await sandbox.db.insert(answerCost).values([
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
		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([
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
	/** A second Replica: the Host that keeps `space-a`. */
	let host: Sandbox;
	beforeEach(async () => {
		host = await createSandbox();
	});
	afterEach(async () => {
		await host.cleanup();
	});

	const sent = (key: string, fields: Partial<SentAnswerCost> = {}) => ({
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

	/** One exchange of `device` with the Host, as the Device's loop does it. */
	async function exchange(device: Sandbox, deviceId: string, personId = "ada") {
		const here = sharedAnswerCosts(device.db);
		const there = sharedAnswerCosts(host.db);
		const spaces = ["space-a"];
		const rows = await here.unsent(spaces, 100);
		const taken = await there.take(rows, { deviceId, personId });
		const served = await there.after({
			spaces,
			cursors: await here.cursors(spaces),
			selfId: "the-host",
			limit: 100,
		});
		await here.ingest(served, 9_000);
		await here.sent(taken, 9_000);
		return { rows, served };
	}

	test("a Device's own answers reach the Host once, as that Device's and its Person's there", async () => {
		await keepAnswerCost(sandbox.db, cost({ personId: "ada-here" }));
		await keepAnswerCost(sandbox.db, cost({ spaceId: "space-b" }));

		const first = await exchange(sandbox, "laptop", "ada-there");
		expect(first.rows).toHaveLength(1);
		expect(first.served.map((row) => [row.deviceId, row.personId])).toEqual([
			["laptop", "ada-there"],
		]);
		// The Host has it: nothing goes again, and the Device keeps one row of it, its own.
		const second = await exchange(sandbox, "laptop", "ada-there");
		expect(second).toEqual({ rows: [], served: [] });
		expect(await listAnswerCosts(host.db, "space-a")).toHaveLength(1);
		const own = await sandbox.db.select().from(answerCost);
		expect(own.map((row) => [row.spaceId, row.deviceId, row.personId])).toEqual(
			[
				["space-a", null, "ada-here"],
				["space-b", null, "ada"],
			],
		);
	});

	test("a second Device reads what the first one and the Host spent, each once", async () => {
		const other = await createSandbox();
		try {
			await keepAnswerCost(sandbox.db, cost({ at: 1_000 }));
			await keepAnswerCost(host.db, cost({ at: 2_000, agent: "explainer" }));
			await exchange(sandbox, "laptop");
			await keepAnswerCost(other.db, cost({ at: 3_000, agent: "improver" }));

			const { served } = await exchange(other, "desktop");
			expect(served.map((row) => row.deviceId).sort()).toEqual([
				"desktop",
				"laptop",
				"the-host",
			]);
			await exchange(other, "desktop");
			await exchange(sandbox, "laptop");
			for (const replica of [sandbox, other, host]) {
				expect(
					(await listAnswerCosts(replica.db, "space-a")).map((c) => c.agent),
				).toEqual(["builder", "explainer", "improver"]);
			}
		} finally {
			await other.cleanup();
		}
	});

	test("a Host serves a Space from its own cursor, and no Space the reader did not name", async () => {
		const there = sharedAnswerCosts(host.db);
		await there.take(
			[sent("a1"), sent("b1", { spaceId: "space-b" }), sent("a2")],
			{ deviceId: "laptop", personId: "ada" },
		);
		const after = (cursors: Record<string, number>, spaces = ["space-a"]) =>
			there
				.after({ spaces, cursors, selfId: "the-host", limit: 10 })
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
		const there = sharedAnswerCosts(host.db);
		const from = { deviceId: "laptop", personId: "ada" };
		expect(await there.take([sent("a1")], from)).toEqual(["a1"]);
		expect(await there.take([sent("a1", { costUsd: 99 })], from)).toEqual([
			"a1",
		]);
		expect(
			(await listAnswerCosts(host.db, "space-a")).map((c) => c.costUsd),
		).toEqual([0.1]);
	});
});
