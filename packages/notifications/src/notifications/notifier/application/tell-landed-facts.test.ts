import { describe, expect, test } from "bun:test";
import type { LandedFact } from "@nightshift/engine";
import { utc } from "@nightshift/time/testing";
import { inMemoryNotifier } from "../adapters/out/in-memory-notifier";

/**
 * The use case tellLandedFacts, on in-memory adapters: the open screens
 * hear when a run changes, a Gate that closes is withdrawn everywhere.
 * The twins of the tests of the same names in `notifier.test.ts`.
 */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

function setup() {
	const n = inMemoryNotifier();
	n.ports.time = NOON;
	return n;
}

type What = Parameters<ReturnType<typeof setup>["landed"]>[1];

describe("the open screens hear when a run changes", () => {
	test("a run that starts, sleeps, wakes, moves, stops or ends tells each open screen of its Space, quietly", async () => {
		const n = setup();
		n.ports.targets.add("ada", "web");

		// It starts, a step starts, sleeps, wakes, moves, a stop waits, the step ends.
		for (const what of [
			{ kind: "other" },
			{ kind: "other" },
			{ kind: "wait-started", stepId: "step-1", reason: "usage-limit" },
			{ kind: "wait-ended", stepId: "step-1" },
			{ kind: "other" },
			{ kind: "other" },
			{ kind: "step-ended", stepId: "step-1" },
		] as What[]) {
			await n.tellLanded([n.landed("run-1", what)]);
		}
		await n.endRun("run-1", "stopped");

		const ada = n.ports.inApp.of("ada");
		expect(ada).toHaveLength(8);
		expect(ada[0]).toEqual({
			call: "run-changed",
			spaceId: SPACE,
			runId: "run-1",
		});
		expect(new Set(ada.map((c) => c.call))).toEqual(new Set(["run-changed"]));
		// Not a Member of the run's Space.
		expect(n.ports.inApp.of("cy")).toEqual([]);
		// Quiet: no push.
		expect(n.ports.pushes.web.calls).toEqual([]);
	});

	test("once per run in a landing; a run told of otherwise in it hears nothing more", async () => {
		const n = setup();
		n.ports.events.setOpen(SPACE, [{ runId: "run-2", stepId: "gate" }]);

		await n.tellLanded([
			n.landed("run-1", { kind: "other" }),
			n.landed("run-1", { kind: "step-ended", stepId: "a" }),
			n.landed("run-1", { kind: "other" }),
			n.landed("run-2", { kind: "other" }),
			n.landed("run-2", { kind: "gate-opened", stepId: "gate" }),
			n.landed("run-3", { kind: "step-ended", stepId: "c" }),
			n.landed("run-3", { kind: "run-ended", status: "finished" }),
		]);

		expect(
			n.ports.inApp
				.of("ada")
				.map((c) =>
					c.call === "send"
						? [c.message.kind, c.message.runId]
						: [c.call, "runId" in c ? c.runId : null],
				),
		).toEqual([
			["gate-opened", "run-2"],
			["run-finished", "run-3"],
			["run-changed", "run-1"],
		]);
	});

	test("what changes no list of runs tells nothing", async () => {
		const n = setup();

		await n.tellLanded([
			n.landed("run-1", { kind: "other", changes: "spend" }),
			n.landed("run-1", { kind: "other", changes: "detail" }),
			n.landed("run-1", { kind: "other", changes: "detail" }),
		]);

		expect(n.ports.inApp.of("ada")).toEqual([]);
	});

	test("the facts of two Spaces in one landing tell each Space in its turn", async () => {
		const n = setup();
		const facts: LandedFact[] = [
			n.landed("run-1", { kind: "other" }),
			n.landed("run-9", { kind: "other" }, "space-2"),
		];

		await n.tellLanded(facts);

		expect(n.ports.inApp.of("ada")).toEqual([
			{ call: "run-changed", spaceId: SPACE, runId: "run-1" },
		]);
		expect(n.ports.inApp.of("cy")).toEqual([
			{ call: "run-changed", spaceId: "space-2", runId: "run-9" },
		]);
	});
});

