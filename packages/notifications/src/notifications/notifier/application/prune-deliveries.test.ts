import { describe, expect, test } from "bun:test";
import { notifier } from "../test-support";

/** The use case pruneDeliveries, over a database in memory. */

const DAY = 24 * 60 * 60_000;
const START = 400 * DAY;

describe("pruneDeliveries", () => {
	test("removes what the inbox no longer keeps, at most once an hour", async () => {
		const n = await notifier();
		const run = (key: string) => ({
			personId: "ada",
			key,
			kind: "run-finished" as const,
			spaceId: "space-1",
			runId: "run-1",
			stepId: null,
		});
		await n.ports.deliveries.claim(run("old"), { status: "sent" }, START);
		await n.ports.deliveries.claim(
			run("newer"),
			{ status: "sent" },
			START + DAY,
		);

		await n.prune({ at: START + 90 * DAY + 1 });
		expect((await n.ports.deliveries.rows()).map((row) => row.key)).toEqual([
			"newer",
		]);

		// Within the hour: no prune, though "newer" is old enough by then.
		await n.ports.deliveries.claim(
			{ ...run("old-again"), personId: "bob" },
			{ status: "sent" },
			START,
		);
		await n.prune({ at: START + 90 * DAY + 1 + 59 * 60_000 });
		expect((await n.ports.deliveries.rows()).map((row) => row.key)).toEqual([
			"newer",
			"old-again",
		]);

		await n.prune({ at: START + 91 * DAY + 1 });
		expect(await n.ports.deliveries.rows()).toEqual([]);
	});
});
