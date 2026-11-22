import { describe, expect, test } from "bun:test";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { listWaitingLearnings } from "./list-waiting-learnings";

/** The use case listWaitingLearnings, on in-memory adapters. Twins of "waiting and count" in `learnings.test.ts`. */

const encode = (text: string) => new TextEncoder().encode(text);

/** A project p1 in Space s1, with these files listed: each one's text, where it is, and when it changed. */
function setup(
	files: Record<string, { text: string; at: number; only?: "host" }>,
) {
	const ports = inMemoryLearningsPorts();
	ports.status.spaces.set("p1", "s1");
	for (const [path, { text, at, only }] of Object.entries(files)) {
		ports.documents.list("p1", path, { sha256: `h-${path}`, changedAt: at });
		(only === "host" ? ports.archive.host : ports.archive.local).set(
			`h-${path}`,
			encode(text),
		);
	}
	return ports;
}

describe("listWaitingLearnings", () => {
	test("a file with any other name does not wait, and the newest come first", async () => {
		const ports = setup({
			"learnings/proposed/run-1.s1.md": { text: "- One.\n", at: 1 },
			"learnings/proposed/run-2.s1.md": { text: "- Two.\n", at: 2 },
			"learnings/proposed/notes.txt": { text: "- No.\n", at: 3 },
			"learnings/accepted/run-0.md": { text: "- Kept.\n", at: 4 },
		});
		const list = await listWaitingLearnings(ports)({
			projectId: "p1",
			onlyHere: true,
		});
		expect(list).toEqual([
			{
				id: "run-2.s1.md",
				runId: "run-2",
				stepId: "s1",
				notes: ["Two."],
				proposedAt: 2,
			},
			{
				id: "run-1.s1.md",
				runId: "run-1",
				stepId: "s1",
				notes: ["One."],
				proposedAt: 1,
			},
		]);
	});

	test("asks a Host that fails only once in one read", async () => {
		const ports = setup({
			"learnings/proposed/run-1.s1.md": {
				text: "- One.\n",
				at: 1,
				only: "host",
			},
			"learnings/proposed/run-2.s1.md": {
				text: "- Two.\n",
				at: 2,
				only: "host",
			},
		});
		const failure = new Error("The Host is offline.");
		ports.archive.hostFails(failure);
		const list = await listWaitingLearnings(ports)({ projectId: "p1" });
		expect(list.map((learning) => learning.notes)).toEqual([[], []]);
		expect(ports.archive.askedHost).toHaveLength(1);
		expect(ports.status.heardFrom).toEqual([{ spaceId: "s1", error: failure }]);
	});

	test("only here: the Host is not asked, what is not here has no notes, and nothing is compared", async () => {
		const ports = setup({
			"learnings/proposed/run-1.s1.md": {
				text: "- One.\n",
				at: 1,
				only: "host",
			},
		});
		const list = await listWaitingLearnings(ports)({
			projectId: "p1",
			onlyHere: true,
		});
		expect(list.map((learning) => learning.notes)).toEqual([[]]);
		expect(ports.archive.askedHost).toEqual([]);
		expect(ports.closeNotes.compared).toEqual([]);
	});

	test("puts the close notes on each note, compared with the kept ones, and tells the screens when the vectors are ready", async () => {
		const ports = setup({
			"learnings/proposed/run-1.s1.md": { text: "- One.\n- Two.\n", at: 1 },
			"learnings/accepted/run-0.md": { text: "- Kept.\n", at: 0 },
		});
		const near = { id: "run-0.md", note: "Kept.", kept: true, similarity: 0.9 };
		ports.closeNotes.answer = [[], [near]];
		const [learning] = await listWaitingLearnings(ports)({ projectId: "p1" });
		expect(learning?.nearTo).toEqual([[], [near]]);
		expect(ports.closeNotes.compared).toEqual([
			[
				{ id: "run-1.s1.md", text: "One.", kept: false },
				{ id: "run-1.s1.md", text: "Two.", kept: false },
				{ id: "run-0.md", text: "Kept.", kept: true },
			],
		]);
		ports.closeNotes.prepared?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(ports.notifications.told).toEqual([["s1", "p1"]]);
	});

	test("a project this computer does not have has nothing waiting", async () => {
		const ports = inMemoryLearningsPorts();
		expect(await listWaitingLearnings(ports)({ projectId: "p9" })).toEqual([]);
	});
});
