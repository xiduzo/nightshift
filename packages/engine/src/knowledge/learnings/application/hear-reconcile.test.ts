import { describe, expect, test } from "bun:test";
import { inMemoryLearningsNotifications } from "../adapters/out/in-memory-neighbours";
import { hearReconcile } from "./hear-reconcile";

/** The use case hearReconcile, on in-memory adapters. Twins of "who hears" in `learnings.test.ts`. */

const WAITING = "learnings/proposed/run-1.s1.md";

function setup() {
	const notifications = inMemoryLearningsNotifications();
	const hear = hearReconcile({ notifications, known: new Map() });
	const reconciled = (
		held: Record<string, { sha256: string }>,
		listed: Record<string, { sha256: string }>,
	) =>
		hear({
			projectId: "p1",
			spaceId: "s1",
			held,
			listed: new Map(Object.entries(listed)),
		});
	return { notifications, reconciled };
}

describe("hearReconcile", () => {
	test("tells the screens once when what waits changed, not at each reconcile", async () => {
		const { notifications, reconciled } = setup();
		await reconciled({}, { [WAITING]: { sha256: "a" } });
		await reconciled({}, { [WAITING]: { sha256: "a" } });
		expect(notifications.told).toEqual([["s1", "p1"]]);
		await reconciled({}, {});
		expect(notifications.told).toEqual([
			["s1", "p1"],
			["s1", "p1"],
		]);
	});

	test("after a start, what the folder held at the last reconcile says what changed", async () => {
		const { notifications, reconciled } = setup();
		await reconciled(
			{ [WAITING]: { sha256: "a" } },
			{ [WAITING]: { sha256: "a" } },
		);
		expect(notifications.told).toEqual([]);
	});

	test("a file of another name changes nothing, and a failed telling is only logged", async () => {
		const { notifications, reconciled } = setup();
		await reconciled({}, { "learnings/accepted/run-1.s1.md": { sha256: "a" } });
		expect(notifications.told).toEqual([]);
		notifications.fail(new Error("No screen."));
		await reconciled({}, { [WAITING]: { sha256: "b" } });
		expect(notifications.told).toEqual([["s1", "p1"]]);
	});
});
