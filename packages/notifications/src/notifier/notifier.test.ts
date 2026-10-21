import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";

import {
	createInAppChannel,
	type InAppChannel,
	type InAppItem,
} from "../channels";
import { createDeliveryLog, type DeliveryLog } from "../deliveries";
import { createSettingsStore, type SettingsStore } from "../settings";
import { createTargetStore, type TargetStore } from "../targets";
import {
	type FakeChannel,
	type FakeRunEvents,
	fakeChannel,
	fakeRunEvents,
	testDatabase,
} from "../testing";
import { createNotifier, type Notifier } from "./notifier";
import { type OpenGateRef, oneSenderPerSpace, type RunEvent } from "./sources";

/**
 * The rules of the notifier, on a real database with fake run events and
 * fake push channels: who hears of an event, one sender per Space, quiet
 * hours, the active screen first, withdraw on close, once per key.
 */

const SPACE = "space-1";
const OTHER_SPACE = "space-2";
/** 12:00 UTC on a weekday. */
const NOON = Date.UTC(2026, 9, 21, 12, 0);
const MINUTE = 60_000;

let db: Database;
let cleanup: () => void;
let clock: number;
let events: FakeRunEvents;
let web: FakeChannel;
let expo: FakeChannel;
let desktop: FakeChannel;
let inApp: InAppChannel;
let settings: SettingsStore;
let targets: TargetStore;
let deliveries: DeliveryLog;
let members: Record<string, string[]>;
let senders: Set<string>;
/** Who may answer a Gate, as `${spaceId}:${personId}`. */
let answerers: Set<string>;
let notifier: Notifier;
const streams: AbortController[] = [];

beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
	clock = NOON;
	events = fakeRunEvents();
	web = fakeChannel();
	expo = fakeChannel();
	desktop = fakeChannel();
	inApp = createInAppChannel({ now: () => clock });
	settings = createSettingsStore(db, { timeZone: "UTC" });
	targets = createTargetStore(db, () => clock);
	deliveries = createDeliveryLog(db);
	members = { [SPACE]: ["ada", "bob"], [OTHER_SPACE]: ["cy"] };
	senders = new Set([SPACE, OTHER_SPACE]);
	answerers = new Set([`${SPACE}:ada`, `${OTHER_SPACE}:cy`]);
	notifier = makeNotifier();
});

afterEach(() => {
	notifier.stop();
	for (const stream of streams.splice(0)) stream.abort();
	cleanup();
});

function makeNotifier(): Notifier {
	return createNotifier({
		events: events.source,
		audience: async (spaceId) => members[spaceId] ?? [],
		spaces: async () => Object.keys(members),
		sendsFor: async (spaceId) => senders.has(spaceId),
		mayAnswer: async (spaceId, personId) =>
			answerers.has(`${spaceId}:${personId}`),
		settings,
		targets,
		deliveries,
		inApp,
		push: { web, expo, desktop },
		now: () => clock,
		tickMs: 1_000_000,
		onError: (message, error) => {
			throw new Error(`${message} ${String(error)}`);
		},
	});
}

/** A Person's open page: what its in-app stream got. */
function openScreen(personId: string): InAppItem[] {
	const items: InAppItem[] = [];
	const controller = new AbortController();
	streams.push(controller);
	void (async () => {
		for await (const item of inApp.watch(personId, controller.signal)) {
			items.push(item);
		}
	})();
	return items;
}

