import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { inMemoryNotifier } from "../adapters/out/in-memory-notifier";

/**
 * The use case endDeviceWaits, on in-memory adapters. The twin of the test
 * of the same name in `notifier.test.ts`.
 */

/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

describe("a step that waits for a device", () => {
	test("is withdrawn once the step does not sleep again", async () => {
		const n = inMemoryNotifier();
		n.ports.time = NOON;
		n.ports.events.setRun("run-1", {
			title: "Nightly triage",
			personId: "ada",
			stopAt: utc(2026, 9, 22, 6, 0),
			sleeping: true,
		});
		const phone = n.ports.targets.add("ada", "expo");
		await n.tellLanded([
			n.landed("run-1", {
				kind: "wait-started",
				stepId: "step-1",
				reason: "device-offline",
				deviceName: "studio-mac",
			}),
		]);
		const before = n.ports.inApp.of("ada").length;

		await n.tellLanded([
			n.landed("run-1", { kind: "wait-ended", stepId: "step-1" }),
		]);
		await n.endWaits({ at: n.ports.time });
		expect(n.ports.pushes.expo.withdrawn()).toEqual([]);

		n.ports.time += 15_000;
		await n.endWaits({ at: n.ports.time });
		expect(n.ports.pushes.expo.calls.at(-1)).toEqual({
			call: "withdraw",
			targetId: phone.id,
			key: "run-1:wait:step-1",
		});
		expect(n.ports.inApp.of("ada").slice(before)).toEqual([
			{ call: "run-changed", spaceId: "space-1", runId: "run-1" },
			{ call: "withdraw", key: "run-1:wait:step-1" },
		]);
		expect(await n.ports.deliveries.live("run-1:wait:step-1")).toEqual([]);
	});
});
