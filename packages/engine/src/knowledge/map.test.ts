import { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import type { ArchiveHost } from "../archive";
import { createSandbox, type Sandbox, waitFor } from "../testing";
import { SynonymEmbeddings } from "../testing/embeddings";
import { testKnowledge } from "../testing/knowledge";
import { knowledgeMapOf } from "./map";
import type { KnowledgeMeaning } from "./meaning";

/** The Map, through the door's `map`: what a person sees, whatever draws it. */

const sandboxes: Sandbox[] = [];
const closes: (() => void)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) close();
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

/** A Host's archive in memory: content by hash. */
function memoryHost(): ArchiveHost {
	const kept = new Map<string, Uint8Array>();
	return {
		async archivePut({ ref, content }) {
			if (ref.kind !== "content" || typeof content === "string") return false;
			kept.set(ref.sha256, content.slice());
			return true;
		},
		async archiveGet(ref) {
			return ref.kind === "content"
				? (kept.get(ref.sha256)?.slice() ?? null)
				: null;
		},
	};
}

/** A Device with project p1, connected to `host`. */
async function device(
	host: ArchiveHost = memoryHost(),
	options: { meaning?: KnowledgeMeaning } = {},
) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const built = testKnowledge(sandbox, { pageWaitMs: 5_000, ...options });
	closes.push(built.close);
	built.archive.connect(host);
	built.knowledge.connect({ inStep: async () => {} });
	const dir = built.folder("p1");
	return {
		...built,
		dir,
		put: async (path: string, text: string) => {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), text);
		},
		map: () => built.knowledge.map("p1"),
	};
}

type Device = Awaited<ReturnType<typeof device>>;

/** The other computer gets the document, as its Link brings it. */
async function linked(from: Device, to: Device) {
	applyUpdate(
		(await to.persisted("p1")).doc,
		encodeStateAsUpdate((await from.persisted("p1")).doc),
	);
}

const idsOf = (map: Awaited<ReturnType<Device["map"]>>, kind: string) =>
	map.nodes.filter((node) => node.kind === kind).map((node) => node.id);

const labelsOf = (map: Awaited<ReturnType<Device["map"]>>, kind: string) =>
	map.nodes.filter((node) => node.kind === kind).map((node) => node.label);

describe("what the Map shows", () => {
	test("the files, the topics they share, and the links between them", async () => {
		const a = await device();
		await a.put(
			"wiki/one.md",
			"Momentum and more momentum. See [two](two.md) and [gone](gone.md).",
		);
		await a.put("wiki/two.md", "This is about momentum too.");
		await a.put("wiki/three.md", "A note on gardening and tomatoes.");
		const map = await a.map();
		expect(idsOf(map, "file").sort()).toEqual([
			"file:wiki/one.md",
			"file:wiki/three.md",
			"file:wiki/two.md",
		]);
		expect(idsOf(map, "topic")).toContain("topic:momentum");
		expect(idsOf(map, "topic")).not.toContain("topic:tomatoes");
		expect(map.edges).toContainEqual({
			id: "file:wiki/one.md->topic:momentum",
			source: "file:wiki/one.md",
			target: "topic:momentum",
			kind: "mentions",
		});
		expect(map.edges.filter((edge) => edge.kind === "links")).toEqual([
			{
				id: "file:wiki/one.md->file:wiki/two.md",
				source: "file:wiki/one.md",
				target: "file:wiki/two.md",
				kind: "links",
			},
		]);
		const topic = map.nodes.find((node) => node.id === "topic:momentum");
		expect(topic?.degree).toBe(2);
		expect(map.filesLeftOut).toBe(0);
	});

	test("a link can climb out of its folder, and a code fence that a section cut is still code", async () => {
		const a = await device();
		const code = Array.from({ length: 80 }, () =>
			"fencedword ".repeat(10),
		).join("\n");
		await a.put(
			"wiki/deep/one.md",
			`See [two](../two.md).\n\n\`\`\`\n${code}\n\`\`\`\n\nMomentum.`,
		);
		await a.put(
			"wiki/two.md",
			`Momentum.\n\n\`\`\`\n${code}\n\`\`\`\n\nMomentum.`,
		);
		const map = await a.map();
		expect(map.edges.map((edge) => edge.id)).toContain(
			"file:wiki/deep/one.md->file:wiki/two.md",
		);
		expect(idsOf(map, "topic")).not.toContain("topic:fencedword");
	});

	test("a change in the folder shows at the next draw, with what agents asked and the learnings that wait", async () => {
		const a = await device();
		await a.put("wiki/one.md", "Momentum in a first file.");
		await a.put("wiki/two.md", "Momentum in a second file.");
		await a.map();
		await a.put("wiki/three.md", "Momentum in a third file, and rainbows.");
		await a.put("wiki/one.md", "Later on, some rainbows and momentum.");
		await a.put(
			"learnings/proposed/run-1.s1.md",
			"- Rainbows come after the rain.\n- Sharpened pencils are fine.\n",
		);
		await a.knowledge.search("p1", "deploy", { agent: true });
		// A proposal waits once a reconcile published it.
		await a.knowledge.listing("p1");
		const map = await a.map();
		expect(map.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([
				"topic:rainbows",
				"question:deploy",
				"learning:run-1.s1.md",
			]),
		);
		expect(map.edges.map((edge) => edge.id)).toContain(
			"learning:run-1.s1.md->topic:rainbows",
		);
		// What is proposed is no file, and a question that found nothing stands alone.
		expect(idsOf(map, "file")).not.toContain(
			"file:learnings/proposed/run-1.s1.md",
		);
		expect(map.nodes.find((n) => n.id === "question:deploy")?.degree).toBe(0);
	});

	test("a learning names a topic as a whole word, in any case, with a short label", async () => {
		const a = await device();
		await a.put("wiki/one.md", "On momentum.");
		await a.put("wiki/two.md", "More momentum.");
		await a.put(
			"learnings/proposed/run-1.s1.md",
			`- MOMENTUM ${"x".repeat(99)}\n`,
		);
		await a.put("learnings/proposed/run-2.s1.md", "- Momentumless days.\n");
		await a.knowledge.listing("p1");
		const map = await a.map();
		expect(idsOf(map, "learning")).toEqual(["learning:run-1.s1.md"]);
		expect(labelsOf(map, "learning")[0]?.length).toBe(61);
	});
});

