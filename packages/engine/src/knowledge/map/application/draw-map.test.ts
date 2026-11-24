import { describe, expect, spyOn, test } from "bun:test";
import { inMemoryMapPorts } from "../adapters/out/in-memory-neighbours";
import { drawMap } from "./draw-map";

/** The use case drawMap, on in-memory adapters. */

describe("drawMap", () => {
	test("the files the Space lists and the index holds, the questions and the learnings that name a topic", async () => {
		const ports = inMemoryMapPorts();
		const { publish } = ports.sync;
		await publish("p1", "a.md", "Deploys at night. Deploys again.");
		await publish("p1", "INDEX.md", "The index.");
		await publish(
			"p1",
			"learnings/proposed/run-1.md",
			"- Deploy.\n",
			1,
			"host",
		);
		ports.index.put("p1", "a.md", "Deploys at night. Deploys again.");
		ports.index.put("p1", "b.md", "Deploys need care.");
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
		expect(ports.sync.archive.calls).toEqual([]);
	});

	test("draws again only when what it was drawn from changes, a marked word too", async () => {
		const ports = inMemoryMapPorts();
		const reads = spyOn(ports.index, "forMap");
		const draw = drawMap(ports);
		await draw({ projectId: "p1" });
		await draw({ projectId: "p1" });
		expect(reads).toHaveBeenCalledTimes(1);
		ports.notTopics.files.set(
			"p1",
			JSON.stringify({
				version: 1,
				words: [{ word: "deploys", markedAt: 1, by: null }],
			}),
		);
		const map = await draw({ projectId: "p1" });
		expect(reads).toHaveBeenCalledTimes(2);
		expect(map.notTopics).toEqual(["deploys"]);
		ports.index.put("p1", "new.md", "A new file.");
		await draw({ projectId: "p1" });
		expect(reads).toHaveBeenCalledTimes(3);
	});
});
