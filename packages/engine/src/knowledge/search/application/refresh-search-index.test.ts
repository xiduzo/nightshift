import { describe, expect, spyOn, test } from "bun:test";
import { inMemorySearchPorts } from "../adapters/out/in-memory-neighbours";
import { refreshSearchIndex } from "./refresh-search-index";

/** The use case refreshSearchIndex, on in-memory adapters. */

function refreshPorts() {
	const ports = inMemorySearchPorts();
	const changed: [string, number][] = [];
	const prepared: string[] = [];
	const dir = ports.folders.folder("p1");
	const scan = spyOn(ports.folders, "scan");
	return {
		...ports,
		scan,
		dir,
		changed,
		prepared,
		refresh: refreshSearchIndex({
			folders: ports.folders,
			texts: ports.fileTexts,
			splitter: ports.sectionSplitter,
			index: ports.index,
			refreshing: new Map(),
			states: {
				sectionsChanged: (projectId, at) => {
					changed.push([projectId, at]);
				},
			},
			prepare: ({ projectId }) => {
				prepared.push(projectId);
			},
			clock: () => 42,
		}),
	};
}

describe("refreshSearchIndex", () => {
	test("indexes a new file with its title and sections, then queues its vectors", async () => {
		const t = refreshPorts();
		t.folders.put("p1", "a.md", "A car.", 1);
		t.fileTexts.put(t.dir, "a.md", "# Cars\n\nA car.");
		expect(await t.refresh({ projectId: "p1" })).toEqual({
			files: 1,
			indexed: 1,
			removed: 0,
		});
		expect(t.index.fileAt("p1", "a.md")?.title).toBe("Cars");
		expect(t.index.sectionsToEmbed("p1")).toEqual([
			expect.objectContaining({ path: "a.md", text: "# Cars\n\nA car." }),
		]);
		expect(t.changed).toEqual([["p1", 42]]);
		expect(t.prepared).toEqual(["p1"]);
	});

	test("reads again only what changed, keeps a file whose hash is the same, and drops what went", async () => {
		const t = refreshPorts();
		t.folders.put("p1", "a.md", "A car.", 1);
		t.folders.put("p1", "b.md", "A kitten.", 1);
		t.fileTexts.put(t.dir, "a.md", "A car.");
		t.fileTexts.put(t.dir, "b.md", "A kitten.");
		await t.refresh({ projectId: "p1" });
		expect(await t.refresh({ projectId: "p1" })).toMatchObject({ indexed: 0 });

		t.folders.put("p1", "a.md", "A car.", 2);
		t.folders.take("p1", "b.md");
		t.sectionSplitter.paths.length = 0;
		expect(await t.refresh({ projectId: "p1" })).toEqual({
			files: 1,
			indexed: 1,
			removed: 1,
		});
		// The same hash: not split again.
		expect(t.sectionSplitter.paths).toEqual([]);
		expect([...t.index.files("p1").keys()]).toEqual(["a.md"]);
	});

	test("reads a document by its pages, and leaves out a file it does not index", async () => {
		const t = refreshPorts();
		t.folders.put("p1", "a.pdf", "A pdf.", 1);
		t.folders.put("p1", "b.png", "A png.", 1);
		t.fileTexts.putPages(t.dir, "a.pdf", [
			{ pageContent: "Page one.", metadata: { loc: { pageNumber: 1 } } },
			{ pageContent: "Page two.", metadata: { loc: { pageNumber: 2 } } },
		]);
		expect(await t.refresh({ projectId: "p1" })).toMatchObject({
			files: 1,
			indexed: 1,
		});
		expect(t.fileTexts.read).toEqual(["a.pdf"]);
		expect(
			t.index
				.sectionsToEmbed("p1")
				.map((s) => [s.text, t.index.section(1, s.section_id)?.page]),
		).toEqual([
			["Page one.", 1],
			["Page two.", 2],
		]);
	});

	test("runs one refresh per project at a time: a second asks gets the one that runs", async () => {
		const t = refreshPorts();
		t.folders.put("p1", "a.md", "A car.", 1);
		t.fileTexts.put(t.dir, "a.md", "A car.");
		const first = t.refresh({ projectId: "p1" });
		expect(t.refresh({ projectId: "p1" })).toBe(first);
		await first;
		expect(t.scan).toHaveBeenCalledTimes(1);
		await t.refresh({ projectId: "p1" });
		expect(t.scan).toHaveBeenCalledTimes(2);
	});

	test("takes the caller's look at the folder instead of its own", async () => {
		const t = refreshPorts();
		t.folders.put("p1", "a.md", "A car.", 1);
		t.fileTexts.put(t.dir, "a.md", "A car.");
		const snapshot = await t.folders.scan("p1");
		await t.refresh({ projectId: "p1", snapshot });
		expect(t.scan).toHaveBeenCalledTimes(1);
	});
});
