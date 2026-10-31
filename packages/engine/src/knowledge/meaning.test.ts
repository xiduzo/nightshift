import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SynonymEmbeddings } from "../testing/embeddings";
import { createKnowledgeFolders } from "./folder";
import {
	type KnowledgeMeaning,
	type KnowledgeMeaningReady,
	ollamaAddress,
	ollamaMeaning,
} from "./meaning";
import {
	createKnowledgeSearch,
	fuseRanks,
	type KnowledgeHit,
	type KnowledgeSearch,
} from "./search";

let dataDir: string;
let dir: string;
let embeddings: SynonymEmbeddings;
let ready: KnowledgeMeaningReady;
let search: KnowledgeSearch;

const fake = (model = "fake-model"): KnowledgeMeaning => ({
	model,
	embeddings,
	query: (text) => text,
	ready: async () => ready,
});

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-meaning-"));
	dir = await createKnowledgeFolders(dataDir).ensure("p1");
	embeddings = new SynonymEmbeddings();
	ready = "ready";
	search = createKnowledgeSearch(dataDir, { meaning: fake() });
});
afterEach(async () => {
	search.close();
	await rm(dataDir, { recursive: true, force: true });
});

const put = async (path: string, text: string) => {
	await mkdir(join(dir, path, ".."), { recursive: true });
	await writeFile(join(dir, path), text);
};
const paths = (hits: KnowledgeHit[]) => hits.map((hit) => hit.path);

/** Waits until the project's vectors are all there. */
async function prepared(of: KnowledgeSearch = search, projectId = "p1") {
	for (let i = 0; i < 200; i++) {
		const status = await of.meaning(projectId);
		if (status.state === "on") return status;
		await Bun.sleep(10);
	}
	throw new Error("The vectors did not come.");
}

const FILES = {
	"cars.md": `# Garage\n\n${"Notes on the garage. ".repeat(55)}\n\n## Parking\n\nWhere to leave an automobile at night.\n`,
	"pets.md": "# Pets\n\nThe kitten sleeps all day.\n",
	"ops.md": "# Operations\n\nWe release on Fridays, never on Mondays.\n",
};

describe("search by meaning", () => {
	test("finds a file by meaning when its words are not there, at its section", async () => {
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		expect((await search.meaning("p1")).state).toMatch(/preparing|on/);
		const status = await prepared();
		expect(status).toEqual({
			state: "on",
			model: "fake-model",
			done: 4,
			total: 4,
		});

		const hits = await search.search("p1", "vehicle storage");
		expect(hits[0]).toMatchObject({
			path: "cars.md",
			title: "Garage",
			section: "Parking",
			found: ["meaning"],
		});
		expect(hits[0]?.snippet).toEqual([
			{ text: "Where to leave an automobile at night.", match: false },
		]);
		expect(hits[0]?.score).toBeGreaterThan(0);
	});

	test("fuses words and meaning: a file both find comes first", async () => {
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await put("deploy.md", "# Deploy\n\nHow we ship the app.\n");
		await prepared();
		const hits = await search.search("p1", "deploy");
		expect(hits[0]).toMatchObject({
			path: "deploy.md",
			found: ["words", "meaning"],
		});
		expect(paths(hits)).toContain("ops.md");
		expect(hits.find((hit) => hit.path === "ops.md")?.found).toEqual([
			"meaning",
		]);
		const scores = hits.map((hit) => hit.score);
		expect([...scores].sort((a, b) => b - a)).toEqual(scores);
	});

	test("embeds only what changed, and forgets a file that went", async () => {
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		expect(embeddings.embedded).toBe(4);

		embeddings.embedded = 0;
		await put("pets.md", "# Pets\n\nThe feline sleeps all day.\n");
		await rm(join(dir, "ops.md"));
		await search.refresh("p1");
		await prepared();
		expect(embeddings.embedded).toBe(1);
		expect(paths(await search.search("p1", "release"))).not.toContain("ops.md");
		expect((await search.meaning("p1")).total).toBe(3);
	});

	test("without Ollama, it finds by words only and says how it stands", async () => {
		ready = "no-ollama";
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		expect(await search.meaning("p1")).toEqual({
			state: "no-ollama",
			model: "fake-model",
			done: 0,
			total: 0,
		});
		expect(await search.search("p1", "vehicle storage")).toEqual([]);
		expect(paths(await search.search("p1", "kitten"))).toEqual(["pets.md"]);
		expect(embeddings.embedded).toBe(0);

		ready = "no-model";
		expect((await search.meaning("p1")).state).toBe("no-model");

		// Ollama comes: the vectors follow, and meaning finds again.
		ready = "ready";
		await prepared();
		expect(paths(await search.search("p1", "vehicle storage"))[0]).toBe(
			"cars.md",
		);
	});

	test("a query whose vector does not come is found by words", async () => {
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		embeddings.embedQuery = async () => {
			throw new Error("Ollama went away");
		};
		expect(paths(await search.search("p1", "kitten"))).toEqual(["pets.md"]);
	});

	test("without a model it is off, and finds by words", async () => {
		const plain = createKnowledgeSearch(dataDir);
		try {
			await put("pets.md", FILES["pets.md"]);
			expect(await plain.meaning("p1")).toEqual({
				state: "off",
				model: null,
				done: 0,
				total: 0,
			});
			expect(await plain.search("p1", "kitten")).toMatchObject([
				{ path: "pets.md", found: ["words"], section: "Pets", line: 1 },
			]);
		} finally {
			plain.close();
		}
	});

	test("another model builds the vectors again", async () => {
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		search.close();
		embeddings.embedded = 0;
		search = createKnowledgeSearch(dataDir, { meaning: fake("other-model") });
		await prepared();
		expect(embeddings.embedded).toBe(4);
	});
});

