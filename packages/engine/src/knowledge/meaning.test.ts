import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SynonymEmbeddings } from "../testing/embeddings";
import { watchVectorPreparation } from "../testing/vector-preparation";
import { createKnowledgeFolders } from "./folder";
import {
	type KnowledgeMeaning,
	type KnowledgeMeaningReady,
	ollamaMeaning,
	PacedEmbeddings,
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

/** What each search's preparation did, to wait on it. */
const watches = new WeakMap<
	KnowledgeSearch,
	ReturnType<typeof watchVectorPreparation>
>();

/** A search this file can wait on. */
function open(
	options: Parameters<typeof createKnowledgeSearch>[1] = {},
): KnowledgeSearch {
	const watch = watchVectorPreparation();
	const opened = createKnowledgeSearch(dataDir, {
		onPreparation: watch.onEvent,
		...options,
	});
	watches.set(opened, watch);
	return opened;
}

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
	search = open({ meaning: fake() });
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
	for (let i = 0; i < 20; i++) {
		const status = await of.meaning(projectId);
		if (status.state === "on") return status;
		await watches.get(of)?.settled(projectId);
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
			where: null,
			percent: null,
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

	test("with folders, finds by words and by meaning in those folders only", async () => {
		await put("results/cars.md", FILES["cars.md"]);
		await put("Results/cars.md", FILES["cars.md"]);
		await put("resultsx/cars.md", FILES["cars.md"]);
		await put("books/garage.md", FILES["cars.md"]);
		await put("books/deploy.md", "# Deploy\n\nHow we ship the app.\n");
		await put("results/deploy.md", "# Deploy\n\nHow we ship the app.\n");
		await put("ops.md", FILES["ops.md"]);
		await prepared();
		// Unfiltered, each one is found.
		expect(paths(await search.search("p1", "vehicle storage"))).toContain(
			"results/cars.md",
		);
		const folders = ["books", "ops.md"];
		const meant = await search.search("p1", "vehicle storage", { folders });
		// The fake model has no floor: every file in the folders comes, the closest first.
		expect(paths(meant)).toEqual([
			"books/garage.md",
			"ops.md",
			"books/deploy.md",
		]);
		const both = await search.search("p1", "deploy", { folders });
		expect(paths(both)[0]).toBe("books/deploy.md");
		expect(paths(both).sort()).toEqual([
			"books/deploy.md",
			"books/garage.md",
			"ops.md",
		]);
		const words = await search.search("p1", "garage", {
			folders,
			mode: "words",
		});
		expect(paths(words)).toEqual(["books/garage.md"]);
		expect(await search.search("p1", "deploy", { folders: [] })).toEqual([]);
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
			where: null,
			percent: null,
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
		const plain = open();
		try {
			await put("pets.md", FILES["pets.md"]);
			expect(await plain.meaning("p1")).toEqual({
				state: "off",
				model: null,
				done: 0,
				total: 0,
				where: null,
				percent: null,
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
		search = open({ meaning: fake("other-model") });
		await prepared();
		expect(embeddings.embedded).toBe(4);
	});

	test("a model picked while it runs builds the vectors again, and off turns it off", async () => {
		let now: KnowledgeMeaning | null = fake();
		search.close();
		search = open({ meaning: () => now });
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		expect(embeddings.embedded).toBe(4);

		embeddings.embedded = 0;
		now = fake("other-model");
		const status = await prepared();
		expect(status.model).toBe("other-model");
		expect(embeddings.embedded).toBe(4);
		expect(paths(await search.search("p1", "vehicle storage"))[0]).toBe(
			"cars.md",
		);

		now = null;
		expect((await search.meaning("p1")).state).toBe("off");
		expect(paths(await search.search("p1", "vehicle storage"))).toEqual([]);
	});

	test("while the model downloads, it says how far, and where Ollama is", async () => {
		ready = "downloading";
		search.close();
		search = open({
			meaning: {
				...fake(),
				where: "studio.local",
				downloaded: () => 42,
			},
		});
		await put("pets.md", FILES["pets.md"]);
		expect(await search.meaning("p1")).toEqual({
			state: "downloading",
			model: "fake-model",
			done: 0,
			total: 0,
			where: "studio.local",
			percent: 42,
		});
		expect(paths(await search.search("p1", "kitten"))).toEqual(["pets.md"]);
	});
});

/** Sections long enough that the splitter never merges two of them. */
const long = (heading: string, word: string) =>
	`## ${heading}\n\n${`${word} `.repeat(Math.ceil(1000 / (word.length + 1))).trim()}\n`;

describe("a section's vector", () => {
	test("stays when its section moves: only new text is embedded", async () => {
		await put(
			"guide.md",
			`${long("Start", "note")}\n${long("Cars", "automobile")}\n${long("Cats", "kitten")}`,
		);
		await prepared();
		expect(embeddings.embedded).toBe(3);

		embeddings.embedded = 0;
		await put(
			"guide.md",
			`${long("Start", "note")}\n${long("Money", "price")}\n${long("Cars", "automobile")}\n${long("Cats", "kitten")}`,
		);
		await prepared();
		expect(embeddings.embedded).toBe(1);
		// The hit goes to the section where it stands now.
		const [hit] = await search.search("p1", "vehicle");
		expect(hit).toMatchObject({ path: "guide.md", section: "Cars" });
		expect(hit?.line).toBeGreaterThan(5);
	});

	test("two sections with the same text share a vector, and a hit goes to the first", async () => {
		const same = long("Pets", "kitten");
		await put("twice.md", `${long("Cars", "automobile")}\n${same}\n${same}`);
		const status = await prepared();
		expect(status.total).toBe(3);
		expect(embeddings.embedded).toBe(2);
		const [hit] = await search.search("p1", "feline");
		expect(hit).toMatchObject({ path: "twice.md", section: "Pets", line: 5 });
	});

	test("of a file that changed still finds the file, at its start, until the next preparation", async () => {
		await put("pets.md", FILES["pets.md"]);
		await prepared();
		// Hold the next preparation back: the sections change, the vectors do not.
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const real = embeddings.embedDocuments.bind(embeddings);
		embeddings.embedDocuments = async (texts) => {
			await held;
			return real(texts);
		};
		await put("pets.md", "# Pets\n\nSomething else sleeps here: a cat.\n");
		const hits = await search.search("p1", "feline");
		release();
		expect(hits[0]).toMatchObject({
			path: "pets.md",
			section: null,
			line: 1,
		});
		expect(hits[0]?.snippet[0]?.text).toContain("The kitten sleeps");
		await prepared();
	});
});

describe("a preparation that fails", () => {
	test("says failed, keeps the words working, and comes back on the clock", async () => {
		let clock = 1_000;
		search.close();
		search = open({ meaning: fake(), clock: () => clock });
		const warned = spyOn(console, "warn").mockImplementation(() => {});
		try {
			await put("pets.md", FILES["pets.md"]);
			const real = embeddings.embedDocuments.bind(embeddings);
			embeddings.embedDocuments = async () => {
				throw new Error("Ollama stopped.");
			};
			await search.meaning("p1");
			await watches.get(search)?.settled("p1");
			expect(await search.meaning("p1")).toEqual({
				state: "failed",
				model: "fake-model",
				done: 0,
				total: 1,
				where: null,
				percent: null,
			});
			expect(paths(await search.search("p1", "kitten"))).toEqual(["pets.md"]);

			// Within the wait it stays failed, whoever asks.
			embeddings.embedDocuments = real;
			clock += 59_999;
			expect((await search.meaning("p1")).state).toBe("failed");

			clock += 1;
			expect((await prepared()).state).toBe("on");
		} finally {
			warned.mockRestore();
		}
	});
});

describe("the floor of a model", () => {
	test("a file found by meaning alone must be close enough: a query nothing matches finds nothing", async () => {
		search.close();
		search = open({ meaning: { ...fake(), floor: 0.5 } });
		for (const [path, text] of Object.entries(FILES)) await put(path, text);
		await prepared();
		// Without a floor, every file is a little like any query.
		const loose = open({ meaning: fake() });
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
		const at = { address: "http://127.0.0.1:1" };
		expect(
			ollamaMeaning({ ...at, model: "qwen3-embedding:0.6b" }).closeAt,
		).toBe(0.6);
		expect(
			ollamaMeaning({ ...at, model: "some-other-model" }).closeAt,
		).toBeUndefined();
		expect(ollamaMeaning({ ...at, model: "qwen3-embedding:0.6b" }).floor).toBe(
			0.5,
		);
		// Another size of the model reads its instruction, but its scale was not measured.
		const other = ollamaMeaning({ ...at, model: "qwen3-embedding:4b" });
		expect(other.floor).toBeUndefined();
		expect(other.query("Why?")).toEndWith("Query:Why?");
		expect(
			ollamaMeaning({ ...at, model: "some-other-model" }).query("Why?"),
		).toBe("Why?");
		expect(
			ollamaMeaning({ ...at, model: "some-other-model" }).floor,
		).toBeUndefined();
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
	test("that does not answer makes search by meaning say so, without a throw", async () => {
		const meaning = ollamaMeaning({
			model: "qwen3-embedding:0.6b",
			address: "http://127.0.0.1:1",
		});
		expect(await meaning.ready()).toBe("no-ollama");
		expect(meaning.where).toBeNull();
	});
});

describe("paced embeddings", () => {
	test("send a preparation in requests of about the pace, learned from the last one", async () => {
		let clock = 0;
		const sizes: number[] = [];
		const inner = new SynonymEmbeddings();
		const slow = Object.assign(Object.create(inner), {
			async embedDocuments(texts: string[]) {
				sizes.push(texts.length);
				clock += texts.length * 500; // 500 ms a section
				return inner.embedDocuments(texts);
			},
		}) as SynonymEmbeddings;
		const paced = new PacedEmbeddings(slow, 1_500, () => clock);
		const texts = Array.from({ length: 20 }, (_, i) => `car ${i}`);
		const vectors = await paced.embedDocuments(texts);
		expect(vectors).toHaveLength(20);
		expect(vectors[0]).toEqual(inner.vector("car 0"));
		// Four first, then three a request: 3 × 500 ms is the pace.
		expect(sizes).toEqual([4, 3, 3, 3, 3, 3, 1]);
	});
});

test("paced embeddings let a query go before the next request", async () => {
	const order: string[] = [];
	let answerQuery!: () => void;
	const inner = new SynonymEmbeddings();
	const held = Object.assign(Object.create(inner), {
		async embedDocuments(texts: string[]) {
			order.push(`docs ${texts.length}`);
			await Bun.sleep(5);
			return inner.embedDocuments(texts);
		},
		embedQuery(text: string) {
			order.push("query");
			return new Promise<number[]>((resolve) => {
				answerQuery = () => {
					order.push("answer");
					resolve(inner.vector(text));
				};
			});
		},
	}) as SynonymEmbeddings;
	const paced = new PacedEmbeddings(held, 1_000_000);
	const preparing = paced.embedDocuments(["a", "b", "c", "d", "e"]);
	const query = paced.embedQuery("car");
	await Bun.sleep(20);
	expect(order).toEqual(["docs 4", "query"]);
	answerQuery();
	await query;
	await preparing;
	expect(order).toEqual(["docs 4", "query", "answer", "docs 1"]);
});