describe("answer once, clear everywhere", () => {
	test("a Gate that closes is withdrawn from every screen that got it", async () => {
		const n = setup();
		const { targets, pushes, inApp } = n.ports;
		const browser = targets.add("ada", "web");
		const phone = targets.add("ada", "expo");
		const bobPhone = targets.add("bob", "expo");

		await n.openGate("run-1", "step-1");
		await n.answerGate("run-1", "step-1");

		expect(pushes.web.withdrawn()).toEqual([`${browser.id}:run-1:step-1`]);
		expect(pushes.expo.withdrawn().sort()).toEqual(
			[`${phone.id}:run-1:step-1`, `${bobPhone.id}:run-1:step-1`].sort(),
		);
		expect(inApp.of("ada").at(-1)).toEqual({
			call: "withdraw",
			key: "run-1:step-1",
		});
		expect(n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject({
			status: "withdrawn",
			withdrawnAt: NOON,
		});
	});

	test("a run that stops closes its Gate", async () => {
		const n = setup();
		const web = n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");

		n.ports.events.setOpen(SPACE, []);
		await n.endRun("run-1", "stopped");

		expect(n.ports.pushes.web.withdrawn()).toEqual([`${web.id}:run-1:step-1`]);
	});

	test("an event of another run leaves an open Gate alone", async () => {
		const n = setup();
		n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");

		await n.tellLanded([n.landed("run-2", { kind: "other" })]);

		expect(n.ports.pushes.web.withdrawn()).toEqual([]);
	});
});

describe("a step that waits for a device", () => {
	/** 06:00 UTC the next morning: the run's stop time. */
	const STOP = utc(2026, 9, 22, 6, 0);

	function waiting() {
		const n = setup();
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: "ada",
			stopAt: STOP,
			sleeping: true,
		});
		return n;
	}

	/** The step sleeps because its Device is offline: the first sleep, or a look again a minute later. */
	const sleepFor = (
		n: ReturnType<typeof setup>,
		stepId = "step-1",
		deviceName: string | null = "studio-mac",
	) =>
		n.tellLanded([
			n.landed("run-1", {
				kind: "wait-started",
				stepId,
				reason: "device-offline",
				deviceName,
			}),
		]);

	test("tells only the person the run runs for, with the flow, the device and the stop time", async () => {
		const n = waiting();
		const ada = n.ports.targets.add("ada", "expo");
		n.ports.targets.add("bob", "expo");
		n.ports.inApp.setActive("ada", true);
		n.ports.inApp.setActive("bob", true);
		n.ports.settings.save("ada", { holdMinutes: 0 });

		await sleepFor(n);

		expect(n.ports.pushes.expo.sentTo()).toEqual([
			`${ada.id}:run-1:wait:step-1`,
		]);
		expect(n.ports.pushes.expo.sent()[0]).toMatchObject({
			kind: "device-wait",
			runId: "run-1",
			stepId: "step-1",
			title: "Nightly triage waits for studio-mac",
			body: "The step starts when the device is back. If it is not back by 06:00, the run stops.",
		});
		expect(n.ports.inApp.messages("ada")[0]).toMatchObject({
			kind: "device-wait",
			key: "run-1:wait:step-1",
			title: "Nightly triage waits for studio-mac",
			alert: true,
		});
		// Bob's screens only read the run again.
		expect(n.ports.inApp.of("bob").map((c) => c.call)).toEqual(["run-changed"]);
	});

	test("the step that looks again every minute keeps its one notification", async () => {
		const n = waiting();
		n.ports.targets.add("ada", "web");

		await sleepFor(n);
		for (let minute = 1; minute <= 3; minute++) {
			n.ports.time += 60_000;
			await n.tellLanded([
				n.landed("run-1", { kind: "wait-ended", stepId: "step-1" }),
			]);
			await sleepFor(n);
			await n.checks();
		}

		expect(n.ports.pushes.web.sent()).toHaveLength(1);
		expect(n.ports.pushes.web.withdrawn()).toEqual([]);
	});

	test("is withdrawn at once when the step or the run ends", async () => {
		const n = waiting();
		const web = n.ports.targets.add("ada", "web");
		await sleepFor(n, "step-1");
		await sleepFor(n, "step-2");

		await n.tellLanded([
			n.landed("run-1", { kind: "step-ended", stepId: "step-1" }),
		]);
		expect(n.ports.pushes.web.withdrawn()).toEqual([
			`${web.id}:run-1:wait:step-1`,
		]);

		await n.endRun("run-1", "stopped");
		expect(n.ports.pushes.web.withdrawn()).toEqual([
			`${web.id}:run-1:wait:step-1`,
			`${web.id}:run-1:wait:step-2`,
		]);
	});

	test("says no stop time when the run has none, and names a device of an older Night Shift as a device", async () => {
		const n = waiting();
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: "ada",
			stopAt: null,
			sleeping: true,
		});
		n.ports.targets.add("ada", "web");

		await sleepFor(n, "step-1", null);

		expect(n.ports.pushes.web.sent()[0]).toMatchObject({
			title: "Nightly triage waits for a device",
			body: "The step starts when the device is back.",
		});
	});

	test("goes to nobody when the person turned it off, left the Space, or the run names nobody", async () => {
		const n = waiting();
		n.ports.targets.add("ada", "web");
		n.ports.targets.add("cy", "web");
		n.ports.settings.save("ada", { events: { deviceWait: false } });

		await sleepFor(n, "step-1");
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: "cy",
			stopAt: null,
			sleeping: true,
		});
		await sleepFor(n, "step-2");
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: null,
			stopAt: null,
			sleeping: true,
		});
		await sleepFor(n, "step-3");

		expect(n.ports.pushes.web.calls).toEqual([]);
	});
});

