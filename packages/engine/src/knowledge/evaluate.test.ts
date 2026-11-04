import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SynonymEmbeddings } from "../testing/embeddings";
import { watchVectorPreparation } from "../testing/vector-preparation";
import { adviceOf, EVALUATION, evaluateKnowledge } from "./evaluate";
import { createKnowledgeFolders } from "./folder";
import type { KnowledgeMeaning } from "./meaning";
import type { KnowledgeQuestion } from "./questions";
import {
	createKnowledgeSearch,
	type KnowledgeHit,
	type KnowledgeSearch,
} from "./search";

/**
 * The evaluation over a real index with fake embeddings that know a few
 * synonyms, and the project's setting that turns search by meaning off.
 */

let dataDir: string;
let embeddings: SynonymEmbeddings;
let on: boolean;
let search: KnowledgeSearch;
let watch: ReturnType<typeof watchVectorPreparation>;

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
	watch = watchVectorPreparation();
	search = createKnowledgeSearch(dataDir, {
		meaning,
		meaningOn: async () => on,
		onPreparation: watch.onEvent,
	});
});
afterEach(async () => {
	search.close();
	await rm(dataDir, { recursive: true, force: true });
});

async function prepared() {
	for (let i = 0; i < 20; i++) {
		if ((await search.meaning("p1")).state === "on") return;
		await watch.settled("p1");
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
		expect(result.modes.words).toEqual({
			found: 1,
			recall: 0.5,
			mrr: 0.5,
			allFound: 1,
			ndcg: 0.5,
		});
		expect(result.modes.meaning).toEqual({
			found: 2,
			recall: 1,
			mrr: 1,
			allFound: 2,
			ndcg: 1,
		});
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
			words: { found: 1, recall: 1, mrr: 1, allFound: 1, ndcg: 1 },
			meaning: null,
			both: null,
		});
		// Its vectors are not prepared either.
		expect(await watch.settled("p1")).toBe("idle");
		expect(embeddings.embedded).toBe(0);
		// On again: it gets ready, and finds by meaning.
		on = true;
		await prepared();
		expect((await search.search("p1", "vehicle"))[0]?.path).toBe("cars.md");
	});
});

describe("a question with several right files", () => {
	/** A search that ranks these paths, whatever the query or the way to search. */
	const ranking = (ranked: Record<string, string[]>) => ({
		meaning: search.meaning,
		search: async (_projectId: string, query: string) =>
			(ranked[query] ?? []).map((path) => ({ path }) as KnowledgeHit),
	});
	const asked = (query: string, ...answers: string[]): KnowledgeQuestion => ({
		...question(query, ""),
		answers,
	});
	const fill = (n: number) =>
		Array.from({ length: n }, (_, i) => `other-${i}.md`);

	test("recall counts one right file, all-found counts them all, nDCG counts each by its rank", async () => {
		const result = await evaluateKnowledge(
			ranking({
				one: ["a.md", "other.md", "b.md"],
				two: ["a.md", ...fill(6), "b.md"],
			}),
			"p1",
			[asked("one", "a.md", "b.md"), asked("two", "a.md", "b.md")],
		);
		const words = result.modes.words;
		expect(words?.found).toBe(2);
		expect(words?.recall).toBe(1);
		// The second question has its other right file at rank 8.
		expect(words?.allFound).toBe(1);
		const gain = (rank: number) => 1 / Math.log2(rank + 1);
		const ideal = gain(1) + gain(2);
		expect(words?.ndcg).toBeCloseTo(
			((gain(1) + gain(3)) / ideal + (gain(1) + gain(8)) / ideal) / 2,
			6,
		);
		expect(result.rows[1]?.ranks.words).toBe(1);
	});

	test("nDCG stops at 10, and the first right rank looks deeper", async () => {
		const result = await evaluateKnowledge(
			ranking({ deep: [...fill(10), "a.md"] }),
			"p1",
			[asked("deep", "a.md")],
		);
		expect(result.rows[0]?.ranks.words).toBe(11);
		expect(result.modes.words?.ndcg).toBe(0);
		expect(result.modes.words?.mrr).toBeCloseTo(1 / 11, 6);
	});

	test("the advice reads recall only", async () => {
		const good = { found: 1, recall: 0.9, mrr: 1, allFound: 1, ndcg: 1 };
		const poor = { found: 1, recall: 0.5, mrr: 0, allFound: 0, ndcg: 0 };
		expect(adviceOf(EVALUATION.minQuestions, poor, good)).toBe("keep");
		expect(adviceOf(EVALUATION.minQuestions, good, { ...good, ndcg: 0 })).toBe(
			"turn-off",
		);
	});
});

describe("adviceOf", () => {
	const at = (recall: number) => ({
		found: 0,
		recall,
		mrr: 0,
		allFound: 0,
		ndcg: 0,
	});
	test("keeps search by meaning from 10 points better on 20 questions, offers to turn it off below", () => {
		const enough = EVALUATION.minQuestions;
		expect(adviceOf(enough, at(0.7), at(0.8))).toBe("keep");
		expect(adviceOf(enough, at(0.7), at(0.79))).toBe("turn-off");
		expect(adviceOf(enough, at(0.9), at(0.85))).toBe("turn-off");
		expect(adviceOf(enough - 1, at(0.1), at(0.9))).toBe("too-few");
		expect(adviceOf(enough, at(0.7), null)).toBe("unavailable");
	});
});
