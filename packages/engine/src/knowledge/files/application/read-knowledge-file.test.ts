import { describe, expect, test } from "bun:test";
import { hostVersionWords } from "@nightshift/refusal";
import { OlderHostError } from "../../../contract";
import { inMemoryFilesPorts } from "../adapters/out/in-memory-neighbours";
import { readKnowledgeFile } from "./read-knowledge-file";

/** The use case readKnowledgeFile, on in-memory adapters. */

const sha256 = "b".repeat(64);
const listed = (deviceId = "desktop", local?: true) => ({
	sha256,
	size: 9,
	changedAt: 1,
	deviceId,
	...(local ? { local } : {}),
});

describe("readKnowledgeFile", () => {
	test("this computer's copy first", async () => {
		const ports = inMemoryFilesPorts();
		ports.folders.put("p1", "a.md", "# Here\n");
		const read = await readKnowledgeFile(ports)({
			projectId: "p1",
			path: "a.md",
			maxBytes: 100,
		});
		expect(read?.title).toBe("Here");
		expect(ports.texts.asked).toEqual([]);
	});

	test("else its content by hash from the Space", async () => {
		const ports = inMemoryFilesPorts();
		ports.documents.list("p1", "a.md", listed());
		ports.archive.keep(sha256, "# There\n");
		const read = await readKnowledgeFile(ports)({
			projectId: "p1",
			path: "./a.md",
			maxBytes: 100,
		});
		expect(read?.title).toBe("There");
		expect(ports.texts.asked).toEqual(["a.md"]);
	});

	test("null for a file neither has, a path no person reads, and a project with no Space", async () => {
		const ports = inMemoryFilesPorts();
		const read = readKnowledgeFile(ports);
		expect(
			await read({ projectId: "p1", path: "a.md", maxBytes: 9 }),
		).toBeNull();
		expect(
			await read({ projectId: "p1", path: "../a.md", maxBytes: 9 }),
		).toBeNull();
		ports.documents.list("p2", "a.md", listed());
		expect(
			await read({ projectId: "p2", path: "a.md", maxBytes: 9 }),
		).toBeNull();
	});

	test("refuses a large file that stays on another computer", async () => {
		const ports = inMemoryFilesPorts();
		ports.documents.list("p1", "big.pdf", listed("desktop", true));
		await expect(
			readKnowledgeFile(ports)({
				projectId: "p1",
				path: "big.pdf",
				maxBytes: 9,
			}),
		).rejects.toThrow(
			"This file is larger than 10 MB. It stays on the computer that synced it.",
		);
	});

	test("refuses content it cannot fetch now, with the words of an older Host when it is one", async () => {
		const ports = inMemoryFilesPorts();
		ports.documents.list("p1", "a.md", listed());
		ports.archive.failWith = new Error("The network connection was lost.");
		const read = () =>
			readKnowledgeFile(ports)({ projectId: "p1", path: "a.md", maxBytes: 9 });
		await expect(read()).rejects.toThrow(
			"Night Shift cannot get this file now. Try again when the computer that keeps this Space is online.",
		);
		ports.archive.failWith = new OlderHostError();
		await expect(read()).rejects.toThrow(hostVersionWords("older"));
	});
});