describe("a flow that turns severe under Needs a look", () => {
	const turn = (runId: string) => ({
		projectId: "project-1",
		flow: "triage",
		runId,
		signal: {
			kind: "failing" as const,
			severe: true,
			since: NOON - 60 * 60_000,
			runId,
			count: 2,
		},
	});
	const keyOf = (runId: string) => `look:project-1:triage:${runId}`;
	/** What the phones got about Needs a look. */
	const looks = (n: ReturnType<typeof setup>, kind: "web" | "expo" = "expo") =>
		n.ports.pushes[kind].sentTo().filter((sent) => sent.includes(":look:"));

	function severe() {
		const n = setup();
		n.ports.events.setRun("run-2", {
			title: "triage",
			personId: "ada",
			stopAt: null,
			sleeping: false,
		});
		return n;
	}

	test("a run that does not turn its flow severe pushes no alert", async () => {
		const n = severe();
		n.ports.targets.add("ada", "expo");
		await n.endRun("run-1", "failed");
		expect(looks(n)).toEqual([]);
	});

	test("the run that turns it severe pushes Now to every Member: the flow and why", async () => {
		const n = severe();
		const ada = n.ports.targets.add("ada", "expo");
		const bob = n.ports.targets.add("bob", "web");
		n.ports.events.setSevere("run-2", turn("run-2"));
		await n.endRun("run-2", "failed");

		expect(looks(n)).toEqual([`${ada.id}:${keyOf("run-2")}`]);
		expect(looks(n, "web")).toEqual([`${bob.id}:${keyOf("run-2")}`]);
		expect(
			n.ports.pushes.expo.sent().find((m) => m.kind === "flow-needs-a-look"),
		).toMatchObject({
			kind: "flow-needs-a-look",
			key: keyOf("run-2"),
			spaceId: SPACE,
			runId: "run-2",
			stepId: null,
			title: "triage",
			body: "Needs a look. Failed 2 runs in a row.",
			alert: true,
		});
	});

	test("a push only: an open page gets no item", async () => {
		const n = severe();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		n.ports.events.setSevere("run-2", turn("run-2"));
		await n.endRun("run-2", "failed");
		expect(
			n.ports.inApp.messages("ada").filter((m) => m.key === keyOf("run-2")),
		).toEqual([]);
		expect(looks(n)).toEqual([]);
		expect(n.ports.deliveries.entry("ada", keyOf("run-2"))?.status).toBe(
			"held",
		);
	});

	test("while it stays severe, nothing new; after it recovered, a new turn pushes again", async () => {
		const n = severe();
		const ada = n.ports.targets.add("ada", "expo");
		n.ports.events.setSevere("run-2", turn("run-2"));
		await n.endRun("run-2", "failed");
		// The run ends again after a resume: the same turn, told once.
		await n.endRun("run-2", "failed");
		// The next failure keeps it severe: the watch reads no turn.
		await n.endRun("run-3", "failed");
		expect(looks(n)).toEqual([`${ada.id}:${keyOf("run-2")}`]);

		await n.endRun("run-4", "finished");
		n.ports.events.setSevere("run-6", turn("run-6"));
		await n.endRun("run-5", "failed");
		await n.endRun("run-6", "failed");
		expect(looks(n)).toEqual([
			`${ada.id}:${keyOf("run-2")}`,
			`${ada.id}:${keyOf("run-6")}`,
		]);
	});

	test("a restart does not push the same turn again", async () => {
		const n = severe();
		const ada = n.ports.targets.add("ada", "expo");
		n.ports.events.setSevere("run-2", turn("run-2"));
		await n.endRun("run-2", "failed");

		const next = inMemoryNotifier({
			events: n.ports.events,
			deliveries: n.ports.deliveries,
			targets: n.ports.targets,
			pushes: n.ports.pushes,
		});
		next.ports.time = NOON;
		await next.endRun("run-2", "failed");
		expect(looks(n)).toEqual([`${ada.id}:${keyOf("run-2")}`]);
	});

	test("it follows the Now urgency of the push settings", async () => {
		const n = severe();
		n.ports.settings.save("ada", { pushUrgencies: ["today"] });
		n.ports.targets.add("ada", "expo");
		const bob = n.ports.targets.add("bob", "expo");
		n.ports.events.setSevere("run-2", turn("run-2"));
		await n.endRun("run-2", "failed");
		expect(looks(n)).toEqual([`${bob.id}:${keyOf("run-2")}`]);
	});
});