describe("drawing the Map", () => {
	test("never asks the Host, not for the document, a file or a learning", async () => {
		const host = memoryHost();
		const a = await device(host);
		await a.put("wiki/one.md", "On momentum.");
		await a.put("wiki/two.md", "More momentum.");
		await a.put("learnings/proposed/run-1.s1.md", "- On momentum.\n");
		await a.knowledge.listing("p1");

		const b = await device(host);
		await linked(a, b);
		const inStep = spyOn({ inStep: async () => {} }, "inStep");
		b.knowledge.connect({ inStep });
		const gets = spyOn(host, "archiveGet");
		const puts = spyOn(host, "archivePut");

		const map = await b.map();
		// The Space lists what this computer does not have yet: it stands alone.
		expect(idsOf(map, "file").sort()).toEqual([
			"file:wiki/one.md",
			"file:wiki/two.md",
		]);
		expect(map.edges).toEqual([]);
		expect(gets).toHaveBeenCalledTimes(0);
		expect(puts).toHaveBeenCalledTimes(0);
		expect(inStep).toHaveBeenCalledTimes(0);

		// The list of the page does ask: that is what this test would catch.
		await b.knowledge.listing("p1");
		expect(gets.mock.calls.length).toBeGreaterThan(0);
		expect(inStep.mock.calls.length).toBeGreaterThan(0);
		// What it brought is here now, and the next draw reads it.
		const calls = gets.mock.calls.length;
		const after = await b.map();
		expect(idsOf(after, "topic")).toContain("topic:momentum");
		expect(idsOf(after, "learning")).toEqual(["learning:run-1.s1.md"]);
		expect(gets).toHaveBeenCalledTimes(calls);
	});

	test("works when the Host is down", async () => {
		const host = memoryHost();
		const a = await device(host);
		await a.put("wiki/one.md", "On momentum.");
		await a.put("wiki/two.md", "More momentum.");
		spyOn(host, "archiveGet").mockRejectedValue(new Error("Host down"));
		expect(idsOf(await a.map(), "topic")).toEqual(["topic:momentum"]);
	});

	test("a project with no knowledge has an empty Map", async () => {
		const a = await device();
		expect(await a.map()).toEqual({
			nodes: [],
			edges: [],
			filesLeftOut: 0,
			notTopics: [],
		});
	});
});

