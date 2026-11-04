import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document } from "@langchain/core/documents";
import { SynonymEmbeddings } from "../testing/embeddings";
import { watchVectorPreparation } from "../testing/vector-preparation";
import type { KnowledgeMeaning, KnowledgeMeaningReady } from "./meaning";
import { createSearchStore, type SearchStore } from "./search-store";
import { sectionId } from "./sections";
import { createVectorPreparation, RETRY_MS } from "./vector-preparation";

/** Embeddings a test holds and fails at will, to stand in a transition. */
class HeldEmbeddings extends SynonymEmbeddings {
	/** Calls to `embedDocuments` that throw before they embed, from the next on. */
	failing: ((call: number) => boolean) | null = null;
	calls = 0;
	private held: Promise<void> | null = null;
	private entered: (() => void) | null = null;
	private release: (() => void) | null = null;

	/** The next call to `embedDocuments` waits. Resolves when it arrives. */
	hold(): { arrived: Promise<void>; release: () => void } {
		const arrived = new Promise<void>((resolve) => {
			this.entered = resolve;
		});
		this.held = new Promise<void>((resolve) => {
			this.release = resolve;
		});
		return {
			arrived,
			release: () => {
				this.held = null;
				this.release?.();
			},
		};
	}

	override async embedDocuments(texts: string[]): Promise<number[][]> {
		this.calls += 1;
		if (this.held) {
			this.entered?.();
			await this.held;
		}
		if (this.failing?.(this.calls)) throw new Error("Ollama stopped.");
		return super.embedDocuments(texts);
	}
}

let dataDir: string;
let store: SearchStore;
let clock: number;
let embeddings: HeldEmbeddings;
let ready: KnowledgeMeaningReady;
let setting: boolean;
let model: KnowledgeMeaning | null;
let watch: ReturnType<typeof watchVectorPreparation>;
let preparation: ReturnType<typeof createVectorPreparation>;
let warned: ReturnType<typeof spyOn>;

const named = (name: string, with_ = embeddings): KnowledgeMeaning => ({
	model: name,
	embeddings: with_,
	query: (text) => text,
	ready: async () => ready,
});

/** Puts a file of these sections in the store, as a refresh does. */
function write(projectId: string, path: string, texts: string[], id = 1) {
	const known = store.files(projectId).get(path);
	store.writeFiles(projectId, [
		{
			file: { path, title: path, size: id, changedAt: id } as never,
			row: known,
			same: false,
			sha256: `sha-${id}`,
			title: path,
			sections: texts.map(
				(text, line) =>
					new Document({
						pageContent: text,
						metadata: {
							path,
							heading: null,
							headingPath: "",
							line: line + 1,
							page: null,
						},
					}),
			),
		},
	]);
}

const vectorsOf = (projectId: string) =>
	store.vectorsFor(projectId, model as KnowledgeMeaning);

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-preparation-"));
	clock = 1_000;
	embeddings = new HeldEmbeddings();
	ready = "ready";
	setting = true;
	model = named("fake-model");
	watch = watchVectorPreparation();
	store = createSearchStore(dataDir, {
		onVectorsGone: () => preparation.vectorsGone(),
	});
	preparation = createVectorPreparation({
		store,
		model: () => model,
		meaningOn: async () => setting,
		clock: () => clock,
		onEvent: watch.onEvent,
	});
	await store.open();
	warned = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
	warned.mockRestore();
	store.close();
	await rm(dataDir, { recursive: true, force: true });
});

