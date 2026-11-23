import { describe, expect, spyOn, test } from "bun:test";
import type { AgentEvent } from "@nightshift/agents/types";
import { inMemoryStepsPorts } from "../adapters/out/in-memory-neighbours";
import { openSessionKnowledge } from "./open-session-knowledge";

/** The use case openSessionKnowledge, on in-memory adapters. */

const said = (text: string) =>
	({ type: "text", text }) as unknown as AgentEvent;

async function* stream(...events: AgentEvent[]) {
	yield* events;
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
	const all: T[] = [];
	for await (const event of events) all.push(event);
	return all;
}

describe("openSessionKnowledge", () => {
	test("a request that asks for nothing gets nothing, and holds no folder", async () => {
		const ports = inMemoryStepsPorts();
		const knowledge = await openSessionKnowledge(ports)({ request: {} });
		expect(knowledge.contribution).toEqual({});
		await knowledge.done();
		expect(ports.events).toEqual([]);
	});

	test("an empty folder gives its path alone, unless the node asks for it", async () => {
		const ports = inMemoryStepsPorts();
		const plain = await openSessionKnowledge(ports)({
			request: { knowledge: { projectId: "p1" } },
		});
		expect(plain.contribution).toEqual({ env: { NS_KNOWLEDGE: "/k/p1" } });
		await plain.done();
		expect(ports.events).toEqual(["hold p1", "scan p1", "done p1"]);
		expect(ports.brief.sessions).toEqual([]);

		ports.events.length = 0;
		const always = await openSessionKnowledge(ports)({
			request: { knowledge: { projectId: "p1", always: true } },
		});
		expect(always.contribution).toEqual({
			env: { NS_KNOWLEDGE: "/k/p1" },
			addDirs: ["/k/p1"],
		});
		expect(ports.events).toEqual([
			"hold p1",
			"scan p1",
			"index /k/p1",
			"refresh p1",
		]);
	});

	test("a folder with files: the index after the reconcile, the brief, and the uses before the next event", async () => {
		const ports = inMemoryStepsPorts();
		ports.folders.files.set("p1", ["a.md"]);
		const knowledge = await openSessionKnowledge(ports)({
			request: { knowledge: { projectId: "p1" } },
		});
		const [brief] = ports.brief.sessions;
		expect(brief?.folder).toBe("/k/p1");
		expect(brief?.learnings).toBe(false);
		brief?.onUse("p1", { kind: "search", query: "q", hits: [] });
		expect(await collect(knowledge.events(stream(said("one"))))).toEqual([
			{
				type: "knowledge",
				projectId: "p1",
				use: { kind: "search", query: "q", hits: [] },
			},
			said("one"),
		]);
		await brief?.tools.searchKnowledge("p1", "q", 3);
		await knowledge.done();
		expect(ports.events).toEqual([
			"hold p1",
			"scan p1",
			"index /k/p1",
			"refresh p1",
			"search p1",
			"done p1",
		]);
	});

	test("a step of a run may propose learnings: its events go through them", async () => {
		const ports = inMemoryStepsPorts();
		ports.folders.files.set("p1", ["a.md"]);
		const knowledge = await openSessionKnowledge(ports)({
			request: { knowledge: { projectId: "p1" } },
			step: { runId: "run-1", stepId: "s1" },
		});
		expect(ports.brief.sessions[0]?.learnings).toBe(true);
		expect(await collect(knowledge.events(stream(said("one"))))).toEqual([
			said("one"),
		]);
		expect(ports.events).toContain("keep p1 run-1 s1");
	});

	test("a folder that cannot be read gives its path alone", async () => {
		const ports = inMemoryStepsPorts();
		ports.folders.unread.add("p1");
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const knowledge = await openSessionKnowledge(ports)({
				request: { knowledge: { projectId: "p1", always: true } },
			});
			expect(knowledge.contribution).toEqual({
				env: { NS_KNOWLEDGE: "/k/p1" },
			});
			await knowledge.done();
		} finally {
			warn.mockRestore();
		}
		expect(ports.events).toEqual(["hold p1", "scan p1", "done p1"]);
	});

	test("some folders only: a view of them, the tools find nothing else, and done removes the view first", async () => {
		const ports = inMemoryStepsPorts();
		const knowledge = await openSessionKnowledge(ports)({
			request: { knowledgeOnly: { projectId: "p1", folders: ["books"] } },
		});
		const [brief] = ports.brief.sessions;
		expect(brief?.folder).toBe("/k/p1.view");
		expect(
			await brief?.tools.readKnowledge("p1", "ops/a.md", 100, undefined),
		).toBeNull();
		await brief?.tools.readKnowledge("p1", "books/a.md", 100, undefined);
		await knowledge.done();
		expect(ports.events).toEqual([
			"hold p1",
			"scan p1",
			"view /k/p1 books",
			"refresh p1",
			"read p1 books/a.md",
			"remove /k/p1.view",
			"done p1",
		]);
	});

	test("a view that cannot be made gives nothing, never the whole folder", async () => {
		const ports = inMemoryStepsPorts();
		ports.files.failView = new Error("disk");
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const knowledge = await openSessionKnowledge(ports)({
				request: { knowledgeOnly: { projectId: "p1", folders: ["books"] } },
			});
			expect(knowledge.contribution).toEqual({});
			await knowledge.done();
		} finally {
			warn.mockRestore();
		}
		expect(ports.brief.sessions).toEqual([]);
		expect(ports.events).toEqual([
			"hold p1",
			"scan p1",
			"view /k/p1 books",
			"done p1",
		]);
	});
});
