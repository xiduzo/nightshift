import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { notificationDelivery } from "@nightshift/db/schema";
import { asc } from "drizzle-orm";
import { testDatabase } from "../testing/database";
import { createDeliveryLog, type DeliveryStatus } from "./deliveries";
import { moveDeliveriesBatch } from "./moved";

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

const FROM = "own-personal";
const TO = "personal-on-host";

/** One entry per run and status: `<run>:<status>`. */
async function seed(runs: string[], spaceId = FROM) {
	const log = createDeliveryLog(db);
	const statuses: DeliveryStatus[] = [
		"sending",
		"held",
		"quiet",
		"sent",
		"withdrawn",
	];
	for (const runId of runs) {
		for (const status of statuses) {
			await log.claim(
				{
					personId: "ada",
					key: `${runId}:${status}`,
					kind: "gate-opened",
					spaceId,
					runId,
					stepId: "s1",
				},
				{ status, dueAt: status === "held" ? 5 : null, heldFor: ["t1"] },
				1,
			);
		}
	}
}

const entries = () =>
	db
		.select({
			key: notificationDelivery.key,
			spaceId: notificationDelivery.spaceId,
			status: notificationDelivery.status,
		})
		.from(notificationDelivery)
		.orderBy(asc(notificationDelivery.key));

describe("moveDeliveriesBatch", () => {
	test("for a Space its Host notifies for, what waits is dropped and what went out stays", async () => {
		await seed(["r1"]);
		await db.batch(
			moveDeliveriesBatch(db, { from: FROM, to: TO, sends: false }),
		);

		expect(await entries()).toEqual([
			{ key: "r1:held", spaceId: TO, status: "dropped" },
			{ key: "r1:quiet", spaceId: TO, status: "dropped" },
			{ key: "r1:sending", spaceId: TO, status: "dropped" },
			{ key: "r1:sent", spaceId: TO, status: "sent" },
			{ key: "r1:withdrawn", spaceId: TO, status: "withdrawn" },
		]);
		const [sent] = await createDeliveryLog(db).live("r1:sent");
		expect(sent?.status).toBe("sent");
		expect(await createDeliveryLog(db).held()).toEqual([]);
	});

	test("for a Space this daemon still notifies for, every entry keeps its status", async () => {
		await seed(["r1"]);
		await db.batch(
			moveDeliveriesBatch(db, { from: FROM, to: TO, sends: true }),
		);

		const moved = await entries();
		expect(new Set(moved.map((e) => e.spaceId))).toEqual(new Set([TO]));
		expect(moved.map((e) => e.status)).toEqual([
			"held",
			"quiet",
			"sending",
			"sent",
			"withdrawn",
		]);
	});

	test("only the entries of the moved runs move, and those of another Space stay", async () => {
		await seed(["r1", "r2"]);
		await seed(["r3"], "team");
		await db.batch(
			moveDeliveriesBatch(db, {
				from: FROM,
				to: TO,
				runIds: ["r1"],
				sends: false,
			}),
		);

		const bySpace = (await entries()).reduce<Record<string, string[]>>(
			(spaces, entry) => {
				spaces[entry.spaceId] = [...(spaces[entry.spaceId] ?? []), entry.key];
				return spaces;
			},
			{},
		);
		expect(bySpace[TO]?.every((key) => key.startsWith("r1:"))).toBe(true);
		expect(bySpace[FROM]?.every((key) => key.startsWith("r2:"))).toBe(true);
		expect(bySpace.team?.every((key) => key.startsWith("r3:"))).toBe(true);
		const r2 = (await entries()).filter((entry) => entry.key.startsWith("r2:"));
		expect(r2.map((entry) => entry.status)).toContain("held");
	});
});
