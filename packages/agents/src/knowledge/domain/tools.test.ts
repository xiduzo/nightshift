import { describe, expect, test } from "bun:test";
import { type KnowledgeUse, knowledgeTools, useHit } from "./tools";

/**
 * The knowledge tools as specs: their fields and their answers, over a port
 * a test fills. How a session takes them is in `tools/bridged-tools.test.ts`
 * and on every harness in `harnesses/knowledge-brief.test.ts`.
 */

const HIT = {
	path: "wiki/deploy.md",
	title: "Deploy",
	section: "Rolling updates",
	line: 12,
	snippet: [
		{ text: "We ", match: false },
		{ text: "deploy", match: true },
		{ text: " at night.", match: false },
	],
};

function tools(options: { scope?: "one" | "any"; file?: boolean } = {}) {
	const uses: { projectId: string; use: KnowledgeUse }[] = [];
	const [search, read] = knowledgeTools(
		{
			searchKnowledge: async (_id, query) => (query === "none" ? [] : [HIT]),
			readKnowledge: async (_id, path) =>
				options.file === false
					? null
					: { path, title: "Deploy", text: "Body.", size: 5, truncated: false },
		},
		options.scope === "any"
			? { projectOf: async () => ({ id: "p2", name: "Shop" }) }
			: { project: { id: "p1" } },
		{ onUse: (projectId, use) => uses.push({ projectId, use }) },
	);
	if (!search || !read) throw new Error("two tools");
	return { search, read, uses };
}

describe("the knowledge tools", () => {
	test("search_knowledge and read_knowledge, with a project field only where they can work in more than one", () => {
		const one = tools();
		expect(one.search.name).toBe("search_knowledge");
		expect(one.read.name).toBe("read_knowledge");
		expect(Object.keys(one.search.inputSchema.properties)).toEqual([
			"query",
			"limit",
		]);
		expect(one.read.inputSchema.required).toEqual(["path"]);
		expect(
			Object.keys(tools({ scope: "any" }).search.inputSchema.properties),
		).toEqual(["project", "query", "limit"]);
	});

	test("a search answers its hits with the words found in bold, and the log keeps where", async () => {
		const { search, uses } = tools();
		expect(JSON.parse(await search.server({ query: " deploy " }))).toEqual([
			{
				path: "wiki/deploy.md",
				title: "Deploy",
				section: "Rolling updates",
				line: 12,
				excerpt: "We **deploy** at night.",
			},
		]);
		expect(uses).toEqual([
			{
				projectId: "p1",
				use: { kind: "search", query: "deploy", hits: [useHit(HIT)] },
			},
		]);
		expect(useHit(HIT)).toEqual({
			path: "wiki/deploy.md",
			section: "Rolling updates",
			line: 12,
			page: null,
			found: ["words"],
		});
	});

	test("says what to do when a call finds nothing or gives no field", async () => {
		const { search } = tools({ scope: "any" });
		expect(await search.server({ query: "none" })).toBe(
			'No file in the knowledge of "Shop" matches "none". Try other words, or fewer.',
		);
		await expect(search.server({})).rejects.toThrow(
			"Give the words to look for in `query`.",
		);
		const { read } = tools({ file: false });
		expect(await read.server({ path: "wiki/gone.md" })).toBe(
			'The project\'s knowledge has no file "wiki/gone.md". Call search_knowledge for the paths.',
		);
		await expect(read.server({ path: " " })).rejects.toThrow(
			"Give the file's path in `path`, as search_knowledge gives it.",
		);
	});

	test("a read answers the file's path, title and text", async () => {
		const { read, uses } = tools();
		expect(await read.server({ path: "wiki/deploy.md" })).toBe(
			"wiki/deploy.md: Deploy\n\nBody.",
		);
		expect(uses[0]?.use).toEqual({
			kind: "read",
			path: "wiki/deploy.md",
			found: true,
		});
	});
});
