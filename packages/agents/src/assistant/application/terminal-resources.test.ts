import { describe, expect, test } from "bun:test";
import { terminalResources } from "./terminal-resources";

const port = {
	projects: async () => [
		{ id: "p1", name: "Garden", path: "/garden" },
		{ id: "p/2", name: "Kitchen", path: "/kitchen" },
	],
	knowledgeFiles: async (projectId: string) =>
		projectId === "p1"
			? [{ path: "soil.md", size: 10 }]
			: [{ path: "a b/menu.pdf", size: 20 }],
	readKnowledge: async (projectId: string, path: string) =>
		projectId === "p/2" && path === "a b/menu.pdf"
			? { path, title: "Menu", text: "Soup", size: 4, truncated: false }
			: null,
};
const KITCHEN = "nightshift://knowledge/p%2F2/a%20b/menu.pdf";

describe("terminalResources", () => {
	test("lists the knowledge of the project of the folder, else of every project", async () => {
		expect(await terminalResources(port, { folder: "/garden" }).list()).toEqual(
			[
				{
					uri: "nightshift://knowledge/p1/soil.md",
					name: "soil.md",
					title: "soil.md (Garden)",
					description: 'A file of the knowledge of "Garden".',
					mimeType: "text/markdown",
					size: 10,
				},
			],
		);
		const all = await terminalResources(port).list();
		expect(all.map((row) => row.uri)).toEqual([
			"nightshift://knowledge/p1/soil.md",
			KITCHEN,
		]);
	});

	test("reads the file its URI names, and nothing for another URI", async () => {
		const { read } = terminalResources(port);
		expect(await read(KITCHEN)).toEqual({
			text: "Soup",
			mimeType: "text/plain",
		});
		for (const uri of [
			"nightshift://knowledge/p1/menu.pdf",
			"nightshift://knowledge/p1",
			"nightshift://knowledge/p1/%",
			"file:///etc/passwd",
		]) {
			expect(await read(uri)).toBeNull();
		}
	});
});
