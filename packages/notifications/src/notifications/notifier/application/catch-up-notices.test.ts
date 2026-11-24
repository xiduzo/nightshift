import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { notifier } from "../test-support";

/**
 * The use case catchUpNotices, over a database in memory: what a notifier does
 * at start, after another one stopped (a reload, a restart, a crash). The
 * twins of the tests of the same names in `notifier.test.ts`.
 */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);
const MINUTE = 60_000;
/** 06:00 UTC the next morning: the run's stop time. */
const STOP = utc(2026, 9, 22, 6, 0);

type Notifier = Awaited<ReturnType<typeof notifier>>;

async function setup() {
	const n = await notifier();
	n.ports.time = NOON;
	return n;
}

/** The next notifier on the same log, run events, screens and channels, at the same time. */
async function restart(last: Notifier): Promise<Notifier> {
	const { events, deliveries, targets, pushes, settings, inApp } = last.ports;
	const next = await notifier({
		events,
		deliveries,
		targets,
		pushes,
		settings,
		inApp,
	});
	next.ports.time = last.ports.time;
	return next;
}

/** A Gate's push that a notifier claimed and never sent: Night Shift stopped before it went out. */
async function cutShort(n: Notifier, targetIds: string[]) {
	n.ports.events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);
	await n.ports.deliveries.claim(
		{
			personId: "ada",
			key: "run-1:step-1",
			kind: "gate-opened",
			spaceId: SPACE,
			runId: "run-1",
			stepId: "step-1",
		},
		{ status: "sending", heldFor: targetIds },
		n.ports.time,
	);
}

describe("once per key", () => {
	test("a Gate told before is not told again at start", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");

		const next = await restart(n);
		const before = next.ports.inApp.of("ada").length;
		await next.catchUp();
		await next.tellLanded([next.landed("run-1", { kind: "other" })]);

		expect(next.ports.pushes.web.sent()).toHaveLength(1);
		expect(next.ports.inApp.of("ada").slice(before)).toEqual([
			{ call: "run-changed", spaceId: SPACE, runId: "run-1" },
		]);
	});

	test("a Gate that opened while no notifier listened is pushed at start", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "web");
		const phone = n.ports.targets.add("bob", "expo");
		n.ports.events.setOpen(SPACE, [{ runId: "run-1", stepId: "step-1" }]);

		await n.catchUp();

		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
		expect(n.ports.pushes.web.sent()).toHaveLength(1);
		// Pushes only: the open pages read everything again when they connect.
		expect(n.ports.inApp.of("ada")).toEqual([]);
		// Once: the next start finds it in the log.
		await (await restart(n)).catchUp();
		expect(n.ports.pushes.expo.sent()).toHaveLength(1);
	});

	test("a Gate whose push a crash cut short goes out once after the restart", async () => {
		const n = await setup();
		const web = n.ports.targets.add("ada", "web");
		await cutShort(n, [web.id]);

		const next = await restart(n);
		await next.catchUp();
		next.ports.time += MINUTE;
		await next.checks();
		expect(next.ports.pushes.web.sent().map((m) => m.key)).toEqual([
			"run-1:step-1",
		]);

		// Once: the next start finds it sent.
		const third = await restart(next);
		await third.catchUp();
		third.ports.time += MINUTE;
		await third.checks();
		expect(third.ports.pushes.web.sent()).toHaveLength(1);
	});

	test("a push that is still going out is not sent twice by the next notifier", async () => {
		const n = await setup();
		const web = n.ports.targets.add("ada", "web");
		await cutShort(n, [web.id]);

		const next = await restart(n);
		await next.catchUp();
		await next.checks();

		expect(next.ports.pushes.web.sent()).toHaveLength(0);
	});

	test("a cut-short push of a Gate that closed meanwhile never goes out", async () => {
		const n = await setup();
		const web = n.ports.targets.add("ada", "web");
		await cutShort(n, [web.id]);

		n.ports.events.setOpen(SPACE, []);
		const next = await restart(n);
		await next.catchUp();
		next.ports.time += MINUTE;
		await next.checks();

		expect(next.ports.pushes.web.sent()).toHaveLength(0);
	});

	test("a Gate that closed while Night Shift was away is withdrawn at start", async () => {
		const n = await setup();
		const web = n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");

		n.ports.events.setOpen(SPACE, []);
		await (await restart(n)).catchUp();

		expect(n.ports.pushes.web.withdrawn()).toEqual([`${web.id}:run-1:step-1`]);
	});
});

describe("an answer that waits for the Device that walks the run", () => {
	test("a Gate found with an answer on its way at start is not pushed, and its told push is withdrawn", async () => {
		const n = await setup();
		const phone = n.ports.targets.add("ada", "expo");
		await n.openGate("run-1", "step-1");
		n.ports.events.setOpen(SPACE, [
			{ runId: "run-1", stepId: "step-1", answerPending: true },
		]);
		n.ports.pushes.expo.calls.length = 0;

		await (await restart(n)).catchUp();

		expect(n.ports.pushes.expo.calls).toEqual([
			{ call: "withdraw", targetId: phone.id, key: "run-1:step-1" },
		]);
	});
});

describe("a step that waits for a device", () => {
	/** The step sleeps because its Device is offline. */
	const sleepFor = (n: Notifier) =>
		n.tellLanded([
			n.landed("run-1", {
				kind: "wait-started",
				stepId: "step-1",
				reason: "device-offline",
				deviceName: "studio-mac",
			}),
		]);

	const run = (sleeping: boolean) => ({
		title: "Nightly triage",
		personId: "ada",
		stopAt: STOP,
		sleeping,
	});

	test("a wait that ended while no notifier listened is withdrawn at start", async () => {
		const n = await setup();
		n.ports.events.setRun("run-1", run(true));
		const web = n.ports.targets.add("ada", "web");
		await sleepFor(n);

		n.ports.events.setRun("run-1", run(false));
		await (await restart(n)).catchUp();

		expect(n.ports.pushes.web.withdrawn()).toEqual([
			`${web.id}:run-1:wait:step-1`,
		]);
	});

	test("a wait that still lasts at start is withdrawn when it ends later", async () => {
		const n = await setup();
		n.ports.events.setRun("run-1", run(true));
		const web = n.ports.targets.add("ada", "web");
		await sleepFor(n);

		const next = await restart(n);
		await next.catchUp();
		expect(next.ports.pushes.web.withdrawn()).toEqual([]);

		await next.tellLanded([
			next.landed("run-1", { kind: "step-ended", stepId: "step-1" }),
		]);
		expect(next.ports.pushes.web.withdrawn()).toEqual([
			`${web.id}:run-1:wait:step-1`,
		]);
	});
});
