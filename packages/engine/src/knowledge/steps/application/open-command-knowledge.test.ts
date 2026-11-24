import { describe, expect, spyOn, test } from "bun:test";
import { inMemoryStepsPorts } from "../adapters/out/in-memory-neighbours";
import { openCommandKnowledge } from "./open-command-knowledge";

/** The use case openCommandKnowledge, on in-memory adapters. */

describe("openCommandKnowledge", () => {
	test("holds the folder, makes it, and gives it with the page reader; done closes the reader, then ends the hold", async () => {
		const ports = inMemoryStepsPorts();
		const knowledge = await openCommandKnowledge(ports)({ projectId: "p1" });
		expect(knowledge.env).toEqual({
			NS_KNOWLEDGE: "/knowledge/p1",
			NS_READER_URL: "http://reader/p1",
		});
		await knowledge.done();
		expect(ports.events).toEqual([
			"hold p1",
			"ensure p1",
			"reader p1",
			"close reader p1",
			"done p1",
		]);
	});

	test("a folder that cannot be made is left out, and so is the reader", async () => {
		const ports = inMemoryStepsPorts();
		ports.folders.ensure = async () => {
			throw new Error("no folder");
		};
		const knowledge = await openCommandKnowledge(ports)({ projectId: "p1" });
		expect(knowledge.env).toEqual({});
		await knowledge.done();
		expect(ports.events).toEqual(["hold p1", "done p1"]);
	});

	test("a page reader that cannot open leaves the step with the folder alone", async () => {
		const ports = inMemoryStepsPorts();
		ports.readers.failOpen = new Error("no port");
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const knowledge = await openCommandKnowledge(ports)({ projectId: "p1" });
			expect(knowledge.env).toEqual({ NS_KNOWLEDGE: "/knowledge/p1" });
			await knowledge.done();
		} finally {
			warn.mockRestore();
		}
		expect(ports.events).toEqual([
			"hold p1",
			"ensure p1",
			"reader p1",
			"done p1",
		]);
	});

	test("without page readers, the folder alone", async () => {
		const { readers: _none, ...ports } = inMemoryStepsPorts();
		const knowledge = await openCommandKnowledge(ports)({ projectId: "p1" });
		expect(knowledge.env).toEqual({ NS_KNOWLEDGE: "/knowledge/p1" });
	});
});