describe("the floor of a model", () => {
	test("a file found by meaning alone must be close enough: a query nothing matches finds nothing", async () => {
		search.close();
		search = createKnowledgeSearch(dataDir, {
			meaning: { ...fake(), floor: 0.5 },
		});
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		// Without a floor, every file is a little like any query.
		const loose = createKnowledgeSearch(dataDir, { meaning: fake() });
		await prepared(loose);
		expect(paths(await loose.search("p1", "money"))).toHaveLength(3);
		loose.close();

		expect(await search.search("p1", "money")).toEqual([]);
		expect(paths(await search.search("p1", "vehicle"))).toEqual(["cars.md"]);
		// A file the words find stays, however far its meaning.
		const fridays = await search.search("p1", "Fridays");
		expect(fridays[0]?.path).toBe("ops.md");
	});

	test("qwen3-embedding has its floor, a model without one has none", () => {
		expect(ollamaMeaning("qwen3-embedding:0.6b").floor).toBe(0.5);
		expect(ollamaMeaning("some-other-model").floor).toBeUndefined();
	});
});

describe("reciprocal rank fusion", () => {
	test("adds 1 / (60 + rank) from each list, best first", () => {
		const fused = fuseRanks([
			["a", "b", "c"],
			["c", "a"],
		]);
		expect(fused.map((f) => f.key)).toEqual(["a", "c", "b"]);
		expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
		expect(fused[1]?.score).toBeCloseTo(1 / 63 + 1 / 61);
		expect(fused[2]?.score).toBeCloseTo(1 / 62);
	});

	test("keeps the first list's order on a tie, and takes empty lists", () => {
		expect(fuseRanks([["a"], ["b"]]).map((f) => f.key)).toEqual(["a", "b"]);
		expect(fuseRanks([[], []])).toEqual([]);
	});
});

describe("Ollama", () => {
	test("is at OLLAMA_HOST, else at its default address", () => {
		expect(ollamaAddress({})).toBe("http://127.0.0.1:11434");
		expect(ollamaAddress({ OLLAMA_HOST: " http://studio.local:11500 " })).toBe(
			"http://studio.local:11500",
		);
	});

	test("that does not answer makes search by meaning say so, without a throw", async () => {
		const host = process.env.OLLAMA_HOST;
		process.env.OLLAMA_HOST = "http://127.0.0.1:1";
		try {
			expect(await ollamaMeaning().ready()).toBe("no-ollama");
		} finally {
			if (host === undefined) delete process.env.OLLAMA_HOST;
			else process.env.OLLAMA_HOST = host;
		}
	});
});
