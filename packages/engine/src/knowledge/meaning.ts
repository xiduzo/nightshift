import {
	Embeddings,
	type EmbeddingsInterface,
} from "@langchain/core/embeddings";
import { OllamaEmbeddings } from "@langchain/ollama";
import { now as timeNow } from "@nightshift/time";

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

/** How long one request of a preparation may hold Ollama, about. */
const PACE_MS = 1_500;
/** Sections in one request, at most: `index()` hands over its batch of 32. */
const PACE_MAX = 32;

/**
 * Embeddings that send a preparation's sections in requests of about
 * `PACE_MS` each, and learn how many sections that is. Ollama answers one
 * request at a time: a batch of 32 sections holds it for minutes on a
 * Host's CPU (about 4 s a section with qwen3-embedding:0.6b), and a query
 * that waits behind it times out. A query goes first: the preparation
 * sends its next request only once the queries have their answer. A LangChain `Embeddings`, so `index()` and the vector
 * store take it as they take any other.
 */
export class PacedEmbeddings extends Embeddings {
	/** Sections in the next request. */
	private size = 4;
	/** Queries on their way: a preparation sends nothing new until they are answered. */
	private queries: Promise<unknown>[] = [];
	constructor(
		readonly inner: EmbeddingsInterface,
		private readonly paceMs = PACE_MS,
		private readonly now: () => number = timeNow,
	) {
		super({});
	}
	async embedDocuments(texts: string[]): Promise<number[][]> {
		const out: number[][] = [];
		for (let at = 0; at < texts.length; ) {
			while (this.queries.length > 0) await Promise.allSettled(this.queries);
			const part = texts.slice(at, at + this.size);
			const started = this.now();
			out.push(...(await this.inner.embedDocuments(part)));
			at += part.length;
			const each = Math.max(1, (this.now() - started) / part.length);
			this.size = Math.max(
				1,
				Math.min(PACE_MAX, Math.floor(this.paceMs / each)),
			);
		}
		return out;
	}
	embedQuery(text: string): Promise<number[]> {
		const query = this.inner.embedQuery(text);
		this.queries.push(query);
		const done = () => {
			this.queries = this.queries.filter((q) => q !== query);
		};
		query.then(done, done);
		return query;
	}
}

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
	const ollama = new OllamaEmbeddings({
		model,
		baseUrl: address,
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		keepAlive: "10m",
		requestOptions: { numCtx: NUM_CTX },
		// A refused connection is not tried six times: the search goes on without it.
		maxRetries: 1,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	const embeddings = new PacedEmbeddings(ollama);
	let checked: { at: number; ready: KnowledgeMeaningReady } | null = null;
	async function check(): Promise<KnowledgeMeaningReady> {
		try {
			const timeout = new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("Ollama did not answer.")),
					PROBE_TIMEOUT_MS,
				).unref?.();
			});
			const { models } = await Promise.race([ollama.client.list(), timeout]);
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
			const now = timeNow();
			// A download moves on: its state is not kept.
			if (
				checked &&
				checked.ready !== "downloading" &&
				now - checked.at < PROBE_TTL_MS
			) {
				return checked.ready;
			}
			const ready = await check();
			checked = { at: timeNow(), ready };
			return ready;
		},
	};
}
