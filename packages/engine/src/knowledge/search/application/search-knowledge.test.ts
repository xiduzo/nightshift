import { describe, expect, spyOn, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import { createVectorStates } from "../domain/vector-states";
import { searchKnowledge } from "./search-knowledge";

/** The use case searchKnowledge, on in-memory adapters. */

function searchPorts(on = true) {
	const ports = inMemorySearchPorts();
	const refreshed: string[] = [];
	const queries = { failed: false };
	return {
		...ports,
		refreshed,
		queries,
		search: searchKnowledge({
			index: ports.index,
			meaning: ports.meaning,
			meaningOn: async () => on,
			refresh: async ({ projectId }) => {
				refreshed.push(projectId);
				return { files: 0, indexed: 0, removed: 0 };
			},
			states: createVectorStates(),
			queries,
		}),
	};
}

const hit = (path: string, similarity: number) =>
	[
		{ pageContent: path, metadata: { path, section_id: `${path}#0` } },
		similarity,
	] as [{ pageContent: string; metadata: Record<string, unknown> }, number];

describe("searchKnowledge", () => {
	test("finds by words after a refresh, each file once at its best section", async () => {
		const t = searchPorts();
		t.index.seed("p1", {
			path: "a.md",
			title: "Cars",
			texts: ["A car.", "A fast car."],
		});
		t.index.seed("p1", { path: "b.md", title: "Pets", texts: ["A kitten."] });
		const hits = await t.search({ projectId: "p1", text: "car" });
		expect(t.refreshed).toEqual(["p1"]);
		expect(hits).toEqual([
			{
				path: "a.md",
				title: "Cars",
				section: null,
				line: 1,
				page: null,
				snippet: [{ text: "A car.", match: false }],
				score: 1 / 61,
				found: ["words"],
			},
		]);
		expect(t.index.matches).toEqual(['"car"*']);
	});

	test("finds nothing for a query with no word, and does not refresh", async () => {
		const t = searchPorts();
		expect(await t.search({ projectId: "p1", text: " ?! " })).toEqual([]);
		expect(t.refreshed).toEqual([]);
	});

	test("takes sections with some of the words when none has them all", async () => {
		const t = searchPorts();
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		const hits = await t.search({ projectId: "p1", text: "car kitten" });
		expect(hits.map((h) => h.path)).toEqual(["a.md"]);
		expect(t.index.matches).toEqual(['"car" "kitten"*', '"car" OR "kitten"*']);
	});

	test("fuses the meaning: a file only the meaning found must reach the model's floor", async () => {
		const t = searchPorts();
		t.meaning.set(fakeMeaning({ floor: 0.5 }));
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		t.index.seed("p1", {
			path: "b.md",
			title: "Vehicles",
			texts: ["An automobile."],
		});
		t.index.seed("p1", { path: "c.md", title: "Pets", texts: ["A kitten."] });
		t.index.setNearest("p1", [
			hit("b.md", 0.9),
			hit("a.md", 0.6),
			hit("c.md", 0.2),
		]);
		const hits = await t.search({ projectId: "p1", text: "car" });
		expect(hits.map((h) => [h.path, h.found])).toEqual([
			["a.md", ["words", "meaning"]],
			["b.md", ["meaning"]],
		]);
		expect(hits[1]?.snippet).toEqual([
			{ text: "An automobile.", match: false },
		]);
	});

	test("finds by words only when the setting is off, or the mode says so", async () => {
		const t = searchPorts(false);
		t.meaning.set(fakeMeaning());
		t.index.seed("p1", {
			path: "b.md",
			title: "Vehicles",
			texts: ["An automobile."],
		});
		t.index.setNearest("p1", [hit("b.md", 0.9)]);
		expect(await t.search({ projectId: "p1", text: "car" })).toEqual([]);
		const on = searchPorts(true);
		on.meaning.set(fakeMeaning());
		on.index.seed("p1", {
			path: "b.md",
			title: "Vehicles",
			texts: ["An automobile."],
		});
		on.index.setNearest("p1", [hit("b.md", 0.9)]);
		expect(
			await on.search({ projectId: "p1", text: "car", mode: "words" }),
		).toEqual([]);
		expect(
			(await on.search({ projectId: "p1", text: "car", mode: "meaning" })).map(
				(h) => h.path,
			),
		).toEqual(["b.md"]);
	});

	test("finds by words when the query's vector does not come, and says so once", async () => {
		const t = searchPorts();
		t.meaning.set(
			fakeMeaning({
				embeddings: {
					embedDocuments: async () => [],
					embedQuery: async () => {
						throw new Error("Ollama stopped.");
					},
				},
			}),
		);
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		t.index.setNearest("p1", [hit("a.md", 0.9)]);
		const warned = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const hits = await t.search({ projectId: "p1", text: "car" });
			expect(hits.map((h) => h.found)).toEqual([["words"]]);
			await t.search({ projectId: "p1", text: "car" });
			expect(warned).toHaveBeenCalledTimes(1);
			expect(t.queries.failed).toBe(true);
		} finally {
			warned.mockRestore();
		}
	});

	test("with folders, gives only the files in them", async () => {
		const t = searchPorts();
		t.index.seed("p1", { path: "a/one.md", title: "One", texts: ["A car."] });
		t.index.seed("p1", { path: "b/two.md", title: "Two", texts: ["A car."] });
		const hits = await t.search({
			projectId: "p1",
			text: "car",
			folders: ["b"],
		});
		expect(hits.map((h) => h.path)).toEqual(["b/two.md"]);
	});
});
