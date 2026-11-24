import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { notifier } from "../test-support";

/**
 * The use case tellPeople, over a database in memory, through the landed facts
 * that call it: who hears of an event, one sender per Space, this
 * computer's desktop, push by urgency, quiet hours at the time of the event.
 * The twins of the tests of the same names in `notifier.test.ts`.
 */

const SPACE = "space-1";
const OTHER_SPACE = "space-2";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

async function setup() {
	const n = await notifier();
	n.ports.time = NOON;
	return n;
}

/** What the Person's open screens got, as [kind, alert]. */
const screen = (n: Awaited<ReturnType<typeof setup>>, personId: string) =>
	n.ports.inApp
		.of(personId)
		.map((c) =>
			c.call === "send" ? [c.message.kind, c.message.alert] : [c.call, false],
		);

describe("who hears of an event", () => {
	test("a new Gate reaches every Member of its Space, on every screen, and nobody else", async () => {
		const n = await setup();
		const { targets, pushes, inApp } = n.ports;
		const ada = targets.add("ada", "web");
		const bob = targets.add("bob", "expo");
		targets.add("cy", "web");

		await n.openGate("run-1", "step-1");

		expect(pushes.web.sentTo()).toEqual([`${ada.id}:run-1:step-1`]);
		expect(pushes.expo.sentTo()).toEqual([`${bob.id}:run-1:step-1`]);
		expect(pushes.web.sent()[0]).toMatchObject({
			kind: "gate-opened",
			spaceId: SPACE,
			runId: "run-1",
			stepId: "step-1",
			title: "A Gate waits for you",
			alert: true,
			count: null,
		});
		expect(inApp.of("dan")).toEqual([]);
		expect(inApp.of("cy")).toEqual([]);
	});

	test("the in-app stream gets every event, and alerts only for what the person wants", async () => {
		const n = await setup();
		n.ports.settings.save("bob", { events: { runFailed: false } });

		await n.openGate("run-1", "step-1");
		await n.endRun("run-2", "failed");
		await n.endRun("run-3", "finished");
		await n.endRun("run-4", "stopped");

		expect(screen(n, "ada")).toEqual([
			["gate-opened", true],
			["run-failed", true],
			["run-finished", true],
			// A run that stops tells nobody, but the open pages update.
			["run-changed", false],
		]);
		expect(screen(n, "bob")).toEqual([
			["gate-opened", true],
			["run-failed", false],
			["run-finished", true],
			["run-changed", false],
		]);
		expect(n.ports.inApp.messages("ada")[1]).toMatchObject({
			title: "A run failed",
			stepId: null,
		});
	});

	test("a person who turned an event off gets no push of it", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		n.ports.settings.save("ada", { events: { runFinished: false } });

		await n.endRun("run-1", "finished");
		await n.endRun("run-2", "failed");

		expect(n.ports.pushes.web.sentTo()).toEqual([
			`${ada.id}:run-2:end:${n.seq()}`,
		]);
	});

	test("a screen kind the person turned off gets nothing", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.settings.save("ada", { screens: { web: false } });

		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.web.calls).toEqual([]);
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
	});
});

describe("one sender per Space", () => {
	test("a daemon that does not send for the Space pushes nothing, and its pages only update", async () => {
		const n = await setup();
		n.ports.sendsFor.senders.delete(SPACE);
		n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.endRun("run-2", "finished");

		expect(n.ports.pushes.web.calls).toEqual([]);
		expect(n.ports.inApp.messages("ada").map((m) => m.alert)).toEqual([
			false,
			false,
		]);
		// Nothing was claimed: the sender of the Space claims its pushes.
		expect(await n.ports.deliveries.rows()).toEqual([]);
	});
});

