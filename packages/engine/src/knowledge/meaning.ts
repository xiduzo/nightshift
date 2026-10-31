import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { OllamaEmbeddings } from "@langchain/ollama";

/**
 * Search by meaning: an embedding model that turns a section of the
 * knowledge, and a query, into a vector. Search finds the sections whose
 * vectors are close to the query's, besides the ones that have its words.
 *
 * It is on by itself when Ollama answers and has the model: the model,
 * Ollama's address and whether Night Shift starts Ollama are the Ollama
 * vertical's (`ollama/`). Without it, search finds words only, and nothing
 * else changes.
 */

/** Whether this computer can embed now. `downloading`: the model is on its way. */
export type KnowledgeMeaningReady =
	| "ready"
	| "no-ollama"
	| "no-model"
	| "downloading";

/** An embedding model for the knowledge search. Tests pass a fake one. */
export type KnowledgeMeaning = {
	/** The model's name. It is part of the index: a new model builds the vectors again. */
	model: string;
	/** LangChain embeddings for the model. */
	embeddings: EmbeddingsInterface;
	/** A query as the model wants it, for example with an instruction in front. */
	query(text: string): string;
	/** Whether it can embed now. Never throws. */
	ready(): Promise<KnowledgeMeaningReady>;
	/** Where the model runs: null on this computer, else the host name of its Ollama. */
	where?: string | null;
	/** While it is `downloading`: how far the download is, in percent. */
	downloaded?(): number | null;
	/** The least similarity (cosine) of a hit found by meaning alone. Absent: no floor. */
	floor?: number;
};

/**
 * The floor of each model: a file found by meaning alone, and less
 * similar to the query than this, is no hit. Each model has its own
 * scale. How it was chosen: `docs/research/knowledge-vectors.md` §3.4.
 * A model with no floor here (one picked in Settings) gets none.
 */
const MEANING_FLOORS: Readonly<Record<string, number>> = {
	"qwen3-embedding:0.6b": 0.5,
};

/**
 * Ollama's context for the model. With its default of 32K tokens the model
 * takes 4.8 GB of memory, with 2 048 about 1 GB. A section of 1 200
 * characters is far below 2 048 tokens.
 */
const NUM_CTX = 2048;
/** How long a check of Ollama waits for an answer. */
const PROBE_TIMEOUT_MS = 2_000;
/** How long the answer of a check holds before the next one. */
const PROBE_TTL_MS = 15_000;
/** Qwen3 embeddings want an instruction in front of a query, and nothing in front of a document. */
const QUERY_INSTRUCTION =
	"Instruct: Given a question, retrieve passages of project documentation that answer it\nQuery:";

/** A query as the model wants it: an instruction in front for Qwen3, the text as it is for others. */
const queryFor = (model: string) => (text: string) =>
	model.startsWith("qwen3-embedding") ? `${QUERY_INSTRUCTION}${text}` : text;

/**
 * Search by meaning through one Ollama. The Ollama vertical decides the
 * model, the address and its headers, and makes a new one when they change
 * (`createOllama().meaning()`).
 */
export function ollamaMeaning(options: {
	model: string;
	/** Ollama's address, `http://127.0.0.1:11434`. */
	address: string;
	/** Sent with each request, for an Ollama behind a proxy. */
	headers?: Record<string, string>;
	/** Null on this computer, else the host name of the address. */
	where?: string | null;
	/** How far a download of the model is, in percent. Null: none runs. */
	downloading?: () => number | null;
	fetch?: typeof fetch;
}): KnowledgeMeaning {
	const { model, address, headers, where = null, downloading } = options;
	const embeddings = new OllamaEmbeddings({
		model,
		baseUrl: address,
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		keepAlive: "10m",
		requestOptions: { numCtx: NUM_CTX },
		// A refused connection is not tried six times: the search goes on without it.
		maxRetries: 1,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	let checked: { at: number; ready: KnowledgeMeaningReady } | null = null;
	async function check(): Promise<KnowledgeMeaningReady> {
		try {
			const timeout = new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("Ollama did not answer.")),
					PROBE_TIMEOUT_MS,
				).unref?.();
			});
			const { models } = await Promise.race([
				embeddings.client.list(),
				timeout,
			]);
			const names = new Set(models.map((m) => m.name));
			if (names.has(model) || names.has(`${model}:latest`)) return "ready";
			return downloading?.() != null ? "downloading" : "no-model";
		} catch {
			return "no-ollama";
		}
	}
	const floor = MEANING_FLOORS[model];
	return {
		model,
		embeddings,
		query: queryFor(model),
		...(floor !== undefined ? { floor } : {}),
		where,
		downloaded: () => downloading?.() ?? null,
		async ready() {
			const now = Date.now();
			// A download moves on: its state is not kept.
			if (
				checked &&
				checked.ready !== "downloading" &&
				now - checked.at < PROBE_TTL_MS
			) {
				return checked.ready;
			}
			const ready = await check();
			checked = { at: Date.now(), ready };
			return ready;
		},
	};
}