describe("the topics", () => {
	test("a plural and its singular are one topic, as the text writes it", async () => {
		const a = await device();
		await a.put(
			"wiki/one.md",
			"We hold an ETF and more ETFs. All queries are slow. One query is fast.",
		);
		await a.put("wiki/two.md", "We sold the ETFs and asked more queries.");
		const map = await a.map();
		expect(idsOf(map, "topic").sort()).toEqual(["topic:etf", "topic:query"]);
		expect(labelsOf(map, "topic").sort()).toEqual(["ETF", "query"]);
	});

	test("a plural stays when the text has no singular: it folds into nothing made up", async () => {
		const a = await device();
		await a.put("wiki/one.md", "Our process has stages. Stages are fine.");
		await a.put("wiki/two.md", "Their process has stages too.");
		const topics = idsOf(await a.map(), "topic");
		expect(topics).toContain("topic:stages");
		expect(topics).toContain("topic:process");
	});

	test("two words that stand together are one topic, and the word gives way to its phrase", async () => {
		const a = await device();
		await a.put(
			"wiki/one.md",
			"We compare the Sharpe ratio here. The Sharpe ratio is a measure of return.",
		);
		await a.put("wiki/two.md", "Compute the\nSharpe ratio of this fund.");
		await a.put("wiki/three.md", "Gardening has no ratio to speak of.");
		const map = await a.map();
		expect(labelsOf(map, "topic")).toContain("Sharpe ratio");
		expect(idsOf(map, "topic")).not.toContain("topic:sharpe");
	});

	test("words do not make a phrase across a sentence, a cell or a piece of code", async () => {
		const a = await device();
		const text =
			"Rapid. Growth here. | rapid | growth | and rapid `x` growth, and rapid (growth).";
		await a.put("wiki/one.md", text);
		await a.put("wiki/two.md", text);
		expect(idsOf(await a.map(), "topic")).not.toContain("topic:rapid growth");
	});

	test("Dutch counts the same way: whole words, plurals, and its short words are no topics", async () => {
		const a = await device();
		await a.put(
			"wiki/een.md",
			"De coördinatie van het model loopt via de wettelijke termijn. Er zijn modellen voor elke zaak.",
		);
		await a.put(
			"wiki/twee.md",
			"Alle modellen staan klaar. De coördinatie volgt de wettelijke termijn voor een zaak.",
		);
		const map = await a.map();
		const topics = idsOf(map, "topic");
		expect(topics).toContain("topic:model");
		expect(topics).toContain("topic:coördinatie");
		expect(topics).toContain("topic:wettelijke termijn");
		expect(topics.join(" ")).not.toContain("rdinatie ");
		expect(topics).not.toContain("topic:rdinatie");
		expect(topics).not.toContain("topic:modellen");
		for (const word of ["voor", "zijn", "staan"]) {
			expect(topics).not.toContain(`topic:${word}`);
		}
	});

	test("the first word of a line is no name, and a name stops at its line", async () => {
		const a = await device();
		for (const name of ["one", "two"]) {
			await a.put(
				`wiki/${name}.md`,
				"The first line\nNumbers in a line and see The end\nthe Rules\nUniverse once more",
			);
		}
		const labels = labelsOf(await a.map(), "topic");
		expect(labels).not.toContain("The");
		expect(labels).not.toContain("Numbers");
		expect(labels.some((label) => label.includes("\n"))).toBe(false);
	});

	test("a word in most of the files says nothing about one of them, unless there are few", async () => {
		const a = await device();
		for (const name of ["one", "two", "three", "four", "five"]) {
			await a.put(`wiki/${name}.md`, `Everywhere words in ${name}.`);
		}
		expect(idsOf(await a.map(), "topic")).not.toContain("topic:everywhere");
	});

	test("no words in common: no topics", async () => {
		const a = await device();
		await a.put("wiki/one.md", "apples pears");
		await a.put("wiki/two.md", "engines wheels");
		expect(idsOf(await a.map(), "topic")).toEqual([]);
	});
});

