import { describe, expect, test } from "bun:test";
import { inMemoryMapPorts } from "../adapters/out/in-memory-neighbours";
import { drawMap } from "./draw-map";

/** The use case drawMap, on in-memory adapters. */

describe("drawMap", () => {
	test("the files the Space lists and the index holds, the questions and the learnings that name a topic", async () => {
		const ports = inMemoryMapPorts();
		ports.entries.listed.set("p1", [
			"a.md",
			"INDEX.md",
			"learnings/proposed/x.md",
		]);
		ports.index.held = {
			...ports.index.held,
			files: ["b.md"],
			read: [
				{ path: "a.md", sections: ["Deploys at night. Deploys again."] },
				{ path: "b.md", sections: ["Deploys need care."] },
			],
		};
		ports.asked.askedIn.set("p1", [
			{ query: "how to deploy", hits: [{ path: "a.md" }] },
		]);
		const map = await drawMap(ports)({ projectId: "p1" });
		expect(
			map.nodes.filter((node) => node.kind === "file").map((n) => n.path),
		).toEqual(["a.md", "b.md"]);
		expect(map.edges).toContainEqual({
			id: "question:how to deploy->file:a.md",
			source: "question:how to deploy",
			target: "file:a.md",
			kind: "found",
		});
		// Only the learnings that wait on this computer: drawing never asks the Host.
		expect(ports.learnings.asked).toEqual([
			{ projectId: "p1", onlyHere: true },
		]);
	});

	test("draws again only when what it was drawn from changes, a marked word too", async () => {
		const ports = inMemoryMapPorts();
		const draw = drawMap(ports);
		await draw({ projectId: "p1" });
		await draw({ projectId: "p1" });
		expect(ports.index.reads).toBe(1);
		ports.notTopics.files.set(
			"p1",
			JSON.stringify({
				version: 1,
				words: [{ word: "deploys", markedAt: 1, by: null }],
			}),
		);
		const map = await draw({ projectId: "p1" });
		expect(ports.index.reads).toBe(2);
		expect(map.notTopics).toEqual(["deploys"]);
		ports.index.stamp = "stamp-2";
		await draw({ projectId: "p1" });
		expect(ports.index.reads).toBe(3);
	});
});
