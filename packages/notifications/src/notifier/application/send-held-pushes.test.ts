import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { inMemoryNotifier } from "../adapters/out/in-memory-notifier";

/**
 * The use case sendHeldPushes, on in-memory adapters: the active screen
 * first. The in-app port says whether the Person has a screen open (the
 * channel decides that a closed page counts for a minute, and a phone app
 * in the background not at all). The twins of the tests of the same names
 * in `notifier.test.ts`.
 */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);
const MINUTE = 60_000;

function setup() {
	const n = inMemoryNotifier();
	n.ports.time = NOON;
	return n;
}

describe("the active screen first", () => {
	test("while a page is open, a push to the phone waits, and goes when the Gate still waits", async () => {
		const n = setup();
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		await n.openGate("run-1", "step-1");

		n.ports.time += 2 * MINUTE;
		await n.sendHeld({ at: n.ports.time });
		expect(n.ports.pushes.expo.calls).toEqual([]);

		n.ports.time += MINUTE;
		await n.sendHeld({ at: n.ports.time });
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
		expect(n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject({
			status: "sent",
			sentTo: [phone.id],
			heldFor: [],
			sentAt: NOON + 3 * MINUTE,
		});
	});

	test("a Gate answered meanwhile never reaches the phone", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");
		n.ports.time += MINUTE;
		await n.answerGate("run-1", "step-1");
		n.ports.time += 5 * MINUTE;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.calls).toEqual([]);
	});

	test("a run's end that showed on an open page is not pushed after it", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.endRun("run-1", "finished");
		n.ports.time += 5 * MINUTE;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.calls).toEqual([]);
		expect(n.ports.deliveries.rows()[0]).toMatchObject({
			personId: "ada",
			status: "dropped",
		});
	});

	test("a run's end is pushed when the person closed every screen meanwhile", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.endRun("run-1", "failed");
		n.ports.inApp.setActive("ada", false);
		n.ports.time += 5 * MINUTE;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.sent().map((m) => m.kind)).toEqual([
			"run-failed",
		]);
	});

	test("a page that closed counts as open for a minute: it may reload", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		// The page closed 10 s ago: the channel still counts it as open.
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.calls).toEqual([]);
	});

	test("a held push goes once the person has no screen open, not after the full delay", async () => {
		const n = setup();
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		await n.openGate("run-1", "step-1");
		expect(n.ports.pushes.expo.calls).toEqual([]);

		// The person puts the phone away without an answer.
		n.ports.inApp.setActive("ada", false);
		n.ports.time += 15_000;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a held push waits out the minute of a page that closed, then goes", async () => {
		const n = setup();
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		await n.openGate("run-1", "step-1");

		// The page closed: for its minute the channel still counts it as open.
		n.ports.time += 30_000;
		await n.sendHeld({ at: n.ports.time });
		expect(n.ports.pushes.expo.calls).toEqual([]);

		n.ports.inApp.setActive("ada", false);
		n.ports.time += 31_000;
		await n.sendHeld({ at: n.ports.time });
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a held push that comes due in quiet hours waits for their end", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		await n.openGate("run-1", "step-1");
		n.ports.settings.save("ada", {
			quietHours: { start: "12:00", end: "13:00" },
		});

		n.ports.time += 5 * MINUTE;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.calls).toEqual([]);
		expect(n.ports.deliveries.entry("ada", "run-1:step-1")?.status).toBe(
			"quiet",
		);
	});
});

describe("lock-screen Gates", () => {
	test("a held push still carries the options when it goes", async () => {
		const n = setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1", SPACE, {
			lockScreen: true,
			choices: ["ship", "hold"],
		});
		expect(n.ports.pushes.expo.sent()).toEqual([]);
		n.ports.inApp.setActive("ada", false);
		n.ports.time += 30 * MINUTE;
		await n.sendHeld({ at: n.ports.time });

		expect(n.ports.pushes.expo.sent()[0]?.gate?.lockScreen).toBe(true);
	});
});

describe("a push only", () => {
	test("a missed schedule: the push waits until the open page closes", async () => {
		const n = setup();
		const ada = n.ports.targets.add("ada", "web");
		const at = utc(2026, 9, 21, 10, 30);
		n.ports.inApp.setActive("ada", true);
		await n.tellMissed({
			spaceId: SPACE,
			projectId: "project-1",
			scheduleId: "rebalance",
			flow: "rebalance",
			at,
		});
		expect(n.ports.pushes.web.calls).toEqual([]);

		n.ports.inApp.setActive("ada", false);
		n.ports.time += 2 * MINUTE;
		await n.sendHeld({ at: n.ports.time });
		expect(n.ports.pushes.web.sentTo()).toEqual([
			`${ada.id}:missed:project-1:rebalance:${at}`,
		]);
		// With the words it kept.
		expect(n.ports.pushes.web.sent()[0]?.body).toBe(
			"rebalance was due at 10:30. Night Shift was off at that time.",
		);
	});

	test("a flow that turns severe: the push waits until the open page closes", async () => {
		const n = setup();
		const ada = n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		n.ports.events.setSevere("run-2", {
			projectId: "project-1",
			flow: "triage",
			runId: "run-2",
			signal: {
				kind: "failing",
				severe: true,
				since: NOON - 60 * MINUTE,
				runId: "run-2",
				count: 2,
			},
		});
		await n.endRun("run-2", "failed");

		n.ports.inApp.setActive("ada", false);
		n.ports.time += 2 * MINUTE;
		await n.sendHeld({ at: n.ports.time });
		expect(
			n.ports.pushes.expo.sentTo().filter((sent) => sent.includes(":look:")),
		).toEqual([`${ada.id}:look:project-1:triage:run-2`]);
	});
});