describe("not a topic", () => {
	test("takes a word off the Map, the next word takes its place, and it can come back", async () => {
		const a = await device();
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "More momentum and rainbows.");
		expect(idsOf(await a.map(), "topic").sort()).toEqual([
			"topic:momentum",
			"topic:rainbows",
		]);

		expect(
			await a.knowledge.markNotTopic("p1", {
				word: " Rainbows ",
				notTopic: true,
				by: "ann",
			}),
		).toEqual(["Rainbows"]);
		const without = await a.map();
		expect(idsOf(without, "topic")).toEqual(["topic:momentum"]);
		expect(without.notTopics).toEqual(["Rainbows"]);

		expect(
			await a.knowledge.markNotTopic("p1", {
				word: "rainbows",
				notTopic: false,
				by: "ann",
			}),
		).toEqual([]);
		expect(idsOf(await a.map(), "topic")).toContain("topic:rainbows");
	});

	test("holds for the word in either number, and a marked phrase leaves its words", async () => {
		const a = await device();
		await a.put(
			"wiki/one.md",
			"An agent and two agents. The Sharpe ratio is here.",
		);
		await a.put("wiki/two.md", "More agents. The Sharpe ratio is here too.");
		await a.knowledge.markNotTopic("p1", {
			word: "agents",
			notTopic: true,
			by: null,
		});
		await a.knowledge.markNotTopic("p1", {
			word: "Sharpe ratio",
			notTopic: true,
			by: null,
		});
		const topics = idsOf(await a.map(), "topic");
		expect(topics).not.toContain("topic:agent");
		expect(topics).not.toContain("topic:sharpe ratio");
		expect(topics).toContain("topic:sharpe");
	});

	test("follows the Space to another computer, and never shows as a file", async () => {
		const host = memoryHost();
		const a = await device(host);
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "More momentum and rainbows.");
		await a.knowledge.markNotTopic("p1", {
			word: "momentum",
			notTopic: true,
			by: "ann",
		});
		const document = await a.documents.open("p1");
		expect([...document.entries().keys()]).toContain("evals/not-topics.json");
		const listing = await a.knowledge.listing("p1");
		expect(listing.files.map((file) => file.path)).not.toContain(
			"evals/not-topics.json",
		);
		expect(
			await a.knowledge.read("p1", "evals/not-topics.json", { maxBytes: 1024 }),
		).toBeNull();
		expect(idsOf(await a.map(), "file")).not.toContain(
			"file:evals/not-topics.json",
		);

		const b = await device(host);
		await linked(a, b);
		await b.knowledge.listing("p1");
		const there = await b.map();
		expect(there.notTopics).toEqual(["momentum"]);
		expect(idsOf(there, "topic")).toEqual(["topic:rainbows"]);
	});

	test("a file that is not valid counts as no words", async () => {
		const a = await device();
		await a.put("wiki/one.md", "On momentum.");
		await a.put("wiki/two.md", "More momentum.");
		await a.put("evals/not-topics.json", "{ not valid");
		expect((await a.map()).notTopics).toEqual([]);
		await a.put(
			"evals/not-topics.json",
			'{"version":1,"words":[{"word":"momentum"},{"word":"rainbows","markedAt":1,"by":null}]}',
		);
		expect((await a.map()).notTopics).toEqual(["rainbows"]);
		expect(idsOf(await a.map(), "topic")).toEqual(["topic:momentum"]);
	});
});

/** A model that knows a few synonyms (`SynonymEmbeddings`), with a line for close files. */
function fakeMeaning(
	closeAt: number | undefined,
	ready: () => Promise<"ready" | "no-ollama"> = async () => "ready",
) {
	const embeddings = new SynonymEmbeddings();
	const meaning: KnowledgeMeaning = {
		model: "fake",
		embeddings,
		query: (text) => text,
		ready,
		...(closeAt !== undefined ? { closeAt } : {}),
	};
	return { meaning, embeddings };
}

const closeEdges = (map: Awaited<ReturnType<Device["map"]>>) =>
	map.edges.filter((edge) => edge.kind === "close").map((edge) => edge.id);

/** Three files: two about one thing in other words, and one about another. */
async function closeLibrary(a: Device) {
	await a.put("wiki/car.md", "The car.");
	await a.put("wiki/vehicle.md", "A vehicle.");
	await a.put("wiki/cat.md", "A kitten.");
}

async function vectorsReady(a: Device) {
	await a.map();
	await waitFor(async () => (await a.knowledge.meaning("p1")).state === "on", {
		timeoutMs: 5_000,
	});
}