describe("this computer's desktop", () => {
	test("shows the Gates of a Space another Host sends for, and pushes nothing else", async () => {
		const n = await setup();
		const { targets, pushes, inApp } = n.ports;
		n.ports.sendsFor.senders.delete(SPACE);
		const own = targets.add("ada", "desktop");
		targets.add("ada", "web");
		targets.add("bob", "expo");
		inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");
		await n.endRun("run-2", "finished");

		expect(pushes.desktop.sentTo()).toEqual([
			`${own.id}:run-1:step-1`,
			`${own.id}:run-2:end:${n.seq()}`,
		]);
		expect(pushes.web.calls).toEqual([]);
		expect(pushes.expo.calls).toEqual([]);
		// The page only updates: the Host alerts for the Space.
		expect(inApp.messages("ada").map((m) => m.alert)).toEqual([false, false]);
		// So the desktop does not wait for the page.
		expect(pushes.desktop.sent().map((m) => m.toldInApp)).toEqual([
			false,
			false,
		]);

		await n.answerGate("run-1", "step-1");
		expect(pushes.desktop.withdrawn()).toEqual([`${own.id}:run-1:step-1`]);
	});

	test("says when an open page showed the notice, so the desktop does not show it twice", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "desktop");
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");

		expect(n.ports.inApp.messages("ada").map((m) => m.alert)).toEqual([true]);
		expect(n.ports.pushes.desktop.sent().map((m) => m.toldInApp)).toEqual([
			true,
		]);
	});

	test("respects the person's events, screens and quiet hours there too", async () => {
		const n = await setup();
		const { targets, pushes, settings } = n.ports;
		n.ports.sendsFor.senders.delete(SPACE);
		settings.save("ada", {
			events: { runFinished: false },
			quietHours: { start: "22:00", end: "07:00" },
		});
		settings.save("bob", { screens: { desktop: false } });
		const own = targets.add("ada", "desktop");
		targets.add("bob", "desktop");

		await n.endRun("run-2", "finished");
		await n.openGate("run-1", "step-1");
		expect(pushes.desktop.sentTo()).toEqual([`${own.id}:run-1:step-1`]);

		n.ports.time = utc(2026, 9, 21, 23, 0);
		await n.openGate("run-3", "step-3");
		await n.openGate("run-4", "step-4");
		expect(pushes.desktop.sent()).toHaveLength(1);

		n.ports.time = utc(2026, 9, 22, 7, 0);
		await n.checks();
		expect(pushes.desktop.sent().map((m) => m.title)).toEqual([
			"A Gate waits for you",
			"2 Gates wait for you",
		]);
	});
});

