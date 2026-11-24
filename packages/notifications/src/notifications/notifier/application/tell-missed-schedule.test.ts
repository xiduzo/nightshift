import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { notifier } from "../test-support";

/**
 * The use case tellMissedSchedule, over a database in memory. The twins of the
 * tests of the same names in `notifier.test.ts`.
 */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

async function setup() {
	const n = await notifier();
	n.ports.time = NOON;
	return n;
}

const missed = {
	spaceId: SPACE,
	projectId: "project-1",
	scheduleId: "rebalance",
	flow: "rebalance",
	at: utc(2026, 9, 21, 10, 30),
};

describe("a missed schedule", () => {
	test("every Member hears that it did not start, with the flow and its time", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		const bob = n.ports.targets.add("bob", "expo");

		await n.tellMissed(missed);

		const key = `missed:project-1:rebalance:${missed.at}`;
		expect(n.ports.pushes.web.sentTo()).toEqual([`${ada.id}:${key}`]);
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${bob.id}:${key}`]);
		expect(n.ports.pushes.web.sent()[0]).toMatchObject({
			kind: "schedule-missed",
			runId: null,
			title: "A schedule did not start",
			body: "rebalance was due at 10:30. Night Shift was off at that time.",
		});

		// Told once, also when it is said again.
		await n.tellMissed(missed);
		expect(n.ports.pushes.web.calls).toHaveLength(1);
	});

	test("a push only: an open page gets no item", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");
		n.ports.inApp.setActive("ada", true);

		await n.tellMissed(missed);

		expect(n.ports.inApp.of("ada")).toEqual([]);
		expect(n.ports.pushes.web.calls).toEqual([]);
		expect(
			await n.ports.deliveries.entry(
				"ada",
				`missed:project-1:rebalance:${missed.at}`,
			),
		).toMatchObject({
			status: "held",
			runId: "",
			title: "A schedule did not start",
			body: "rebalance was due at 10:30. Night Shift was off at that time.",
		});
	});

	test("a time a day or more ago says its day", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");

		await n.tellMissed({ ...missed, at: utc(2026, 9, 19, 22, 30) });

		expect(n.ports.pushes.web.sent()[0]?.body).toBe(
			"rebalance was due on Mon 19 Oct at 22:30. Night Shift was off at that time.",
		);
	});

	test("a person who turned off failed runs does not hear of it", async () => {
		const n = await setup();
		const current = await n.ports.settings.get("ada");
		n.ports.settings.save("ada", {
			events: { ...current.events, runFailed: false },
		});
		n.ports.targets.add("ada", "web");

		await n.tellMissed(missed);

		expect(n.ports.pushes.web.calls).toEqual([]);
	});

	test("the time is on the clock of each person", async () => {
		const n = await setup();
		n.ports.settings.save("ada", { timeZone: "Asia/Tokyo" });
		n.ports.targets.add("ada", "web");

		await n.tellMissed(missed);

		expect(n.ports.pushes.web.sent()[0]?.body).toBe(
			"rebalance was due at 19:30. Night Shift was off at that time.",
		);
	});
});
