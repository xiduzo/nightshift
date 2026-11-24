import { describe, expect, test } from "bun:test";
import { OlderHostError } from "../../../contract";
import { fakeMeaning } from "../../search/adapters/out/in-memory-neighbours";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { listWaitingLearnings } from "./list-waiting-learnings";

/** The use case listWaitingLearnings, on in-memory adapters. Twins of "waiting and count" in `learnings.test.ts`. */

/** A model that compares notes: "One." is like no other. It keeps what it embeds in `compared`. */
const comparing = (compared: string[]) =>
	fakeMeaning({
		closeNotesAt: 0.9,
		embeddings: {
			async embedDocuments(texts) {
				compared.push(...texts);
				return texts.map((text) => (text === "One." ? [0, 1] : [1, 0]));
			},
			embedQuery: async () => [1, 0],
		},
	});

/** A project p1 in Space s1, with these files listed: each one's text, where it is, and when it changed. */
async function setup(
	files: Record<string, { text: string; at: number; only?: "host" }>,
) {
	const ports = inMemoryLearningsPorts();
	for (const [path, { text, at, only }] of Object.entries(files)) {
		await ports.sync.publish("p1", path, text, at, only ?? "here");
	}
	return ports;
}

describe("listWaitingLearnings", () => {
	test("a file with any other name does not wait, and the newest come first", async () => {
		const ports = await setup({
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
		const ports = await setup({
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
		ports.archive.down = true;
		ports.archive.failWith = new OlderHostError();
		const list = await listWaitingLearnings(ports)({ projectId: "p1" });
		expect(list.map((learning) => learning.notes)).toEqual([[], []]);
		expect(ports.archive.calls).toHaveLength(1);
		expect(ports.status.isOlder("s1")).toBe(true);
	});

	test("only here: the Host is not asked, what is not here has no notes, and nothing is compared", async () => {
		const ports = await setup({
			"learnings/proposed/run-1.s1.md": {
				text: "- One.\n",
				at: 1,
				only: "host",
			},
			"learnings/proposed/run-2.s1.md": { text: "- Two.\n", at: 2 },
		});
		const compared: string[] = [];
		ports.search.meaning.set(comparing(compared));
		const list = await listWaitingLearnings(ports)({
			projectId: "p1",
			onlyHere: true,
		});
		expect(list.map((learning) => learning.notes)).toEqual([["Two."], []]);
		expect(ports.archive.calls).toEqual([]);
		for (let turn = 0; turn < 20; turn++) await Promise.resolve();
		expect(compared).toEqual([]);
	});

	test("puts the close notes on each note, compared with the kept ones, and tells the screens when the vectors are ready", async () => {
		const ports = await setup({
			"learnings/proposed/run-1.s1.md": { text: "- One.\n- Two.\n", at: 1 },
			"learnings/accepted/run-0.md": { text: "- Kept.\n", at: 0 },
		});
		const compared: string[] = [];
		ports.search.meaning.set(comparing(compared));
		const read = () => listWaitingLearnings(ports)({ projectId: "p1" });
		// No note has a vector yet: none is close, and the screens hear when they have.
		expect((await read())[0]?.nearTo).toBeUndefined();
		while (ports.notifications.told.length === 0) await Promise.resolve();
		expect(compared).toEqual(["One.", "Two.", "Kept."]);
		expect(ports.notifications.told).toEqual([["s1", "p1"]]);
		expect((await read())[0]?.nearTo).toEqual([
			[],
			[{ id: "run-0.md", note: "Kept.", kept: true, similarity: 1 }],
		]);
	});

	test("a project this computer does not have has nothing waiting", async () => {
		const ports = inMemoryLearningsPorts();
		expect(await listWaitingLearnings(ports)({ projectId: "p9" })).toEqual([]);
	});
});
