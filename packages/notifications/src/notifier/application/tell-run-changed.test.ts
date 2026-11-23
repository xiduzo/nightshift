import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { inMemoryNotifier } from "../adapters/out/in-memory-notifier";

/**
 * The use case tellRunChanged, on in-memory adapters: an answer that waits
 * for the Device that walks the run. The twins of the tests of the same
 * names in `notifier.test.ts`.
 */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

function setup() {
	const n = inMemoryNotifier();
	n.ports.time = NOON;
	return n;
}

/** The answer is kept for the run's Device, or that Device refused it: the engine reads it so. */
async function setPending(
	n: ReturnType<typeof setup>,
	runId: string,
	stepId: string,
	pending: boolean,
) {
	n.ports.events.setOpen(
		SPACE,
		(await n.ports.events.openGates(SPACE)).map((g) =>
			g.runId === runId && g.stepId === stepId
				? { ...g, answerPending: pending }
				: g,
		),
	);
	await n.runChanged({ spaceId: SPACE, runId });
}

describe("an answer that waits for the Device that walks the run", () => {
	test("closes the Gate everywhere at once", async () => {
		const n = setup();
		const browser = n.ports.targets.add("ada", "web");
		const phone = n.ports.targets.add("ada", "expo");
		await n.openGate("run-1", "step-1");

		await setPending(n, "run-1", "step-1", true);

		expect(n.ports.pushes.web.withdrawn()).toEqual([
			`${browser.id}:run-1:step-1`,
		]);
		expect(n.ports.pushes.expo.calls.at(-1)).toEqual({
			call: "withdraw",
			targetId: phone.id,
			key: "run-1:step-1",
		});
		expect(n.ports.inApp.of("ada").at(-1)).toEqual({
			call: "withdraw",
			key: "run-1:step-1",
		});
	});

	test("refused, the Gate waits again without a new push, and its real close still tells the screens", async () => {
		const n = setup();
		const web = n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");
		await setPending(n, "run-1", "step-1", true);
		const before = n.ports.inApp.of("ada").length;

		await setPending(n, "run-1", "step-1", false);
		expect(n.ports.pushes.web.sent()).toHaveLength(1);
		expect(n.ports.pushes.web.withdrawn()).toEqual([`${web.id}:run-1:step-1`]);
		expect(n.ports.inApp.of("ada")).toHaveLength(before);

		await n.answerGate("run-1", "step-1");
		expect(n.ports.inApp.of("ada").slice(before)).toEqual([
			{ call: "withdraw", key: "run-1:step-1" },
		]);
	});

	test("applied, the Gate goes without a second withdraw", async () => {
		const n = setup();
		const web = n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");
		await setPending(n, "run-1", "step-1", true);
		const before = n.ports.inApp.of("ada").length;

		await n.answerGate("run-1", "step-1");
		await n.runChanged({ spaceId: SPACE, runId: "run-1" });

		expect(n.ports.pushes.web.withdrawn()).toEqual([`${web.id}:run-1:step-1`]);
		// The run changed, but its Gate closed already.
		expect(n.ports.inApp.of("ada").slice(before)).toEqual([
			{ call: "run-changed", spaceId: SPACE, runId: "run-1" },
		]);
	});

	test("a run without a known Gate reads nothing again and closes nothing", async () => {
		const n = setup();
		n.ports.targets.add("ada", "web");

		await n.runChanged({ spaceId: SPACE, runId: "run-1" });

		expect(n.ports.inApp.of("ada")).toEqual([]);
		expect(n.ports.pushes.web.calls).toEqual([]);
	});
});