describe("a project's state", () => {
	test("goes from idle through the queue to ready, on the injected clock", async () => {
		write("p1", "a.md", ["A car."]);
		expect(preparation.stateOf("p1")).toBe("idle");
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("queued");
		expect(await watch.settled("p1")).toBe("ready");
		expect(watch.events.map(({ from, to, at }) => ({ from, to, at }))).toEqual([
			{ from: "idle", to: "queued", at: 1_000 },
			{ from: "queued", to: "preparing", at: 1_000 },
			{ from: "preparing", to: "ready", at: 1_000 },
		]);
		expect(embeddings.embedded).toBe(1);
	});

	test("asks nothing of the model when it is ready and nothing changed", async () => {
		write("p1", "a.md", ["A car."]);
		preparation.request("p1");
		await watch.settled("p1");
		const events = watch.events.length;
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("ready");
		expect(watch.events).toHaveLength(events);
	});

	test("changed sections put it back, and only a request prepares it again", async () => {
		write("p1", "a.md", ["A car."]);
		preparation.request("p1");
		await watch.settled("p1");
		write("p1", "a.md", ["A car.", "A kitten."], 2);
		preparation.sectionsChanged("p1");
		expect(preparation.stateOf("p1")).toBe("idle");
		expect(embeddings.embedded).toBe(1);
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("ready");
		expect(embeddings.embedded).toBe(2);
	});

	test("sections that change during a preparation run it again", async () => {
		write("p1", "a.md", ["A car."]);
		const held = embeddings.hold();
		preparation.request("p1");
		await held.arrived;
		expect(preparation.stateOf("p1")).toBe("preparing");
		write("p1", "b.md", ["A kitten."]);
		preparation.sectionsChanged("p1");
		expect(preparation.stateOf("p1")).toBe("preparing");
		held.release();
		await watch.until("p1", (state) => state === "ready");
		expect(embeddings.embedded).toBe(2);
		expect(vectorsOf("p1").count()).toBe(2);
	});

	test("one project at a time", async () => {
		write("p1", "a.md", ["A car."]);
		write("p2", "b.md", ["A kitten."]);
		const held = embeddings.hold();
		preparation.request("p1");
		preparation.request("p2");
		await held.arrived;
		expect(preparation.stateOf("p1")).toBe("preparing");
		expect(preparation.stateOf("p2")).toBe("queued");
		held.release();
		expect(await watch.settled("p1")).toBe("ready");
		expect(await watch.settled("p2")).toBe("ready");
	});

	test("cannot start while the model is not ready, and nothing fails", async () => {
		write("p1", "a.md", ["A car."]);
		ready = "no-ollama";
		const info = spyOn(console, "info").mockImplementation(() => {});
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("idle");
		expect(embeddings.embedded).toBe(0);
		expect(warned).not.toHaveBeenCalled();
		ready = "ready";
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("ready");
		info.mockRestore();
	});

	test("stays idle without a model", () => {
		model = null;
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("idle");
		expect(watch.events).toEqual([]);
	});
});

describe("a failed preparation", () => {
	test("is kept and said, tries again only after the wait, and keeps what it embedded", async () => {
		// More sections than one call to `index()` takes: the second call fails.
		const sections = Array.from(
			{ length: 40 },
			(_, i) => `A car, number ${i}.`,
		);
		write("p1", "a.md", sections);
		embeddings.failing = (call) => call === 2;
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("failed");
		expect(String(watch.events.at(-1)?.error)).toContain("Ollama stopped.");
		expect(warned).toHaveBeenCalledTimes(1);
		const kept = embeddings.embedded;
		expect(kept).toBe(32);
		expect(vectorsOf("p1").count()).toBe(32);

		// Not yet: a request does nothing during the wait.
		clock += RETRY_MS - 1;
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("failed");

		// Changed sections do not skip the wait.
		preparation.sectionsChanged("p1");
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("failed");

		clock += 1;
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("queued");
		expect(await watch.settled("p1")).toBe("ready");
		// Only what the failure left: the rest is not embedded twice.
		expect(embeddings.embedded).toBe(40);
		expect(vectorsOf("p1").count()).toBe(40);
	});

	test("that fails again waits again, from the new failure", async () => {
		write("p1", "a.md", ["A car."]);
		embeddings.failing = () => true;
		preparation.request("p1");
		await watch.settled("p1");
		clock += RETRY_MS;
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("failed");
		clock += RETRY_MS - 1;
		preparation.request("p1");
		expect(preparation.stateOf("p1")).toBe("failed");
	});

	test("another model does not wait: the failure says nothing about it", async () => {
		write("p1", "a.md", ["A car."]);
		embeddings.failing = () => true;
		preparation.request("p1");
		await watch.settled("p1");
		embeddings.failing = null;
		model = named("other-model");
		vectorsOf("p1");
		expect(preparation.stateOf("p1")).toBe("idle");
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("ready");
	});

	test("when the index closes under it, it did not fail", async () => {
		write("p1", "a.md", ["A car."]);
		const held = embeddings.hold();
		preparation.request("p1");
		await held.arrived;
		store.close();
		held.release();
		expect(await watch.settled("p1")).toBe("idle");
		expect(warned).not.toHaveBeenCalled();
	});
});

