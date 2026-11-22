import { describe, expect, test } from "bun:test";
import { SynonymEmbeddings } from "../testing/embeddings";
import { ollamaEmbedder, PacedEmbeddings } from "./embedder";

describe("Ollama", () => {
	test("that does not answer makes search by meaning say so, without a throw", async () => {
		const meaning = ollamaEmbedder({
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