describe("files close in meaning", () => {
	test("connect, over the line, with no word in common", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		expect(closeEdges(await a.map())).toEqual([
			"file:wiki/car.md->file:wiki/vehicle.md",
		]);
	});

	test("no edge between files that link: the link says more", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await a.put("wiki/vehicle.md", "A vehicle. See [the other](car.md).");
		await vectorsReady(a);
		const map = await a.map();
		expect(closeEdges(map)).toEqual([]);
		expect(map.edges.map((edge) => edge.id)).toContain(
			"file:wiki/vehicle.md->file:wiki/car.md",
		);
	});

	test("drawing asks no model, so they stay when the model does not answer", async () => {
		let answers = true;
		const { meaning, embeddings } = fakeMeaning(0.9, async () =>
			answers ? "ready" : "no-ollama",
		);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		const asked = embeddings.embedded;
		const query = spyOn(embeddings, "embedQuery");
		answers = false;
		expect(closeEdges(await a.map())).toHaveLength(1);
		expect(embeddings.embedded).toBe(asked);
		expect(query).toHaveBeenCalledTimes(0);
	});

	test("a section that changed takes its old vector off the Map", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		await a.put("wiki/vehicle.md", "A feline.");
		// No wait for the preparation: its old vector no longer has a section.
		expect(closeEdges(await a.map())).toEqual([]);
	});

	test("no model: the Map stands without them", async () => {
		const a = await device();
		await closeLibrary(a);
		expect(closeEdges(await a.map())).toEqual([]);
		expect(idsOf(await a.map(), "file")).toHaveLength(3);
	});

	test("a model nobody measured has no line: none", async () => {
		const { meaning } = fakeMeaning(undefined);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		expect(closeEdges(await a.map())).toEqual([]);
	});

	test("search by meaning off for the project: none", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		await a.knowledge.setMeaning("p1", false);
		expect(closeEdges(await a.map())).toEqual([]);
	});
});

describe("a second draw", () => {
	/** Counts the two scans the Map's index read does: of the sections' text and of the vectors. */
	function watchScans() {
		const scans = (sql: unknown) =>
			/s\.text AS text|WITH held AS/.test(String(sql));
		const prepare = spyOn(Database.prototype, "prepare");
		const query = spyOn(Database.prototype, "query");
		return {
			count: () =>
				[...prepare.mock.calls, ...query.mock.calls].filter(([sql]) =>
					scans(sql),
				).length,
			stop() {
				prepare.mockRestore();
				query.mockRestore();
			},
		};
	}

	test("with nothing changed does no scan, and gives the Map it drew", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		await vectorsReady(a);
		const first = await a.map();
		const scans = watchScans();
		try {
			expect(await a.map()).toBe(first);
			expect(scans.count()).toBe(0);
		} finally {
			scans.stop();
		}
	});

	test("after a change in the folder scans again, and shows it", async () => {
		const a = await device();
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "The momentum and rainbows.");
		await a.map();
		await a.put("wiki/three.md", "More.");
		const scans = watchScans();
		try {
			const map = await a.map();
			expect(scans.count()).toBeGreaterThan(0);
			expect(idsOf(map, "file")).toContain("file:wiki/three.md");
		} finally {
			scans.stop();
		}
	});

	test("after new vectors draws them", async () => {
		const { meaning } = fakeMeaning(0.9);
		const a = await device(memoryHost(), { meaning });
		await closeLibrary(a);
		// Drawn before the first vectors, so no edge of meaning yet.
		const before = await a.map();
		await waitFor(async () => (await a.knowledge.meaning("p1")).state === "on");
		const after = await a.map();
		expect(after).not.toBe(before);
		expect(closeEdges(after)).toHaveLength(1);
	});

	test("shows a person's Not a topic at once, and its way back", async () => {
		const a = await device();
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "The momentum and rainbows.");
		expect(idsOf(await a.map(), "topic")).toContain("topic:rainbows");
		await a.map();
		await a.knowledge.markNotTopic("p1", {
			word: "rainbows",
			notTopic: true,
			by: "ann",
		});
		const marked = await a.map();
		expect(marked.notTopics).toEqual(["rainbows"]);
		expect(idsOf(marked, "topic")).not.toContain("topic:rainbows");
		await a.knowledge.markNotTopic("p1", {
			word: "rainbows",
			notTopic: false,
			by: "ann",
		});
		expect(idsOf(await a.map(), "topic")).toContain("topic:rainbows");
	});

	test("draws again when a learning waits, and when agents ask something new", async () => {
		const a = await device();
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "The momentum and rainbows.");
		const first = await a.map();
		await a.put(
			"learnings/proposed/run-1.s1.md",
			"- The momentum matters here.\n",
		);
		// A proposal waits once a reconcile published it.
		await a.knowledge.listing("p1");
		const second = await a.map();
		expect(second).not.toBe(first);
		expect(idsOf(second, "learning")).toEqual(["learning:run-1.s1.md"]);
		await a.knowledge.search("p1", "momentum", { agent: true });
		expect(idsOf(await a.map(), "question")).toEqual(["question:momentum"]);
	});

	test("two draws at once share one drawing", async () => {
		const a = await device();
		await a.put("wiki/one.md", "The momentum and rainbows.");
		await a.put("wiki/two.md", "The momentum and rainbows.");
		await a.map();
		await a.put("wiki/three.md", "More.");
		const [one, two] = await Promise.all([a.map(), a.map()]);
		expect(one).toBe(two);
	});
});

