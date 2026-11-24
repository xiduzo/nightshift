import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import { iso, now } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import {
	knowledgeDevice as device,
	memoryHost,
	removeKnowledgeDevices,
	syncKnowledgeDocuments as syncDocuments,
} from "../../testing/knowledge-devices";

/** The Learnings module, over a Device's folder, document and archive. */

afterEach(removeKnowledgeDevices);

describe("keepReported", () => {
	test("keeps the events as they are, and the learnings of each report", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const events: AgentEvent[] = [
			{ type: "report", outcome: "pass", summary: "", learnings: ["One."] },
			{ type: "report", outcome: "pass", summary: "" },
			{ type: "report", outcome: "pass", summary: "", learnings: ["Two."] },
		];
		async function* session() {
			yield* events;
		}
		const seen: AgentEvent[] = [];
		for await (const event of a.learnings.keepReported(session(), "p1", {
			runId: "run-1",
			stepId: "s1",
		})) {
			seen.push(event);
		}
		expect(seen).toEqual(events);
		const kept = await readFile(
			join(a.dir, "learnings/proposed/run-1.s1.md"),
			"utf8",
		);
		expect(kept.endsWith("- One.\n- Two.\n")).toBe(true);
	});
});

describe("waiting and count", () => {
	test("agree on what waits: a file with any other name is neither", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("learnings/proposed/run-1.s1.md", "- One.\n- Two.\n");
		await a.put("learnings/proposed/my notes.md", "- Spaces.\n");
		await a.put("learnings/proposed/a.b.c.md", "- Three parts.\n");
		await a.put("learnings/proposed/deep/run-2.md", "- Deep.\n");
		await a.put("learnings/proposed/run-3.txt", "- Not markdown.\n");
		await a.reconciler.reconcile("p1");

		const waiting = await a.learnings.waiting("p1");
		expect(waiting.map(({ id, notes }) => [id, notes])).toEqual([
			["run-1.s1.md", ["One.", "Two."]],
		]);
		expect(await a.learnings.count("p1")).toBe(2);
		expect((await a.reader.listing("p1")).proposed).toBe(2);
	});

	test("count the notes the page shows: a line with only the mark is none", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put(
			"learnings/proposed/run-1.md",
			"# Learnings of run run-1\n\n- \n- One.\n-  \nProse.\n",
		);
		await a.reconciler.reconcile("p1");
		expect((await a.learnings.waiting("p1"))[0]?.notes).toEqual(["One."]);
		expect(await a.learnings.count("p1")).toBe(1);
	});

	test("the count asks no Host: a Host that never answers cannot hold the page", async () => {
		const { host, kept } = memoryHost();
		const a = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n- Two.\n");
		await a.reconciler.reconcile("p1");
		let asked = 0;
		const { promise: answer, resolve } = Promise.withResolvers<null>();
		const stalled = await device({
			archivePut: host.archivePut,
			archiveGet: () => {
				asked++;
				return answer;
			},
		});
		await syncDocuments(a, stalled);
		expect(kept.size).toBe(1);

		expect(await stalled.learnings.count("p1")).toBe(1);
		expect(asked).toBe(0);
		resolve(null);
	});

	test("the page's list comes in time while a Host never answers", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.reconciler.reconcile("p1");
		const { promise: answer, resolve } = Promise.withResolvers<null>();
		const stalled = await device(
			{ archivePut: host.archivePut, archiveGet: () => answer },
			{ pageWaitMs: 20 },
		);
		await syncDocuments(a, stalled);

		const listing = await stalled.reader.listing("p1");
		expect(listing.proposed).toBe(1);
		resolve(null);
	});

	test("what waits asks a Host that fails only once in one read", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.put("learnings/proposed/run-2.md", "- Two.\n");
		await a.put("learnings/proposed/run-3.md", "- Three.\n");
		await a.reconciler.reconcile("p1");
		let asked = 0;
		const b = await device({
			archivePut: host.archivePut,
			archiveGet: (ref) => {
				asked++;
				return host.archiveGet(ref);
			},
		});
		await syncDocuments(a, b);

		state.down = true;
		const waiting = await b.learnings.waiting("p1");
		expect(waiting.map(({ notes }) => notes)).toEqual([[], [], []]);
		expect(asked).toBe(1);
		state.down = false;
		const back = await b.learnings.waiting("p1");
		expect(back.map(({ notes }) => notes.length)).toEqual([1, 1, 1]);
	});

	test("a file whose content is not here has no notes yet, and counts as one", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n- Two.\n");
		await a.reconciler.reconcile("p1");
		await syncDocuments(a, b);

		state.down = true;
		expect((await b.learnings.waiting("p1"))[0]?.notes).toEqual([]);
		expect(await b.learnings.count("p1")).toBe(1);
		state.down = false;
		expect((await b.learnings.waiting("p1"))[0]?.notes).toEqual([
			"One.",
			"Two.",
		]);
		expect(await b.learnings.count("p1")).toBe(2);
	});

	test("only here: the Host is not asked, and what is not here has no notes", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.reconciler.reconcile("p1");
		await syncDocuments(a, b);

		const onlyHere = await b.learnings.waiting("p1", { onlyHere: true });
		expect(onlyHere.map(({ id, notes }) => [id, notes])).toEqual([
			["run-1.md", []],
		]);
		expect(
			(await a.learnings.waiting("p1", { onlyHere: true }))[0]?.notes,
		).toEqual(["One."]);
		expect((await b.learnings.waiting("p1"))[0]?.notes).toEqual(["One."]);
	});

	test("the newest come first", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("learnings/proposed/run-1.md", "- Old.\n", 1_000_000);
		await a.put("learnings/proposed/run-2.md", "- New.\n", 2_000_000);
		await a.reconciler.reconcile("p1");
		expect((await a.learnings.waiting("p1")).map(({ id }) => id)).toEqual([
			"run-2.md",
			"run-1.md",
		]);
	});
});

