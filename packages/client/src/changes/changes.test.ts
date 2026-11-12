import { describe, expect, test } from "bun:test";

import { documentOf, heldByDocuments, staleAfter } from "./changes";

describe("what a change makes stale", () => {
	test("a run reads the lists that count it, and what its steps keep for the next run", () => {
		expect(staleAfter(["runs"])).toEqual([
			["runs", "list"],
			["dashboard"],
			["schedules", "list"],
			["projects", "list"],
			["knowledge", "learnings"],
			["knowledge", "review"],
			["flows", "kept"],
			["flows", "memory"],
		]);
	});

	test("this computer's document reads its configuration, the checks of its CLIs included", () => {
		expect(staleAfter(["device"])).toEqual([
			["profiles"],
			["cliTools"],
			["settings"],
			["offers"],
			["deciders"],
			["connections"],
			["harnesses"],
		]);
	});

	test("reads each path once, and not a path below another one", () => {
		// The Space reads every read of projects: the lists that count runs need no own read.
		expect(staleAfter(["runs", "space"])).toEqual([
			["runs", "list"],
			["dashboard"],
			["schedules", "list"],
			["knowledge", "learnings"],
			["knowledge", "review"],
			["flows", "kept"],
			["flows", "memory"],
			["spaces"],
			["members"],
			["projects"],
		]);
		// The flows read their history too.
		expect(staleAfter(["flows", "flows-history"])).toEqual([
			["schedules", "list"],
			["flows"],
		]);
		expect(staleAfter([])).toEqual([]);
	});
});

describe("the reads a synced document holds", () => {
	test("are the reads only a document changes, each once", () => {
		expect(heldByDocuments()).toEqual([
			["flows", "list"],
			["flows", "get"],
			["flows", "map"],
			["flows", "notices"],
			["flows", "export"],
			["schedules", "list"],
			["flows", "revisions"],
			["flows", "revision"],
			["knowledge"],
			["projects", "list"],
			["spaces"],
			["members"],
			["dashboard"],
			["profiles"],
			["connections", "list"],
			["harnesses", "list"],
			["cliTools"],
			["settings"],
			["offers"],
			["deciders"],
		]);
	});

	test("are each read again when their document changes", () => {
		const documents = staleAfter([
			"flows",
			"flows-history",
			"knowledge",
			"space",
			"device",
			"device-copy",
		]);
		for (const held of heldByDocuments()) {
			expect(
				documents.some((path) => path.every((part, at) => held[at] === part)),
				held.join("."),
			).toBe(true);
		}
	});
});

describe("the kind of a synced document", () => {
	test("is the prefix of its name, or null for a name this screen does not know", () => {
		expect(documentOf("flows:shop")).toBe("flows");
		expect(documentOf("flows-history:shop")).toBe("flows-history");
		expect(documentOf("device-copy:laptop")).toBe("device-copy");
		expect(documentOf("device")).toBe("device");
		expect(documentOf("notes:shop")).toBeNull();
	});
});