describe("which files connect", () => {
	/** The pairs the Map connects, drawn from these vectors alone. */
	const closeFiles = (
		vectors: { path: string; vector: Float32Array }[],
		closeAt: number,
	) =>
		knowledgeMapOf({
			files: vectors.map(({ path }) => path),
			read: [],
			filesLeftOut: 0,
			vectors,
			closeAt,
			asked: [],
			learnings: [],
			notTopics: [],
		})
			.edges.filter((edge) => edge.kind === "close")
			.map((edge) => [
				edge.source.replace("file:", ""),
				edge.target.replace("file:", ""),
			]);

	/** A unit vector along one dimension, a little to the side by `lean`. */
	const along = (dimension: number, lean = 0, size = 8) => {
		const vector = new Float32Array(size);
		vector[dimension] = 1;
		vector[(dimension + 1) % size] = lean;
		return vector;
	};

	test("a file that is close to everything connects only to its closest ones", () => {
		const others = ["a", "b", "c", "d", "e"].map((path, at) => ({
			path,
			vector: along(0, at * 0.01),
		}));
		const pairs = closeFiles(others, 0.5);
		const edgesOf = (path: string) =>
			pairs.filter((pair) => pair.includes(path)).length;
		for (const { path } of others) {
			expect(edgesOf(path)).toBeLessThanOrEqual(3);
		}
		expect(pairs.length).toBeGreaterThan(0);
	});

	test("the sections of a file count together, and a far file stays alone", () => {
		expect(
			closeFiles(
				[
					{ path: "a", vector: along(0) },
					{ path: "a", vector: along(1) },
					{ path: "b", vector: along(0, 1) },
					{ path: "c", vector: along(4) },
				],
				0.9,
			),
		).toEqual([["a", "b"]]);
	});

	test("a vector of another length is left out, and does not throw", () => {
		expect(
			closeFiles(
				[
					{ path: "a", vector: along(0) },
					{ path: "a", vector: along(0, 0, 4) },
					{ path: "b", vector: along(0, 0, 4) },
					{ path: "c", vector: along(0) },
				],
				0.9,
			),
		).toEqual([["a", "c"]]);
	});

	test("compares the first files only, so a big project does not stall the page", () => {
		const compared = 400;
		const count = compared + 100;
		const name = (at: number) => `file-${String(at).padStart(5, "0")}`;
		// In pairs: each file is close to its neighbour and to nothing else.
		const vectors = Array.from({ length: count }, (_, at) => ({
			path: name(at),
			vector: (() => {
				const vector = new Float32Array(1024);
				const pair = Math.floor(at / 2);
				vector[pair % 1024] = 1;
				vector[(pair * 7 + 1) % 1024] = 0.5;
				return vector;
			})(),
		}));
		const started = performance.now();
		const pairs = closeFiles(vectors, 0.99);
		const took = performance.now() - started;
		const paths = new Set(pairs.flat());
		expect(paths.has(name(0))).toBe(true);
		expect(paths.has(name(compared - 2))).toBe(true);
		expect(paths.has(name(compared))).toBe(false);
		expect(paths.has(name(count - 1))).toBe(false);
		// Far above what it takes on a quiet computer: this holds on a busy one.
		expect(took).toBeLessThan(10_000);
	});
});
