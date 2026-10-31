import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SynonymEmbeddings } from "../testing/embeddings";
import { adviceOf, EVALUATION, evaluateKnowledge } from "./evaluate";
import { createKnowledgeFolders } from "./folder";
import type { KnowledgeMeaning } from "./meaning";
import type { KnowledgeQuestion } from "./questions";
import { createKnowledgeSearch, type KnowledgeSearch } from "./search";

/**
 * The evaluation over a real index with fake embeddings that know a few
 * synonyms, and the project's setting that turns search by meaning off.
 */

let dataDir: string;
let embeddings: SynonymEmbeddings;
let on: boolean;
let search: KnowledgeSearch;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-evaluate-"));
	const dir = await createKnowledgeFolders(dataDir).ensure("p1");
	await writeFile(join(dir, "cars.md"), "# Garage\n\nAutomobile repair.\n");
	await writeFile(join(dir, "deploy.md"), "# Nights\n\nWe release at night.\n");
	await writeFile(join(dir, "pets.md"), "# Pets\n\nA kitten sleeps.\n");
	embeddings = new SynonymEmbeddings();
	on = true;
	const meaning: KnowledgeMeaning = {
		model: "fake-model",
		embeddings,
		query: (text) => text,
		ready: async () => "ready",
	};
	search = createKnowledgeSearch(dataDir, {
		meaning,
		meaningOn: async () => on,
	});
});
afterEach(async () => {
	search.close();
	await rm(dataDir, { recursive: true, force: true });
});

async function prepared() {
	for (let i = 0; i < 200; i++) {
		if ((await search.meaning("p1")).state === "on") return;
		await Bun.sleep(10);
	}
	throw new Error("The vectors did not come.");
}

const question = (query: string, answer: string): KnowledgeQuestion => ({
	query,
	answers: [answer],
	markedAt: 1,
	by: null,
});

describe("evaluateKnowledge", () => {
	test("gives recall at 5 and each question's first right rank, by words, by meaning and both", async () => {
		await prepared();
		const result = await evaluateKnowledge(
			search,
			"p1",
			[question("vehicle", "cars.md"), question("release night", "deploy.md")],
			() => 42,
		);
		expect(result).toMatchObject({
			at: 42,
			questions: 2,
			k: 5,
			advice: "too-few",
			meaning: { state: "on" },
		});
		expect(result.rows.map((row) => [row.query, row.ranks])).toEqual([
			["vehicle", { words: null, meaning: 1, both: 1 }],
			["release night", { words: 1, meaning: 1, both: 1 }],
		]);
		expect(result.modes.words).toEqual({ found: 1, recall: 0.5, mrr: 0.5 });
		expect(result.modes.meaning).toEqual({ found: 2, recall: 1, mrr: 1 });
		expect(result.modes.both?.found).toBe(2);
	});

	test("with search by meaning turned off, the project is searched by words only, and only words are measured", async () => {
		on = false;
		expect(await search.meaning("p1")).toMatchObject({ state: "turned-off" });
		expect(await search.search("p1", "vehicle")).toEqual([]);
		const result = await evaluateKnowledge(search, "p1", [
			question("release", "deploy.md"),
		]);
		expect(result.advice).toBe("unavailable");
		expect(result.modes).toEqual({
			words: { found: 1, recall: 1, mrr: 1 },
			meaning: null,
			both: null,
		});
		// Its vectors are not prepared either.
		await Bun.sleep(50);
		expect(embeddings.embedded).toBe(0);
		// On again: it gets ready, and finds by meaning.
		on = true;
		await prepared();
		expect((await search.search("p1", "vehicle"))[0]?.path).toBe("cars.md");
	});
});

describe("adviceOf", () => {
	const at = (recall: number) => ({ found: 0, recall, mrr: 0 });
	test("keeps search by meaning from 10 points better on 20 questions, offers to turn it off below", () => {
		const enough = EVALUATION.minQuestions;
		expect(adviceOf(enough, at(0.7), at(0.8))).toBe("keep");
		expect(adviceOf(enough, at(0.7), at(0.79))).toBe("turn-off");
		expect(adviceOf(enough, at(0.9), at(0.85))).toBe("turn-off");
		expect(adviceOf(enough - 1, at(0.1), at(0.9))).toBe("too-few");
		expect(adviceOf(enough, at(0.7), null)).toBe("unavailable");
	});
});
