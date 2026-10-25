import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";

import {
	createInAppChannel,
	type InAppChannel,
	type InAppItem,
	type PushChannels,
} from "../channels";
import { createDeliveryLog, type DeliveryLog } from "../deliveries";
import { createSettingsStore, type SettingsStore } from "../settings";
import { createTargetStore, type TargetStore } from "../targets";
import { type FakeRunEvents, fakeRunEvents } from "../testing";
import { testDatabase } from "../testing/database";
import { type FakeChannel, fakeChannel } from "../testing/fakes";
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

function makeNotifier(push: PushChannels = { web, expo, desktop }): Notifier {
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
		push,
		now: () => clock,
		tickMs: 1_000_000,
		onError: (message, error) => {
			throw new Error(`${message} ${String(error)}`);
		},
	});
}

/**
 * A Person's open page, or the phone app in front (`phone`): what its
 * in-app stream got.
 */
function openScreen(
	personId: string,
	options: { phone?: boolean } = {},
): InAppItem[] {
	const items: InAppItem[] = [];
	const controller = new AbortController();
	streams.push(controller);
	void (async () => {
		for await (const item of inApp.watch(
			personId,
			controller.signal,
			options,
		)) {
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

/** Waits until a notifier claimed the key in the delivery log. */
async function waitForClaim(key: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if ((await deliveries.live(key)).length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Nobody claimed ${key}.`);
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
			// A run that stops tells nobody, but the open pages update.
			["run-changed", false],
		]);
		expect(bob.map((i) => [i.kind, "alert" in i && i.alert])).toEqual([
			["gate-opened", true],
			["run-failed", false],
			["run-finished", true],
			["run-changed", false],
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
		// So the desktop does not wait for the page.
		expect(desktop.sent().map((m) => m.toldInApp)).toEqual([false, false]);

		await answerGate("run-1", "step-1");
		expect(desktop.withdrawn()).toEqual(["run-1:step-1"]);
	});

	test("says when an open page showed the notice, so the desktop does not show it twice", async () => {
		await notifier.start();
		await register("ada", "desktop");
		const screen = openScreen("ada");

		await openGate("run-1", "step-1");

		expect(screen.map((i) => "alert" in i && i.alert)).toEqual([true]);
		expect(desktop.sent().map((m) => m.toldInApp)).toEqual([true]);
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
		// The open page updates, but shows no notification at night.
		expect(screen.map((i) => [i.kind, "alert" in i && i.alert])).toEqual([
			["gate-opened", false],
			["run-finished", false],
		]);

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

	test("when they end, each screen hears only of the Gates it held", async () => {
		// Another Host sends for OTHER_SPACE: only this computer's desktop held its Gate.
		members[OTHER_SPACE] = ["ada"];
		senders.delete(OTHER_SPACE);
		await notifier.start();
		const phone = await register("ada", "expo");
		const own = await register("ada", "desktop");

		await openGate("run-1", "step-1");
		await openGate("run-2", "step-2", OTHER_SPACE);

		clock = Date.UTC(2026, 9, 22, 7, 30);
		await notifier.tick();

		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
		expect(desktop.sent().map((m) => m.title)).toEqual([
			"2 Gates wait for you",
		]);
		expect(sentTo(desktop)).toEqual([`${own.id}:waiting:${clock}`]);

		// The phone got the Gate itself: its answer withdraws it there.
		await answerGate("run-1", "step-1");
		expect(expo.withdrawn()).toEqual(["run-1:step-1"]);
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

	test("the phone app in front holds the push; its stream gets the Gate at once to show it", async () => {
		await notifier.start();
		await register("ada", "expo");
		const phone = openScreen("ada", { phone: true });

		await openGate("run-1", "step-1");

		expect(phone.map((i) => [i.kind, "alert" in i && i.alert])).toEqual([
			["gate-opened", true],
		]);
		expect(expo.calls).toEqual([]);
	});

	test("a phone app that went to the background is no open screen: a new Gate is pushed at once", async () => {
		await notifier.start();
		const phone = await register("ada", "expo");
		openScreen("ada", { phone: true });
		await closeScreens();

		clock += 10_000;
		await openGate("run-1", "step-1");

		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a page that closed counts as open for a minute: it may reload", async () => {
		await notifier.start();
		await register("ada", "expo");
		openScreen("ada");
		await closeScreens();

		clock += 10_000;
		await openGate("run-1", "step-1");

		expect(expo.calls).toEqual([]);
	});

	test("a held push goes once the person has no screen open, not after the full delay", async () => {
		await notifier.start();
		const phone = await register("ada", "expo");
		openScreen("ada", { phone: true });
		await openGate("run-1", "step-1");
		expect(expo.calls).toEqual([]);

		// The person puts the phone away without an answer.
		await closeScreens();
		clock += 15_000;
		await notifier.tick();

		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
	});

	test("a held push waits out the minute of a page that closed, then goes", async () => {
		await notifier.start();
		const phone = await register("ada", "expo");
		openScreen("ada");
		await openGate("run-1", "step-1");
		await closeScreens();

		clock += 30_000;
		await notifier.tick();
		expect(expo.calls).toEqual([]);

		clock += 31_000;
		await notifier.tick();
		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
	});
});

describe("the open screens hear when a run changes", () => {
	test("a run that starts, sleeps, wakes, moves, stops or ends tells each open screen of its Space, quietly", async () => {
		await notifier.start();
		await register("ada", "web");
		const ada = openScreen("ada");
		const cy = openScreen("cy");

		for (const type of [
			"RunStarted",
			"StepStarted",
			"WaitStarted",
			"WaitEnded",
			"WalkerMoved",
			"StopRequested",
			"StepEnded",
		]) {
			events.land([event(type, "run-1", "step-1")]);
			await notifier.idle();
		}
		await endRun("run-1", "stopped");

		expect(ada).toHaveLength(8);
		expect(ada[0]).toEqual({
			kind: "run-changed",
			spaceId: SPACE,
			runId: "run-1",
			at: NOON,
		});
		expect(new Set(ada.map((i) => i.kind))).toEqual(new Set(["run-changed"]));
		// Not a Member of the run's Space.
		expect(cy).toEqual([]);
		// Quiet: no push.
		expect(web.calls).toEqual([]);
	});

	test("once per run in a landing; a run told of otherwise in it hears nothing more", async () => {
		await notifier.start();
		const ada = openScreen("ada");
		events.setOpen(SPACE, [{ runId: "run-2", stepId: "gate" }]);

		events.land([
			event("StepStarted", "run-1", "a"),
			event("StepEnded", "run-1", "a"),
			event("StepStarted", "run-1", "b"),
			event("StepStarted", "run-2", "gate"),
			event("GateOpened", "run-2", "gate"),
			event("StepEnded", "run-3", "c"),
			event("RunEnded", "run-3", null, { status: "finished", reason: null }),
		]);
		await notifier.idle();

		expect(ada.map((i) => [i.kind, i.runId])).toEqual([
			["gate-opened", "run-2"],
			["run-finished", "run-3"],
			["run-changed", "run-1"],
		]);
	});

	test("what changes no list of runs tells nothing", async () => {
		await notifier.start();
		const ada = openScreen("ada");

		events.land([
			event("SessionUsage", "run-1", "a"),
			event("EdgeTaken", "run-1", "a"),
			event("VariablesSet", "run-1", "a"),
		]);
		await notifier.idle();

		expect(ada).toEqual([]);
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

	test("a Gate told before is not told again at start", async () => {
		await register("ada", "web");
		await notifier.start();
		await openGate("run-1", "step-1");
		notifier.stop();

		notifier = makeNotifier();
		const screen = openScreen("ada");
		await notifier.start();
		events.land([event("StepStarted", "run-1", "step-2")]);
		await notifier.idle();

		expect(web.sent()).toHaveLength(1);
		expect(screen.map((i) => i.kind)).toEqual(["run-changed"]);
	});

	test("a Gate that opened while no notifier listened is pushed at start", async () => {
		await register("ada", "web");
		const phone = await register("bob", "expo");
		events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);

		await notifier.start();

		expect(sentTo(expo)).toEqual([`${phone.id}:run-1:step-1`]);
		expect(web.sent()).toHaveLength(1);
		// Once: the next start finds it in the log.
		notifier.stop();
		notifier = makeNotifier();
		await notifier.start();
		expect(expo.sent()).toHaveLength(1);
	});

	test("a Gate whose push a crash cut short goes out once after the restart", async () => {
		await register("ada", "web");
		// The push never returns: Night Shift stops before it went out.
		notifier = makeNotifier({
			web: { send: () => new Promise(() => {}), withdraw: async () => {} },
		});
		await notifier.start();
		events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);
		events.land([event("GateOpened", "run-1", "step-1")]);
		await waitForClaim("run-1:step-1");
		notifier.stop();

		notifier = makeNotifier();
		await notifier.start();
		clock += MINUTE;
		await notifier.tick();
		expect(web.sent().map((m) => m.key)).toEqual(["run-1:step-1"]);

		// Once: the next start finds it sent.
		notifier.stop();
		notifier = makeNotifier();
		await notifier.start();
		clock += MINUTE;
		await notifier.tick();
		expect(web.sent()).toHaveLength(1);
	});

	test("a push that is still going out is not sent twice by the next notifier", async () => {
		await register("ada", "web");
		// A reload: the last notifier still waits for the push service.
		notifier = makeNotifier({
			web: { send: () => new Promise(() => {}), withdraw: async () => {} },
		});
		await notifier.start();
		events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);
		events.land([event("GateOpened", "run-1", "step-1")]);
		await waitForClaim("run-1:step-1");

		const next = makeNotifier();
		await next.start();
		await next.tick();
		next.stop();

		expect(web.sent()).toHaveLength(0);
	});

	test("a cut-short push of a Gate that closed meanwhile never goes out", async () => {
		await register("ada", "web");
		notifier = makeNotifier({
			web: { send: () => new Promise(() => {}), withdraw: async () => {} },
		});
		await notifier.start();
		events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);
		events.land([event("GateOpened", "run-1", "step-1")]);
		await waitForClaim("run-1:step-1");
		notifier.stop();

		events.setOpen(SPACE, []);
		notifier = makeNotifier();
		await notifier.start();
		clock += MINUTE;
		await notifier.tick();

		expect(web.sent()).toHaveLength(0);
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