describe("settle", () => {
	test("waits to be fetched when the Space lists a file this folder does not have", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.reconciler.reconcile("p1");
		await syncDocuments(a, b);

		state.down = true;
		await expect(
			b.learnings.settle(NIGHT_SHIFT, "space-1", "p1", "run-1.md", "keep"),
		).rejects.toThrow("Night Shift cannot get this learning now.");
		state.down = false;
		await b.learnings.settle(NIGHT_SHIFT, "space-1", "p1", "run-1.md", "keep");
		expect(await b.read("learnings/accepted/run-1.md")).toBe("- One.\n");
		expect(await b.has("learnings/proposed/run-1.md")).toBe(false);
	});
});

describe("one note at a time", () => {
	const ada = { id: "ada", name: "Ada Lovelace" };
	const file = "learnings/proposed/run-1.s1.md";
	const proposal =
		"# Learnings of run run-1\n\nWhat the agents of run run-1 proposed to learn about this project.\n\n- One.\n- Two.\n- Three.\n";
	const today = iso(now()).slice(0, 10);

	async function waitingOne() {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put(file, proposal);
		await a.reconciler.reconcile("p1");
		a.told.length = 0;
		return a;
	}

	test("keeps one note with who kept it and when, and leaves the others waiting", async () => {
		const a = await waitingOne();
		await a.learnings.settleNote(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			{ id: "run-1.s1.md", index: 1, note: "Two." },
			"keep",
			ada,
		);
		expect(await a.read("learnings/accepted/run-1.s1.md")).toBe(
			`# Learnings of run run-1\n\nWhat the agents of run run-1 proposed to learn about this project.\n\n- Two.\n  Kept by Ada Lovelace on ${today}.\n`,
		);
		expect((await a.learnings.waiting("p1"))[0]?.notes).toEqual([
			"One.",
			"Three.",
		]);
		expect(await a.learnings.count("p1")).toBe(2);
		// The reconcile at the end put it in the Space, and the screens heard.
		expect(a.told).toEqual([[a.sandbox.spaceId, "p1"]]);
	});

	test("a second kept note adds to the file, and a delete keeps nothing", async () => {
		const a = await waitingOne();
		const at = { id: "run-1.s1.md" };
		await a.learnings.settleNote(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			{ ...at, index: 0 },
			"keep",
			ada,
		);
		await a.learnings.settleNote(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			{ ...at, index: 0 },
			"delete",
			ada,
		);
		await a.learnings.settleNote(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			{ ...at, index: 0 },
			"keep",
			ada,
		);
		const accepted = await a.read("learnings/accepted/run-1.s1.md");
		expect(
			accepted.endsWith(
				`- One.\n  Kept by Ada Lovelace on ${today}.\n- Three.\n  Kept by Ada Lovelace on ${today}.\n`,
			),
		).toBe(true);
		expect(accepted).not.toContain("Two.");
		// No note left: the proposed file goes.
		expect(await a.has(file)).toBe(false);
		expect(await a.learnings.waiting("p1")).toEqual([]);
	});

	test("a told note goes to the person's own file, with who told it and when", async () => {
		const a = await waitingOne();
		await a.learnings.tell(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			"  Deploys wait\n for two people. ",
			ada,
		);
		await a.learnings.tell(
			NIGHT_SHIFT,
			"space-1",
			"p1",
			"The sweep takes 40 minutes.",
			ada,
		);
		expect(await a.read("learnings/accepted/told-ada.md")).toBe(
			`# Learnings people told\n\nWhat a person of this Space told agents about this project.\n\n- Deploys wait for two people.\n  Told by Ada Lovelace on ${today}.\n- The sweep takes 40 minutes.\n  Told by Ada Lovelace on ${today}.\n`,
		);
		expect(await a.learnings.count("p1")).toBe(3);
		expect(await a.learnings.known("p1")).toEqual([
			"One.",
			"Two.",
			"Three.",
			"Deploys wait for two people.",
			"The sweep takes 40 minutes.",
		]);
		await expect(
			a.learnings.tell(NIGHT_SHIFT, "space-1", "p1", " \n", ada),
		).rejects.toThrow("Write the note first.");
	});
});

describe("who hears", () => {
	test("content that cannot be fetched yet is told once, not at each reconcile", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await b.reconciler.reconcile("p1");
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.reconciler.reconcile("p1");
		await syncDocuments(a, b);

		state.down = true;
		await b.reconciler.reconcile("p1");
		await b.reconciler.reconcile("p1");
		const heard: [string, string] = [b.sandbox.spaceId, "p1"];
		expect(b.told).toEqual([heard]);
		state.down = false;
		await b.reconciler.reconcile("p1");
		expect(b.told).toEqual([heard]);
		expect(await b.read("learnings/proposed/run-1.md")).toBe("- One.\n");
	});
});
