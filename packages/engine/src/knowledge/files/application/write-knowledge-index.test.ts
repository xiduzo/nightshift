import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import { inMemoryFolderIndex } from "../adapters/out/in-memory-folder-index";
import { memorySnapshot } from "../adapters/out/in-memory-knowledge-folders";
import { inMemoryFilesPorts } from "../adapters/out/in-memory-neighbours";
import { writeKnowledgeIndex } from "./write-knowledge-index";

/** The use case writeKnowledgeIndex, on in-memory adapters. */

const DIR = "/knowledge/p1";
const DAY = parseInstant("2026-11-02T00:00:00Z");

function indexPorts(files: Record<string, string>) {
	const ports = inMemoryFilesPorts();
	const index = inMemoryFolderIndex();
	for (const [path, text] of Object.entries(files)) {
		index.putFile(DIR, path, text);
	}
	const snapshot = memorySnapshot(
		DIR,
		new Map(
			Object.entries(files).map(([path, text]) => [
				path,
				{ text, changedAt: DAY },
			]),
		),
	);
	return { ports: { ...ports, index }, index, snapshot };
}

describe("writeKnowledgeIndex", () => {
	test("writes a line per file, with its title, first sentence, day and headings", async () => {
		const { ports, index, snapshot } = indexPorts({
			"a.md": "# Alpha\n\nThe first one. More.\n\n## Part one\n\n## Part two\n",
			"b.txt": "Plain words here.",
		});
		await writeKnowledgeIndex(ports)({ snapshot });
		expect(index.writes).toEqual([
			{
				dir: DIR,
				text: [
					"# Knowledge index",
					"",
					"Read this index first.",
					"",
					"- `a.md`: Alpha. The first one (changed 2026-11-02)",
					"  Part one · Part two",
					"- `b.txt`: b. Plain words here (changed 2026-11-02)",
					"",
				].join("\n"),
			},
		]);
	});

	test("an index that is not stale is left", async () => {
		const { ports, index, snapshot } = indexPorts({ "a.md": "# A\n" });
		index.setWritten(DIR, {
			mtimeMs: DAY + 1,
			text: "Read this index first.\n- `a.md`: A",
		});
		await writeKnowledgeIndex(ports)({ snapshot });
		expect(index.writes).toEqual([]);
	});

	test("an index of other paths, of another version, or older than a file is written again", async () => {
		for (const text of [
			"Read this index first.\n- `b.md`: B",
			"An old intro.\n- `a.md`: A",
		]) {
			const { ports, index, snapshot } = indexPorts({ "a.md": "# A\n" });
			index.setWritten(DIR, { mtimeMs: DAY + 1, text });
			await writeKnowledgeIndex(ports)({ snapshot });
			expect(index.writes).toHaveLength(1);
		}
		const { ports, index, snapshot } = indexPorts({ "a.md": "# A\n" });
		index.setWritten(DIR, {
			mtimeMs: DAY - 1,
			text: "Read this index first.\n- `a.md`: A",
		});
		await writeKnowledgeIndex(ports)({ snapshot });
		expect(index.writes).toHaveLength(1);
	});

	test("an empty folder says it has no files yet", async () => {
		const { ports, index, snapshot } = indexPorts({});
		await writeKnowledgeIndex(ports)({ snapshot });
		expect(index.writes[0]?.text).toContain("No files yet.");
	});
});
