import { describe, expect, test } from "bun:test";
import { GraphDocument } from "@langchain/community/graphs/document";
import { Document } from "@langchain/core/documents";
import { knowledgeGraphOf, TopicGraphTransformer } from "./graph";

const doc = (path: string, pageContent: string) =>
	new Document({ pageContent, metadata: { path } });

/** Three files about momentum, one of which also talks about the Sharpe ratio. */
const library = [
	doc(
		"a.md",
		"Some words on momentum and momentum again. We compare the Sharpe ratio. See [b](b.md).",
	),
	doc("b.md", "This covers momentum in detail, and the Sharpe ratio too."),
	doc("c.md", "A note on gardening and tomatoes, with no overlap at all."),
];

async function graphOf(
	input: Partial<Parameters<typeof knowledgeGraphOf>[0]> = {},
) {
	const documents = await new TopicGraphTransformer().convertToGraphDocuments(
		library,
	);
	return knowledgeGraphOf({
		files: library.map((document) => String(document.metadata.path)),
		documents,
		asked: [],
		learnings: [],
		...input,
	});
}

const ids = (graph: Awaited<ReturnType<typeof graphOf>>, kind: string) =>
	graph.nodes.filter((node) => node.kind === kind).map((node) => node.id);

describe("TopicGraphTransformer", () => {
	test("gives LangChain's GraphDocument, with its source", async () => {
		const [first] = await new TopicGraphTransformer().convertToGraphDocuments(
			library,
		);
		expect(first).toBeInstanceOf(GraphDocument);
		expect(first?.source.metadata.path).toBe("a.md");
	});

	test("a word that files share is a topic, a word of one file is not", async () => {
		const topics = ids(await graphOf(), "topic");
		expect(topics).toContain("topic:momentum");
		expect(topics).not.toContain("topic:tomatoes");
	});

	test("a topic keeps the way a name is written", async () => {
		const graph = await graphOf();
		expect(graph.nodes.find((n) => n.id === "topic:sharpe")?.label).toBe(
			"Sharpe",
		);
	});

	test("a name stops at the end of its line", async () => {
		const documents = await new TopicGraphTransformer().convertToGraphDocuments(
			[
				doc("a.md", "the Rules\nUniverse and the Rules\nUniverse"),
				doc("b.md", "the Rules\nUniverse once more"),
			],
		);
		const labels = documents
			.flatMap((document) => document.nodes)
			.filter((node) => node.type === "Topic")
			.map((node) => String(node.properties.label));
		expect(labels.some((label) => label.includes("\n"))).toBe(false);
	});

	test("no words in common: no topics", async () => {
		const documents = await new TopicGraphTransformer().convertToGraphDocuments(
			[doc("a.md", "apples pears"), doc("b.md", "engines wheels")],
		);
		expect(documents.flatMap((d) => d.relationships)).toEqual([]);
	});

	test("no documents: nothing", async () => {
		expect(
			await new TopicGraphTransformer().convertToGraphDocuments([]),
		).toEqual([]);
	});
});

describe("knowledgeGraphOf", () => {
	test("a file with topics connects to them", async () => {
		const { edges } = await graphOf();
		expect(edges).toContainEqual({
			id: "file:a.md->topic:momentum",
			source: "file:a.md",
			target: "topic:momentum",
			kind: "mentions",
		});
	});

	test("a link in a file's text connects it to the other file", async () => {
		const { edges } = await graphOf();
		expect(edges.find((e) => e.kind === "links")?.id).toBe(
			"file:a.md->file:b.md",
		);
	});

	test("a file the graph could not read is still on it", async () => {
		const graph = await graphOf({ files: ["a.md", "b.md", "c.md", "d.pdf"] });
		const file = graph.nodes.find((n) => n.id === "file:d.pdf");
		expect(file).toMatchObject({ kind: "file", path: "d.pdf", degree: 0 });
	});

	test("a question connects to the files it found", async () => {
		const graph = await graphOf({
			asked: [
				{
					query: "momentum",
					hits: [
						{
							path: "b.md",
							section: null,
							line: 1,
							page: null,
							found: ["words"],
						},
					],
				},
			],
		});
		expect(graph.edges.map((e) => e.id)).toContain(
			"question:momentum->file:b.md",
		);
	});

	test("a question that found nothing stands alone", async () => {
		const graph = await graphOf({ asked: [{ query: "gold", hits: [] }] });
		const question = graph.nodes.find((n) => n.id === "question:gold");
		expect(question?.degree).toBe(0);
	});

	test("a hit on a file that is gone adds no edge", async () => {
		const graph = await graphOf({
			asked: [
				{
					query: "old",
					hits: [
						{
							path: "gone.md",
							section: null,
							line: 1,
							page: null,
							found: ["words"],
						},
					],
				},
			],
		});
		expect(graph.edges.map((e) => e.target)).not.toContain("file:gone.md");
	});

	test("a learning connects to the topics it names, as whole words", async () => {
		const graph = await graphOf({
			learnings: [{ id: "run-1.md", notes: ["MOMENTUM fades in December."] }],
		});
		expect(graph.edges.map((e) => e.id)).toContain(
			"learning:run-1.md->topic:momentum",
		);
		const part = await graphOf({
			learnings: [{ id: "run-2.md", notes: ["Sharpened pencils are fine."] }],
		});
		expect(ids(part, "learning")).toEqual([]);
	});

	test("a long learning has a short label", async () => {
		const graph = await graphOf({
			learnings: [{ id: "run-1.md", notes: [`momentum ${"x".repeat(200)}`] }],
		});
		const [learning] = graph.nodes.filter((n) => n.kind === "learning");
		expect(learning?.label.length).toBe(61);
	});

	test("counts the edges of a node", async () => {
		const graph = await graphOf();
		const topic = graph.nodes.find((n) => n.id === "topic:momentum");
		expect(topic?.degree).toBe(
			graph.edges.filter((e) => e.target === "topic:momentum").length,
		);
	});

	test("says how many files it left out", async () => {
		expect((await graphOf({ filesLeftOut: 3 })).filesLeftOut).toBe(3);
		expect((await graphOf()).filesLeftOut).toBe(0);
	});
});
