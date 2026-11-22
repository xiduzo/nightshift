import { describe, expect, test } from "bun:test";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { countWaitingNotes } from "./count-waiting-notes";

/** The use case countWaitingNotes, on in-memory adapters. Twins of "waiting and count" in `learnings.test.ts`. */

describe("countWaitingNotes", () => {
	test("counts the notes the page shows, and a file whose content is not here counts as one", async () => {
		const ports = inMemoryLearningsPorts();
		ports.status.spaces.set("p1", "s1");
		ports.documents.list("p1", "learnings/proposed/run-1.s1.md", {
			sha256: "a",
			changedAt: 1,
		});
		ports.archive.local.set(
			"a",
			new TextEncoder().encode("- One.\n-\n- Two.\n"),
		);
		ports.documents.list("p1", "learnings/proposed/run-2.s1.md", {
			sha256: "b",
			changedAt: 2,
		});
		ports.archive.host.set("b", new TextEncoder().encode("- Three.\n"));
		expect(await countWaitingNotes(ports)({ projectId: "p1" })).toBe(3);
		// The count asks no Host.
		expect(ports.archive.askedHost).toEqual([]);
	});
});
