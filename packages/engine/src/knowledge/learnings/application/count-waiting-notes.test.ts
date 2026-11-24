import { describe, expect, test } from "bun:test";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { countWaitingNotes } from "./count-waiting-notes";

/** The use case countWaitingNotes, on in-memory adapters. Twins of "waiting and count" in `learnings.test.ts`. */

describe("countWaitingNotes", () => {
	test("counts the notes the page shows, and a file whose content is not here counts as one", async () => {
		const ports = inMemoryLearningsPorts();
		const { publish } = ports.sync;
		await publish(
			"p1",
			"learnings/proposed/run-1.s1.md",
			"- One.\n-\n- Two.\n",
		);
		const host = ["- Three.\n- Four.\n", 2, "host"] as const;
		await publish("p1", "learnings/proposed/run-2.s1.md", ...host);
		expect(await countWaitingNotes(ports)({ projectId: "p1" })).toBe(3);
		// The count asks no Host.
		expect(ports.archive.calls).toEqual([]);
	});
});