/** Closes every open page, and lets their streams end. */
async function closeScreens(): Promise<void> {
	for (const stream of streams.splice(0)) stream.abort();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

let seq = 0;
function event(
	type: string,
	runId: string,
	stepId: string | null = null,
	payload: unknown = {},
	spaceId = SPACE,
): RunEvent {
	seq += 1;
	return { spaceId, runId, stepId, type, seq, payload };
}

/** A Gate opens: the engine reads it open from now on, and its event lands. */
async function openGate(
	runId: string,
	stepId: string,
	spaceId = SPACE,
	facts: Omit<OpenGateRef, "runId" | "stepId"> = {},
) {
	events.setOpen(spaceId, [
		...(await events.source.openGates(spaceId)),
		{ runId, stepId, ...facts },
	]);
	events.land([event("GateOpened", runId, stepId, {}, spaceId)]);
	await notifier.idle();
}

/** A Gate is answered: the engine no longer reads it open, and its step ends. */
async function answerGate(runId: string, stepId: string, spaceId = SPACE) {
	events.setOpen(
		spaceId,
		(await events.source.openGates(spaceId)).filter(
			(g) => !(g.runId === runId && g.stepId === stepId),
		),
	);
	events.land([event("StepEnded", runId, stepId, {}, spaceId)]);
	await notifier.idle();
}

async function endRun(runId: string, status: string) {
	events.land([event("RunEnded", runId, null, { status, reason: null })]);
	await notifier.idle();
}

const register = (personId: string, kind: "web" | "expo" | "desktop") =>
	targets.register(personId, {
		kind,
		name: `${personId}'s ${kind}`,
		endpoint: `${kind}://${personId}`,
	});

const sentTo = (channel: FakeChannel) =>
	channel.calls.flatMap((c) =>
		c.call === "send" ? [`${c.targetId}:${c.message.key}`] : [],
	);

describe("who hears of an event", () => {
	test("a new Gate reaches every Member of its Space, on every screen, and nobody else", async () => {
		await notifier.start();
		const ada = await register("ada", "web");
		const bob = await register("bob", "expo");
		await register("cy", "web");
		const strangerScreen = openScreen("dan");
		const cyScreen = openScreen("cy");

		await openGate("run-1", "step-1");

		expect(sentTo(web)).toEqual([`${ada.id}:run-1:step-1`]);
		expect(sentTo(expo)).toEqual([`${bob.id}:run-1:step-1`]);
		expect(web.sent()[0]).toMatchObject({
			kind: "gate-opened",
			spaceId: SPACE,
			runId: "run-1",
			stepId: "step-1",
			title: "A Gate waits for you",
			alert: true,
			count: null,
		});
		expect(strangerScreen).toEqual([]);
		expect(cyScreen).toEqual([]);
	});

	test("the in-app stream gets every event, and alerts only for what the person wants", async () => {
		await notifier.start();
		await settings.save("bob", { events: { runFailed: false } });
		const ada = openScreen("ada");
		const bob = openScreen("bob");

		await openGate("run-1", "step-1");
		await endRun("run-2", "failed");
		await endRun("run-3", "finished");
		await endRun("run-4", "stopped");

		expect(ada.map((i) => [i.kind, "alert" in i && i.alert])).toEqual([
			["gate-opened", true],
			["run-failed", true],
			["run-finished", true],
		]);
		expect(bob.map((i) => [i.kind, "alert" in i && i.alert])).toEqual([
			["gate-opened", true],
			["run-failed", false],
			["run-finished", true],
		]);
		expect(ada[1]).toMatchObject({ title: "A run failed", stepId: null });
	});

	test("a person who turned an event off gets no push of it", async () => {
		await notifier.start();
		const ada = await register("ada", "web");
		await settings.save("ada", { events: { runFinished: false } });

		await endRun("run-1", "finished");
		await endRun("run-2", "failed");

		expect(sentTo(web)).toEqual([`${ada.id}:run-2:end:${seq}`]);
	});

	test("a screen kind the person turned off gets nothing", async () => {
		await notifier.start();
		await register("ada", "web");
		const phone = await register("ada", "expo");
		await settings.save("ada", { screens: { web: false } });

		await openGate("run-1", "step-1");

		expect(web.calls).toEqual([]);
		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a target its push service no longer knows is forgotten", async () => {
		await notifier.start();
		const ada = await register("ada", "web");
		web.lose(ada.id);

		await openGate("run-1", "step-1");

		expect(await targets.of("ada")).toEqual([]);
	});
});

describe("one sender per Space", () => {
	test("a daemon that does not send for the Space pushes nothing, and its pages only update", async () => {
		senders.delete(SPACE);
		await notifier.start();
		await register("ada", "web");
		const screen = openScreen("ada");

		await openGate("run-1", "step-1");
		await endRun("run-2", "finished");

		expect(web.calls).toEqual([]);
		expect(screen.map((i) => "alert" in i && i.alert)).toEqual([false, false]);
	});

	const facts = (
		isHost: boolean,
		elsewhere: string[],
		personal: string | null,
	) =>
		oneSenderPerSpace({
			isHost: () => isHost,
			hostedElsewhere: async (spaceId) => elsewhere.includes(spaceId),
			ownPersonalSpaceId: async () => personal,
		});

	test("a Host sends for the Spaces it keeps, never for one another Host keeps", async () => {
		const sendsFor = facts(true, ["kept-elsewhere"], "personal");
		expect(await sendsFor("team")).toBe(true);
		expect(await sendsFor("personal")).toBe(true);
		expect(await sendsFor("kept-elsewhere")).toBe(false);
	});

	test("a Device sends only for its own personal Space", async () => {
		const sendsFor = facts(false, ["personal-on-host"], "personal");
		expect(await sendsFor("personal")).toBe(true);
		expect(await sendsFor("personal-on-host")).toBe(false);
		expect(await sendsFor("team")).toBe(false);
	});
});

describe("this computer's desktop", () => {
	test("shows the Gates of a Space another Host sends for, and pushes nothing else", async () => {
		senders.delete(SPACE);
		await notifier.start();
		const own = await register("ada", "desktop");
		await register("ada", "web");
		await register("bob", "expo");
		const screen = openScreen("ada");

		await openGate("run-1", "step-1");
		await endRun("run-2", "finished");

		expect(sentTo(desktop)).toEqual([
			`${own.id}:run-1:step-1`,
			`${own.id}:run-2:end:${seq}`,
		]);
		expect(web.calls).toEqual([]);
		expect(expo.calls).toEqual([]);
		// The page only updates: the Host alerts for the Space.
		expect(screen.map((i) => "alert" in i && i.alert)).toEqual([false, false]);

		await answerGate("run-1", "step-1");
		expect(desktop.withdrawn()).toEqual(["run-1:step-1"]);
	});

	test("respects the person's events, screens and quiet hours there too", async () => {
		senders.delete(SPACE);
		await settings.save("ada", {
			events: { runFinished: false },
			quietHours: { start: "22:00", end: "07:00" },
		});
		await settings.save("bob", { screens: { desktop: false } });
		await notifier.start();
		const own = await register("ada", "desktop");
		await register("bob", "desktop");

		await endRun("run-2", "finished");
		await openGate("run-1", "step-1");
		expect(sentTo(desktop)).toEqual([`${own.id}:run-1:step-1`]);

		clock = Date.UTC(2026, 9, 21, 23, 0);
		await openGate("run-3", "step-3");
		await openGate("run-4", "step-4");
		expect(desktop.sent()).toHaveLength(1);

		clock = Date.UTC(2026, 9, 22, 7, 0);
		await notifier.tick();
		expect(desktop.sent().map((m) => m.title)).toEqual([
			"A Gate waits for you",
			"2 Gates wait for you",
		]);
	});

	test("the quiet-hours summary of a Space another Host sends for reaches no push", async () => {
		senders.delete(SPACE);
		await settings.save("ada", {
			quietHours: { start: "22:00", end: "07:00" },
		});
		clock = Date.UTC(2026, 9, 21, 23, 0);
		await notifier.start();
		await register("ada", "web");

		await openGate("run-1", "step-1");
		await openGate("run-2", "step-2");
		clock = Date.UTC(2026, 9, 22, 7, 0);
		await notifier.tick();

		expect(web.calls).toEqual([]);
	});
});

describe("quiet hours", () => {
	beforeEach(async () => {
		await settings.save("ada", {
			quietHours: { start: "22:00", end: "07:00" },
		});
		clock = Date.UTC(2026, 9, 21, 23, 0);
	});

	test("hold pushes, not the in-app stream; when they end, the one Gate that waits goes out", async () => {
		await notifier.start();
		const ada = await register("ada", "web");
		const screen = openScreen("ada");

		await openGate("run-1", "step-1");
		await endRun("run-2", "finished");
		expect(web.calls).toEqual([]);
		expect(screen.map((i) => i.kind)).toEqual(["gate-opened", "run-finished"]);

		clock = Date.UTC(2026, 9, 22, 6, 59);
		await notifier.tick();
		expect(web.calls).toEqual([]);

		clock = Date.UTC(2026, 9, 22, 7, 0);
		await notifier.tick();
		expect(sentTo(web)).toEqual([`${ada.id}:run-1:step-1`]);

		// It went out once: the next tick sends nothing more.
		await notifier.tick();
		expect(web.calls).toHaveLength(1);
	});

	test("when they end, one push says how many Gates still wait", async () => {
		await notifier.start();
		await register("ada", "web");

		await openGate("run-1", "step-1");
		await openGate("run-2", "step-2");
		await openGate("run-3", "step-3");
		await answerGate("run-2", "step-2");

		clock = Date.UTC(2026, 9, 22, 7, 30);
		await notifier.tick();

		expect(web.sent()).toHaveLength(1);
		expect(web.sent()[0]).toMatchObject({
			kind: "gates-waiting",
			title: "2 Gates wait for you",
			count: 2,
			spaceId: null,
		});
	});

	test("are in the person's own time zone", async () => {
		await settings.save("ada", { timeZone: "Asia/Tokyo" });
		await notifier.start();
		await register("ada", "web");

		// 23:00 UTC is 08:00 in Tokyo: not quiet there.
		await openGate("run-1", "step-1");

		expect(web.sent()).toHaveLength(1);
	});
});

describe("the active screen first", () => {
	test("while a page is open, a push to the phone waits, and goes when the Gate still waits", async () => {
		await notifier.start();
		const phone = await register("ada", "expo");
		const mac = await register("ada", "desktop");
		const screen = openScreen("ada");

		await openGate("run-1", "step-1");

		expect(screen.map((i) => i.kind)).toEqual(["gate-opened"]);
		expect(expo.calls).toEqual([]);
		// The desktop app is a screen of its own: it does not wait.
		expect(sentTo(desktop)).toEqual([`${mac.id}:run-1:step-1`]);

		clock += 2 * MINUTE;
		await notifier.tick();
		expect(expo.calls).toEqual([]);

		clock += 1 * MINUTE;
		await notifier.tick();
		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a Gate answered meanwhile never reaches the phone", async () => {
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");

		await openGate("run-1", "step-1");
		clock += MINUTE;
		await answerGate("run-1", "step-1");
		clock += 5 * MINUTE;
		await notifier.tick();

		expect(expo.calls).toEqual([]);
	});

	test("a run's end that showed on an open page is not pushed after it", async () => {
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");

		await endRun("run-1", "finished");
		clock += 5 * MINUTE;
		await notifier.tick();

		expect(expo.calls).toEqual([]);
	});

	test("a run's end is pushed when the person closed every screen meanwhile", async () => {
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");

		await endRun("run-1", "failed");
		await closeScreens();
		clock += 5 * MINUTE;
		await notifier.tick();

		expect(expo.sent().map((m) => m.kind)).toEqual(["run-failed"]);
	});

	test("a delay of zero sends at once", async () => {
		await settings.save("ada", { holdMinutes: 0 });
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");

		await openGate("run-1", "step-1");

		expect(expo.sent()).toHaveLength(1);
	});

	test("no open page: every screen at once", async () => {
		await notifier.start();
		await register("ada", "web");
		await register("ada", "expo");

		await openGate("run-1", "step-1");

		expect(web.sent()).toHaveLength(1);
		expect(expo.sent()).toHaveLength(1);
	});
});

describe("answer once, clear everywhere", () => {
	test("a Gate that closes is withdrawn from every screen that got it", async () => {
		await notifier.start();
		const browser = await register("ada", "web");
		const phone = await register("ada", "expo");
		const bobPhone = await register("bob", "expo");

		await openGate("run-1", "step-1");
		const screen = openScreen("ada");
		await answerGate("run-1", "step-1");

		expect(web.calls.filter((c) => c.call === "withdraw")).toEqual([
			{ call: "withdraw", targetId: browser.id, key: "run-1:step-1" },
		]);
		expect(
			expo.calls
				.filter((c) => c.call === "withdraw")
				.map((c) => c.targetId)
				.sort(),
		).toEqual([phone.id, bobPhone.id].sort());
		expect(screen).toMatchObject([
			{
				kind: "gate-closed",
				key: "run-1:step-1",
				runId: "run-1",
				stepId: "step-1",
			},
		]);
	});

	test("a run that stops closes its Gate", async () => {
		await notifier.start();
		await register("ada", "web");
		await openGate("run-1", "step-1");

		events.setOpen(SPACE, []);
		await endRun("run-1", "stopped");

		expect(web.withdrawn()).toEqual(["run-1:step-1"]);
	});

	test("an event of another run leaves an open Gate alone", async () => {
		await notifier.start();
		await register("ada", "web");
		await openGate("run-1", "step-1");

		events.land([event("StepStarted", "run-2", "step-9")]);
		await notifier.idle();

		expect(web.withdrawn()).toEqual([]);
	});
});

describe("once per key", () => {
	test("the same Gate landing twice is pushed once", async () => {
		await notifier.start();
		await register("ada", "web");

		await openGate("run-1", "step-1");
		events.land([event("GateOpened", "run-1", "step-1")]);
		await notifier.idle();

		expect(web.sent()).toHaveLength(1);
	});

	test("two notifiers on the same log push a Gate once", async () => {
		// A reload: the next notifier listens before the last one stopped.
		const next = makeNotifier();
		await notifier.start();
		await next.start();
		await register("ada", "web");

		await openGate("run-1", "step-1");
		await next.idle();
		next.stop();

		expect(web.sent()).toHaveLength(1);
	});

	test("the Gates open at start are the baseline: they tell nobody", async () => {
		events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);
		await notifier.start();
		await register("ada", "web");

		events.land([event("StepStarted", "run-1", "step-2")]);
		await notifier.idle();

		expect(web.calls).toEqual([]);
	});

	test("a Gate that closed while Night Shift was away is withdrawn at start", async () => {
		await notifier.start();
		await register("ada", "web");
		await openGate("run-1", "step-1");
		notifier.stop();

		events.setOpen(SPACE, []);
		notifier = makeNotifier();
		await notifier.start();

		expect(web.withdrawn()).toEqual(["run-1:step-1"]);
	});

	test("a Gate that opens again after it was answered is pushed again", async () => {
		await notifier.start();
		await register("ada", "web");

		await openGate("run-1", "step-1");
		await answerGate("run-1", "step-1");
		await openGate("run-1", "step-1");

		expect(web.sent()).toHaveLength(2);
	});
});

describe("lock-screen Gates", () => {
	const marked = { lockScreen: true, choices: ["ship", "hold"] };

	test("a push about a marked Gate carries its options to a person who may answer", async () => {
		await notifier.start();
		await register("ada", "expo");
		await register("bob", "expo");

		await openGate("run-1", "step-1", SPACE, marked);

		const [ada, bob] = expo.sent();
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
		await notifier.start();
		await register("ada", "expo");

		await openGate("run-1", "step-1", SPACE, { choices: ["ship", "hold"] });

		expect(expo.sent()[0]?.gate).toEqual({ lockScreen: false, options: [] });
	});

	test("a held push still carries the options when it goes", async () => {
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");

		await openGate("run-1", "step-1", SPACE, marked);
		expect(expo.sent()).toEqual([]);
		await closeScreens();
		clock += 30 * MINUTE;
		await notifier.tick();

		expect(expo.sent()[0]?.gate?.lockScreen).toBe(true);
	});

	test("a run that ended carries no Gate", async () => {
		await notifier.start();
		await register("ada", "expo");

		await endRun("run-1", "finished");

		expect(expo.sent()[0]).not.toHaveProperty("gate");
	});
});
