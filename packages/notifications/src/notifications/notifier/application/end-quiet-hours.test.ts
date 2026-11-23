import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { inMemoryNotifier } from "../adapters/out/in-memory-notifier";

/**
 * The use case endQuietHours, on in-memory adapters: what quiet hours
 * held goes out when they end. The twins of the tests of the same names in
 * `notifier.test.ts`.
 */

const SPACE = "space-1";
const OTHER_SPACE = "space-2";
const NIGHT = utc(2026, 9, 21, 23, 0);
const MORNING = utc(2026, 9, 22, 7, 0);

/** ada's quiet hours are 22:00 to 07:00, and it is 23:00. */
function setup() {
	const n = inMemoryNotifier();
	n.ports.time = NIGHT;
	n.ports.settings.save("ada", {
		quietHours: { start: "22:00", end: "07:00" },
	});
	return n;
}

async function morning(n: ReturnType<typeof setup>, at = MORNING) {
	n.ports.time = at;
	await n.endQuiet({ at });
}

describe("quiet hours", () => {
	test("hold pushes, not the in-app stream; when they end, the one Gate that waits goes out", async () => {
		const n = setup();
		const ada = n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.endRun("run-2", "finished");
		expect(n.ports.pushes.web.calls).toEqual([]);

		await morning(n, utc(2026, 9, 22, 6, 59));
		expect(n.ports.pushes.web.calls).toEqual([]);

		await morning(n);
		expect(n.ports.pushes.web.sentTo()).toEqual([`${ada.id}:run-1:step-1`]);
		// The run that ended meanwhile goes without a push.
		expect(
			n.ports.deliveries.entry("ada", `run-2:end:${n.seq()}`),
		).toMatchObject({ status: "dropped", heldFor: [] });

		// It went out once: the next check sends nothing more.
		await morning(n);
		expect(n.ports.pushes.web.calls).toHaveLength(1);
	});

	test("when they end, one push says how many Gates still wait", async () => {
		const n = setup();
		n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.openGate("run-2", "step-2");
		await n.openGate("run-3", "step-3");
		await n.answerGate("run-2", "step-2");

		await morning(n, utc(2026, 9, 22, 7, 30));

		expect(n.ports.pushes.web.sent()).toHaveLength(1);
		expect(n.ports.pushes.web.sent()[0]).toMatchObject({
			kind: "gates-waiting",
			title: "2 Gates wait for you",
			count: 2,
			spaceId: null,
		});
	});

	test("when they end, each screen hears only of the Gates it held", async () => {
		const n = setup();
		// Another Host sends for OTHER_SPACE: only this computer's desktop held its Gate.
		n.ports.members[OTHER_SPACE] = ["ada"];
		n.ports.sendsFor.senders.delete(OTHER_SPACE);
		const phone = n.ports.targets.add("ada", "expo");
		const own = n.ports.targets.add("ada", "desktop");

		await n.openGate("run-1", "step-1");
		await n.openGate("run-2", "step-2", OTHER_SPACE);

		const at = utc(2026, 9, 22, 7, 30);
		await morning(n, at);

		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:run-1:step-1`]);
		expect(n.ports.pushes.desktop.sent().map((m) => m.title)).toEqual([
			"2 Gates wait for you",
		]);
		expect(n.ports.pushes.desktop.sentTo()).toEqual([
			`${own.id}:waiting:${at}`,
		]);

		// The phone got the Gate itself: its answer withdraws it there.
		await n.answerGate("run-1", "step-1");
		expect(n.ports.pushes.expo.withdrawn()).toEqual([
			`${phone.id}:run-1:step-1`,
		]);
	});

	test("a Gate the summary named counts as sent there: its close withdraws it, and the last close withdraws the summary", async () => {
		const n = setup();
		const phone = n.ports.targets.add("ada", "expo");
		const own = n.ports.targets.add("ada", "desktop");

		await n.openGate("run-1", "step-1");
		await n.openGate("run-2", "step-2");

		const at = utc(2026, 9, 22, 7, 30);
		await morning(n, at);
		const summary = `waiting:${at}`;
		expect(n.ports.pushes.expo.sentTo()).toEqual([`${phone.id}:${summary}`]);
		for (const key of ["run-1:step-1", "run-2:step-2"]) {
			const [row, ...more] = await n.ports.deliveries.live(key);
			expect(more).toEqual([]);
			expect(row).toMatchObject({ personId: "ada", status: "sent" });
			expect(row?.sentTo.toSorted()).toEqual([phone.id, own.id].toSorted());
		}

		await n.answerGate("run-1", "step-1");
		const keys = (calls: string[]) =>
			calls.map((c) => c.split(":").slice(1).join(":"));
		expect(keys(n.ports.pushes.expo.withdrawn())).toEqual(["run-1:step-1"]);
		expect(keys(n.ports.pushes.desktop.withdrawn())).toEqual(["run-1:step-1"]);

		await n.answerGate("run-2", "step-2");
		expect(keys(n.ports.pushes.expo.withdrawn())).toEqual([
			"run-1:step-1",
			"run-2:step-2",
			summary,
		]);
		expect(keys(n.ports.pushes.desktop.withdrawn())).toEqual([
			"run-1:step-1",
			"run-2:step-2",
			summary,
		]);
	});
});

describe("this computer's desktop", () => {
	test("the quiet-hours summary of a Space another Host sends for reaches no push", async () => {
		const n = setup();
		n.ports.sendsFor.senders.delete(SPACE);
		n.ports.targets.add("ada", "web");

		await n.openGate("run-1", "step-1");
		await n.openGate("run-2", "step-2");
		await morning(n);

		expect(n.ports.pushes.web.calls).toEqual([]);
	});
});

describe("a step that waits for a device", () => {
	test("a wait held over quiet hours goes out with its words when they end", async () => {
		const n = setup();
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: "ada",
			stopAt: utc(2026, 9, 22, 9, 30),
			sleeping: true,
		});
		const ada = n.ports.targets.add("ada", "web");

		await n.tellLanded([
			n.landed("run-1", {
				kind: "wait-started",
				stepId: "step-1",
				reason: "device-offline",
				deviceName: "studio-mac",
			}),
		]);
		expect(n.ports.pushes.web.calls).toEqual([]);

		await morning(n);

		expect(n.ports.pushes.web.sentTo()).toEqual([
			`${ada.id}:run-1:wait:step-1`,
		]);
		expect(n.ports.pushes.web.sent()[0]).toMatchObject({
			title: "Nightly triage waits for studio-mac",
			body: "The step starts when the device is back. If it is not back by 09:30, the run stops.",
		});
	});
});

describe("a missed schedule", () => {
	test("held over quiet hours, it goes out when they end", async () => {
		const n = setup();
		const ada = n.ports.targets.add("ada", "web");
		const at = utc(2026, 9, 21, 22, 30);
		await n.tellMissed({
			spaceId: SPACE,
			projectId: "project-1",
			scheduleId: "rebalance",
			flow: "rebalance",
			at,
		});
		expect(n.ports.pushes.web.calls).toEqual([]);

		await morning(n);
		expect(n.ports.pushes.web.sentTo()).toEqual([
			`${ada.id}:missed:project-1:rebalance:${at}`,
		]);
		expect(n.ports.pushes.web.sent()[0]?.body).toBe(
			"rebalance was due at 22:30. Night Shift was off at that time.",
		);
	});
});

describe("a flow that turns severe under Needs a look", () => {
	test("held over quiet hours, it goes out when they end", async () => {
		const n = setup();
		const ada = n.ports.targets.add("ada", "expo");
		n.ports.events.setRun("run-2", {
			title: "triage",
			personId: "ada",
			stopAt: null,
			sleeping: false,
		});
		n.ports.events.setSevere("run-2", {
			projectId: "project-1",
			flow: "triage",
			runId: "run-2",
			signal: {
				kind: "failing",
				severe: true,
				since: NIGHT - 60 * 60_000,
				runId: "run-2",
				count: 2,
			},
		});
		await n.endRun("run-2", "failed");
		const looks = () =>
			n.ports.pushes.expo.sentTo().filter((sent) => sent.includes(":look:"));
		expect(looks()).toEqual([]);

		await morning(n);
		expect(looks()).toEqual([`${ada.id}:look:project-1:triage:run-2`]);
		expect(
			n.ports.pushes.expo.sent().find((m) => m.kind === "flow-needs-a-look")
				?.body,
		).toBe("Needs a look. Failed 2 runs in a row.");
	});
});
