import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import {
	knowledgeDevice as device,
	memoryHost,
	removeKnowledgeDevices,
	syncKnowledgeDocuments as syncDocuments,
} from "../testing/knowledge-devices";

/** The Learnings module, over a Device's folder, document and archive. */

afterEach(removeKnowledgeDevices);

describe("propose", () => {
	test("writes Night Shift's header once, then adds what the step reports later", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const step = { runId: "run-0123456789", stepId: "s1" };
		await a.learnings.propose("p1", step, ["  Use\n bun. ", ""]);
		await a.learnings.propose("p1", step, ["Tests are slow."]);
		expect(await a.read("learnings/proposed/run-0123456789.s1.md")).toBe(
			"# Learnings of run run-0123\n\nWhat the agents of run run-0123456789 proposed to learn about this project.\n\n- Use bun.\n- Tests are slow.\n",
		);
	});

	test("writes nothing without a note, and refuses a step that could leave the folder", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.learnings.propose("p1", { runId: "run-1" }, [" ", "\n"]);
		expect(await a.has("learnings")).toBe(false);
		await expect(
			a.learnings.propose("p1", { runId: "../x" }, ["Out."]),
		).rejects.toThrow('"../x" is not an id.');
	});
});

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
		await a.sync.reconcile("p1");

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
		await a.sync.reconcile("p1");
		expect((await a.learnings.waiting("p1"))[0]?.notes).toEqual(["One."]);
		expect(await a.learnings.count("p1")).toBe(1);
	});

	test("a file whose content is not here has no notes yet, and counts as one", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("learnings/proposed/run-1.md", "- One.\n- Two.\n");
		await a.sync.reconcile("p1");
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
		await a.sync.reconcile("p1");
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
		await a.sync.reconcile("p1");
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
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		state.down = true;
		await expect(b.learnings.settle("p1", "run-1.md", "keep")).rejects.toThrow(
			"Night Shift cannot get this learning now.",
		);
		state.down = false;
		await b.learnings.settle("p1", "run-1.md", "keep");
		expect(await b.read("learnings/accepted/run-1.md")).toBe("- One.\n");
		expect(await b.has("learnings/proposed/run-1.md")).toBe(false);
	});
});

describe("who hears", () => {
	test("content that cannot be fetched yet is told once, not at each reconcile", async () => {
		const { host, state } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await b.sync.reconcile("p1");
		await a.put("learnings/proposed/run-1.md", "- One.\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		state.down = true;
		await b.sync.reconcile("p1");
		await b.sync.reconcile("p1");
		const heard: [string, string] = [b.sandbox.spaceId, "p1"];
		expect(b.told).toEqual([heard]);
		state.down = false;
		await b.sync.reconcile("p1");
		expect(b.told).toEqual([heard]);
		expect(await b.read("learnings/proposed/run-1.md")).toBe("- One.\n");
	});

	test("after a start, what the folder held at the last reconcile says what changed", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const proposal = "learnings/proposed/run-1.md";
		const change = (held: string[], listed: string[]) => ({
			projectId: "p2",
			spaceId: a.sandbox.spaceId,
			held: Object.fromEntries(held.map((path) => [path, { sha256: "x" }])),
			listed: new Map(listed.map((path) => [path, { sha256: "x" }])),
		});
		// The module is new for p2, as it is for every project after a start.
		await a.learnings.reconciled(change([proposal], [proposal]));
		expect(a.told).toEqual([]);
		await a.learnings.reconciled(change([proposal], []));
		expect(a.told).toEqual([[a.sandbox.spaceId, "p2"]]);
	});
});
