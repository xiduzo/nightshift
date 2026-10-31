import { Embeddings } from "@langchain/core/embeddings";

/** Each word of a group adds to its own dimension: words of one group mean the same. */
const GROUPS = [
	["car", "automobile", "vehicle"],
	["deploy", "release", "ship"],
	["cat", "kitten", "feline"],
	["money", "cost", "price"],
];

/** Deterministic embeddings that know a few synonyms, and count what they embed. */
export class SynonymEmbeddings extends Embeddings {
	embedded = 0;
	constructor() {
		super({});
	}
	vector(text: string): number[] {
		const out = new Array<number>(GROUPS.length + 1).fill(0);
		out[GROUPS.length] = 0.01;
		for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
			const at = GROUPS.findIndex((group) =>
				group.some((g) => word === g || word === `${g}s`),
			);
			if (at >= 0) out[at] = (out[at] ?? 0) + 1;
		}
		return out;
	}
	async embedDocuments(texts: string[]): Promise<number[][]> {
		this.embedded += texts.length;
		return texts.map((text) => this.vector(text));
	}
	async embedQuery(text: string): Promise<number[]> {
		return this.vector(text);
	}
}