describe("push by urgency", () => {
	test("by default only a Gate for now pushes; the inbox and its count get every Gate", async () => {
		const n = await setup();
		const { targets, pushes, inApp } = n.ports;
		const ada = targets.add("ada", "web");
		const phone = targets.add("ada", "expo");
		const own = targets.add("ada", "desktop");
		inApp.setActive("ada", true);

		await n.openGate("run-1", "now", SPACE, { urgency: "now" });
		await n.openGate("run-2", "today", SPACE, { urgency: "today" });
		await n.openGate("run-3", "later", SPACE, { urgency: "later" });
		// A fact without an urgency reads as today.
		await n.openGate("run-4", "none", SPACE, { urgency: null });
		inApp.setActive("ada", false);
		await n.checks();

		expect(pushes.web.sentTo()).toEqual([`${ada.id}:run-1:now`]);
		expect(pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:now`]);
		expect(pushes.desktop.sentTo()).toEqual([`${own.id}:run-1:now`]);
		expect(inApp.messages("ada").map((m) => m.key)).toEqual([
			"run-1:now",
			"run-2:today",
			"run-3:later",
			"run-4:none",
		]);
		expect(await n.ports.deliveries.live("run-2:today")).toEqual([]);
	});

	test("a Person who pushes for today gets those Gates too, and later stays in the inbox", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		const bob = n.ports.targets.add("bob", "web");
		n.ports.settings.save("ada", { pushUrgencies: ["now", "today"] });

		await n.openGate("run-1", "today", SPACE, { urgency: "today" });
		await n.openGate("run-2", "later", SPACE, { urgency: "later" });

		expect(n.ports.pushes.web.sentTo()).toEqual([`${ada.id}:run-1:today`]);
		expect(n.ports.pushes.web.sentTo()).not.toContain(`${bob.id}:run-1:today`);
	});

	test("no urgency chosen: no Gate pushes, other events still do", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		n.ports.settings.save("ada", { pushUrgencies: [] });

		await n.openGate("run-1", "step-1", SPACE, { urgency: "now" });
		await n.endRun("run-2", "failed");

		expect(n.ports.pushes.web.sentTo()).toEqual([
			`${ada.id}:run-2:end:${n.seq()}`,
		]);
	});

	test("quiet hours still hold a Gate of an urgency that pushes", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		n.ports.settings.save("ada", {
			quietHours: { start: "22:00", end: "07:00" },
			pushUrgencies: ["today"],
		});
		n.ports.time = utc(2026, 9, 21, 23, 0);

		await n.openGate("run-1", "today", SPACE, { urgency: "today" });
		await n.openGate("run-2", "now", SPACE, { urgency: "now" });
		expect(n.ports.pushes.web.calls).toEqual([]);

		n.ports.time = utc(2026, 9, 22, 7, 0);
		await n.checks();
		expect(n.ports.pushes.web.sentTo()).toEqual([`${ada.id}:run-1:today`]);
	});
});

describe("quiet hours", () => {
	test("are in the person's own time zone", async () => {
		const n = await setup();
		n.ports.settings.save("ada", {
			quietHours: { start: "22:00", end: "07:00" },
			timeZone: "Asia/Tokyo",
		});
		n.ports.time = utc(2026, 9, 21, 23, 0);
		n.ports.targets.add("ada", "web");

		// 23:00 UTC is 08:00 in Tokyo: not quiet there.
		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.web.sent()).toHaveLength(1);
	});

	test("hold pushes, not the in-app stream: the open page updates without an alert", async () => {
		const n = await setup();
		n.ports.settings.save("ada", {
			quietHours: { start: "22:00", end: "07:00" },
		});
		n.ports.time = utc(2026, 9, 21, 23, 0);
		n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.endRun("run-2", "finished");

		expect(n.ports.pushes.web.calls).toEqual([]);
		expect(screen(n, "ada")).toEqual([
			["gate-opened", false],
			["run-finished", false],
		]);
		expect(
			(await n.ports.deliveries.rows())
				.filter((row) => row.personId === "ada")
				.map((row) => row.status),
		).toEqual(["quiet", "quiet"]);
	});
});

describe("the active screen first", () => {
	test("while a page is open, a push to the phone waits; the desktop does not", async () => {
		const n = await setup();
		const { targets, pushes, inApp } = n.ports;
		const phone = targets.add("ada", "expo");
		const mac = targets.add("ada", "desktop");
		inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");

		expect(inApp.messages("ada").map((m) => m.kind)).toEqual(["gate-opened"]);
		expect(pushes.expo.calls).toEqual([]);
		// The desktop app is a screen of its own: it does not wait.
		expect(pushes.desktop.sentTo()).toEqual([`${mac.id}:run-1:step-1`]);
		expect(await n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject(
			{
				status: "held",
				dueAt: NOON + 3 * 60_000,
				sentTo: [mac.id],
				heldFor: [phone.id],
			},
		);
	});

	test("a delay of zero sends at once", async () => {
		const n = await setup();
		n.ports.settings.save("ada", { holdMinutes: 0 });
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.expo.sent()).toHaveLength(1);
	});

	test("no open page: every screen at once", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");
		n.ports.targets.add("ada", "expo");

		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.web.sent()).toHaveLength(1);
		expect(n.ports.pushes.expo.sent()).toHaveLength(1);
	});

	test("the phone app in front holds the push; its stream gets the Gate at once to show it", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);

		await n.openGate("run-1", "step-1");

		expect(screen(n, "ada")).toEqual([["gate-opened", true]]);
		expect(n.ports.pushes.expo.calls).toEqual([]);
	});

	test("a phone app that went to the background is no open screen: a new Gate is pushed at once", async () => {
		const n = await setup();
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", false);

		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
	});
});

describe("once per key", () => {
	test("the same Gate landing twice is pushed once", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.tellLanded([
			n.landed("run-1", { kind: "gate-opened", stepId: "step-1" }),
		]);
		await n.tell({
			kind: "gate-opened",
			key: "run-1:step-1",
			ids: { spaceId: SPACE, runId: "run-1", stepId: "step-1" },
		});

		expect(n.ports.pushes.web.sentTo()).toEqual([`${ada.id}:run-1:step-1`]);
	});

	test("two notifiers on the same log push a Gate once", async () => {
		const first = await setup();
		const ada = first.ports.targets.add("ada", "web");
		const second = await notifier({
			deliveries: first.ports.deliveries,
			targets: first.ports.targets,
			pushes: first.ports.pushes,
		});
		second.ports.time = NOON;

		await first.openGate("run-1", "step-1");
		await second.openGate("run-1", "step-1");

		expect(first.ports.pushes.web.sentTo()).toEqual([`${ada.id}:run-1:step-1`]);
	});

	test("the claim goes in the log before the push goes out", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		const seen: unknown[] = [];
		const send = n.ports.pushes.web.send;
		n.ports.pushes.web.send = async (target, message) => {
			seen.push((await n.ports.deliveries.entry("ada", message.key))?.status);
			return send(target, message);
		};

		await n.openGate("run-1", "step-1");

		expect(seen).toEqual(["sending"]);
		expect(await n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject(
			{
				status: "sent",
				sentTo: [ada.id],
				heldFor: [],
			},
		);
	});

	test("a Gate that opens again after it was answered is pushed again", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.answerGate("run-1", "step-1");
		await n.openGate("run-1", "step-1");

		expect(n.ports.pushes.web.sent()).toHaveLength(2);
	});
});

describe("a Space of another sender", () => {
	test("a Member of two Spaces hears of each, as each Space's sender decides", async () => {
		const n = await setup();
		n.ports.members[OTHER_SPACE] = ["ada"];
		n.ports.sendsFor.senders.delete(OTHER_SPACE);
		const web = n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.openGate("run-2", "step-2", OTHER_SPACE);

		expect(n.ports.pushes.web.sentTo()).toEqual([`${web.id}:run-1:step-1`]);
		expect(n.ports.inApp.messages("ada").map((m) => m.alert)).toEqual([
			true,
			false,
		]);
	});
});

describe("a lost screen", () => {
	test("a target its push service no longer knows is forgotten", async () => {
		const n = await setup();
		const ada = n.ports.targets.add("ada", "web");
		n.ports.pushes.web.lose(ada.id);

		await n.openGate("run-1", "step-1");

		expect(await n.ports.targets.of("ada")).toEqual([]);
		expect(n.ports.targets.forgotten).toEqual([ada.id]);
		expect(await n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject(
			{
				status: "dropped",
				sentTo: [],
			},
		);
	});

	test("a send that throws is told, and the next screen still gets it", async () => {
		const n = await setup();
		const web = n.ports.targets.add("ada", "web");
		const phone = n.ports.targets.add("ada", "expo");
		n.ports.pushes.web.fail(web.id);

		await n.openGate("run-1", "step-1");

		expect(n.ports.errors).toEqual(["A web push did not go out."]);
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
	});
});

describe("lock-screen Gates", () => {
	const marked = { lockScreen: true, choices: ["ship", "hold"] };

	test("a push about a marked Gate carries its options to a person who may answer", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "expo");
		n.ports.targets.add("bob", "expo");

		await n.openGate("run-1", "step-1", SPACE, marked);

		const [ada, bob] = n.ports.pushes.expo.sent();
		expect(ada?.gate).toEqual({
			lockScreen: true,
			options: [
				{ id: "ship", label: "ship" },
				{ id: "hold", label: "hold" },
			],
		});
		// Bob's role does not allow an answer: no buttons for him.
		expect(bob?.gate).toEqual({ lockScreen: false, options: [] });
	});

	test("an unmarked Gate carries no options", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "expo");

		await n.openGate("run-1", "step-1", SPACE, { choices: ["ship", "hold"] });

		expect(n.ports.pushes.expo.sent()[0]?.gate).toEqual({
			lockScreen: false,
			options: [],
		});
		// Nobody is asked whether they may answer an unmarked Gate.
		expect(n.ports.mayAnswer.asked).toEqual([]);
	});

	test("a run that ended carries no Gate", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "expo");

		await n.endRun("run-1", "finished");

		expect(n.ports.pushes.expo.sent()[0]).not.toHaveProperty("gate");
	});
});
