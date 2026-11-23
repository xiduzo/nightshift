import { describe, expect, test } from "bun:test";
import { terminalResources } from "./terminal-resources";

describe("terminalResources", () => {
	test("lists and reads through a port", async () => {
		const resources = terminalResources({
			projects: async () => [],
			knowledgeFiles: async () => [],
			readKnowledge: async () => null,
		});
		expect(await resources.list()).toEqual([]);
	});
});