describe("a model change during a preparation", () => {
	test("throws the mixed vectors away, and the new model builds them", async () => {
		write("p1", "a.md", ["A car.", "A kitten."]);
		const held = embeddings.hold();
		preparation.request("p1");
		await held.arrived;

		// A search asks for the other model while the first one embeds.
		const other = new HeldEmbeddings();
		model = named("other-model", other);
		vectorsOf("p1");
		expect(preparation.stateOf("p1")).toBe("preparing");
		held.release();

		await watch.until("p1", (state) => state === "ready");
		expect(store.vectorModel()).toBe("other-model");
		expect(embeddings.embedded).toBe(2);
		expect(other.embedded).toBe(2);
		expect(vectorsOf("p1").count()).toBe(2);
	});

	test("makes a ready project idle, and it prepares when someone looks", async () => {
		write("p1", "a.md", ["A car."]);
		write("p2", "b.md", ["A kitten."]);
		preparation.request("p1");
		preparation.request("p2");
		await watch.settled("p1");
		await watch.settled("p2");
		embeddings.embedded = 0;

		model = named("other-model");
		vectorsOf("p1");
		expect(preparation.stateOf("p1")).toBe("idle");
		expect(preparation.stateOf("p2")).toBe("idle");
		preparation.request("p1");
		await watch.settled("p1");
		// The other project costs nothing until someone looks at it.
		expect(embeddings.embedded).toBe(1);
		expect(preparation.stateOf("p2")).toBe("idle");
	});
});

describe("the setting", () => {
	test("is read when the turn comes, not when the project is queued", async () => {
		write("p1", "a.md", ["A car."]);
		write("p2", "b.md", ["A kitten."]);
		const held = embeddings.hold();
		preparation.request("p1");
		preparation.request("p2");
		await held.arrived;
		// Turned off while it waits behind the other project.
		setting = false;
		held.release();
		expect(await watch.settled("p2")).toBe("idle");
		expect(embeddings.embedded).toBe(1);
		expect(vectorsOf("p2").count()).toBe(0);
	});

	test("is not kept: off, then on, and the next request prepares", async () => {
		write("p1", "a.md", ["A car."]);
		setting = false;
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("idle");
		expect(embeddings.embedded).toBe(0);
		setting = true;
		preparation.request("p1");
		expect(await watch.settled("p1")).toBe("ready");
		expect(embeddings.embedded).toBe(1);
	});
});

describe("a vector's metadata", () => {
	test("holds the section's id and its path, nothing that moves", async () => {
		write("p1", "a.md", ["A car."]);
		preparation.request("p1");
		await watch.settled("p1");
		const [hit] = await vectorsOf("p1").similaritySearchVectorWithScore(
			embeddings.vector("car"),
			1,
		);
		expect(hit?.[0].metadata).toEqual({
			path: "a.md",
			section_id: sectionId("a.md", "a.md", "", "A car."),
		});
	});
});
