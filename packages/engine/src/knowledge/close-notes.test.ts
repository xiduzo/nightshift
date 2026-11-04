import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import { createSandbox, type Sandbox, waitFor } from "../testing";
import { SynonymEmbeddings } from "../testing/embeddings";
import { testKnowledge } from "../testing/knowledge";
import type { KnowledgeMeaning, KnowledgeMeaningReady } from "./meaning";

/**
 * Which notes that wait are close to another, through the door's `learnings`,
 * as the Review page and the phone read them. The fake model knows that car
 * and vehicle mean the same, and that kitten means something else.
 */

const sandboxes: Sandbox[] = [];
const closes: (() => void)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) close();
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

/** Embeddings that hold each call until the test lets it go, and count the calls. */
class HeldEmbeddings extends SynonymEmbeddings {
	calls = 0;
	release = () => {};
	private readonly held = new Promise<void>((resolve) => {
		this.release = resolve;
	});
	override async embedDocuments(texts: string[]) {
		this.calls++;
		await this.held;
		return super.embedDocuments(texts);
	}
}

function fakeMeaning(
	options: {
		line?: number | null;
		ready?: () => Promise<KnowledgeMeaningReady>;
		embeddings?: SynonymEmbeddings;
		model?: string;
	} = {},
) {
	const embeddings = options.embeddings ?? new SynonymEmbeddings();
	const line = options.line === undefined ? 0.9 : options.line;
	const meaning: KnowledgeMeaning = {
		model: options.model ?? "fake",
		embeddings,
		query: (text) => text,
		ready: options.ready ?? (async () => "ready"),
		...(line !== null ? { closeNotesAt: line } : {}),
	};
	return { meaning, embeddings };
}

async function device(meaning?: KnowledgeMeaning) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const told: string[] = [];
	const open = (given: KnowledgeMeaning | undefined) => {
		const built = testKnowledge(sandbox, {
			pageWaitMs: 5_000,
			...(given ? { meaning: given } : {}),
			notifications: {
				learningsChanged: async (_space, projectId) => {
					told.push(projectId);
				},
			},
		});
		closes.push(built.close);
		return built;
	};
	const built = open(meaning);
	const dir = built.folder("p1");
	return {
		...built,
		told,
		/** A later process over the same files: the index stays, what is in memory does not. */
		restarted: open,
		/** Writes files and puts them in the Space, as a step's end does. From here `told` holds only what came after. */
		publish: async (files: Record<string, string>) => {
			for (const [path, text] of Object.entries(files)) {
				await mkdir(dirname(join(dir, path)), { recursive: true });
				await writeFile(join(dir, path), text);
			}
			await (await built.knowledge.forCommand("p1")).done();
			told.length = 0;
		},
		read: async () => {
			const list = await built.knowledge.learnings(["p1"]);
			return new Map(list.map((learning) => [learning.id, learning]));
		},
	};
}

const CAR = "The car is fast.";
const VEHICLE = "A vehicle is fast.";
const KITTEN = "A kitten sleeps.";

describe("the notes that wait", () => {
	test("show the notes close to each, in waiting and among what was kept", async () => {
		const { meaning } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n- ${KITTEN}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
			"learnings/accepted/run-0.s1.md": `- ${VEHICLE}\n- The price is high.\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });

		const list = await a.read();
		const one = list.get("run-1.s1.md");
		expect(one?.notes).toEqual([CAR, KITTEN]);
		expect(one?.nearTo).toEqual([
			[
				{ id: "run-0.s1.md", note: VEHICLE, kept: true, similarity: 1 },
				{ id: "run-2.s1.md", note: VEHICLE, kept: false, similarity: 1 },
			],
			[],
		]);
		expect(list.get("run-2.s1.md")?.nearTo).toEqual([
			[
				{ id: "run-0.s1.md", note: VEHICLE, kept: true, similarity: 1 },
				{ id: "run-1.s1.md", note: CAR, kept: false, similarity: 1 },
			],
		]);
	});

	test("show the other note of one step too, and no more than the three closest", async () => {
		const { meaning } = fakeMeaning();
		const a = await device(meaning);
		const same = ["Car one.", "Car two.", "Car three.", "Car four.", "Car 5."];
		await a.publish({
			"learnings/proposed/run-1.s1.md": same
				.map((note) => `- ${note}\n`)
				.join(""),
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });

		const nearTo = (await a.read()).get("run-1.s1.md")?.nearTo;
		expect(nearTo?.map((near) => near.length)).toEqual([3, 3, 3, 3, 3]);
		expect(nearTo?.[0]?.[0]?.id).toBe("run-1.s1.md");
		expect(nearTo?.[0]?.map((near) => near.note)).not.toContain("Car one.");
	});

	test("show a note once when another file holds it twice", async () => {
		const { meaning } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n- ${VEHICLE}\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });
		expect((await a.read()).get("run-1.s1.md")?.nearTo).toEqual([
			[{ id: "run-2.s1.md", note: VEHICLE, kept: false, similarity: 1 }],
		]);
	});

	test("that nothing is close to carry no `nearTo`, as before", async () => {
		const { meaning } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${KITTEN}\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });
		for (const learning of (await a.read()).values()) {
			expect("nearTo" in learning).toBe(false);
		}
	});
});

describe("a page's read", () => {
	test("embeds nothing: it comes while the model is busy, and the vectors follow", async () => {
		const embeddings = new HeldEmbeddings();
		const { meaning } = fakeMeaning({ embeddings });
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
		});

		// The model does not answer until `release`, and the reads still end.
		const first = await a.read();
		expect(first.get("run-1.s1.md")?.nearTo).toBeUndefined();
		await waitFor(() => embeddings.calls > 0, { label: "the background" });
		const whileBusy = await a.read();
		expect(whileBusy.get("run-1.s1.md")?.nearTo).toBeUndefined();
		expect(embeddings.calls).toBe(1);
		expect(a.told).toEqual([]);

		embeddings.release();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });
		expect(a.told).toEqual(["p1"]);
		expect((await a.read()).get("run-1.s1.md")?.nearTo?.[0]?.[0]?.note).toBe(
			VEHICLE,
		);
	});

	test("does not ask whether the model is ready: a model that hangs holds nothing", async () => {
		const { meaning } = fakeMeaning({
			ready: () => new Promise<KnowledgeMeaningReady>(() => {}),
		});
		const a = await device(meaning);
		await a.publish({ "learnings/proposed/run-1.s1.md": `- ${CAR}\n` });
		const list = await a.read();
		expect(list.get("run-1.s1.md")?.notes).toEqual([CAR]);
	});

	test("embeds each note once: not at each draw, not after a restart", async () => {
		const { meaning, embeddings } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });
		const embedded = embeddings.embedded;
		expect(embedded).toBe(2);

		await a.read();
		await a.read();
		await Bun.sleep(20);
		expect(embeddings.embedded).toBe(embedded);
		expect(a.told).toEqual(["p1"]);

		a.knowledge.close();
		const later = a.restarted(meaning);
		const list = await later.knowledge.learnings(["p1"]);
		expect(list.some((learning) => learning.nearTo)).toBe(true);
		await Bun.sleep(20);
		expect(embeddings.embedded).toBe(embedded);
	});

	test("a note kept keeps its vector, and only a new note embeds", async () => {
		const { meaning, embeddings } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({ "learnings/proposed/run-1.s1.md": `- ${CAR}\n` });
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });
		expect(embeddings.embedded).toBe(1);

		await a.knowledge.settleLearning("p1", "run-1.s1.md", "keep");
		await a.publish({ "learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n` });
		await a.read();
		await waitFor(() => embeddings.embedded === 2, { label: "the new note" });
		await waitFor(() => a.told.length > 0, { label: "the screens" });

		expect((await a.read()).get("run-2.s1.md")?.nearTo).toEqual([
			[{ id: "run-1.s1.md", note: CAR, kept: true, similarity: 1 }],
		]);
		expect(embeddings.embedded).toBe(2);
	});

	test("a failed embed fails no page, and does not try again at the next draw", async () => {
		const embeddings = new SynonymEmbeddings();
		let tries = 0;
		embeddings.embedDocuments = async () => {
			tries++;
			throw new Error("The model went away.");
		};
		const { meaning } = fakeMeaning({ embeddings });
		const a = await device(meaning);
		await a.publish({ "learnings/proposed/run-1.s1.md": `- ${CAR}\n` });

		expect((await a.read()).get("run-1.s1.md")?.notes).toEqual([CAR]);
		await waitFor(() => tries > 0, { label: "the try" });
		await Bun.sleep(5);
		await a.read();
		await Bun.sleep(20);
		expect(tries).toBe(1);
		expect(a.told).toEqual([]);
	});

	test("the Map's read compares nothing and starts no embed", async () => {
		const { meaning, embeddings } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({ "learnings/proposed/run-1.s1.md": `- ${CAR}\n` });
		await a.knowledge.map("p1");
		await Bun.sleep(20);
		expect(embeddings.embedded).toBe(0);
	});
});

describe("when the notes cannot be compared, the list is as it was", () => {
	const notes = {
		"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
		"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
	};

	async function expectPlain(
		a: Awaited<ReturnType<typeof device>>,
		embeddings?: SynonymEmbeddings,
	) {
		const list = await a.read();
		await Bun.sleep(20);
		expect([...list.keys()].sort()).toEqual(["run-1.s1.md", "run-2.s1.md"]);
		for (const learning of list.values()) {
			expect("nearTo" in learning).toBe(false);
		}
		expect(embeddings?.embedded ?? 0).toBe(0);
		expect(a.told).toEqual([]);
	}

	test("no model is set up", async () => {
		const a = await device();
		await a.publish(notes);
		await expectPlain(a);
	});

	test("nobody measured a line for this model", async () => {
		const { meaning, embeddings } = fakeMeaning({ line: null });
		const a = await device(meaning);
		await a.publish(notes);
		await expectPlain(a, embeddings);
	});

	test("Ollama does not answer", async () => {
		const { meaning, embeddings } = fakeMeaning({
			ready: async () => "no-ollama",
		});
		const a = await device(meaning);
		await a.publish(notes);
		await expectPlain(a, embeddings);
	});

	test("the model is on its way", async () => {
		const { meaning, embeddings } = fakeMeaning({
			ready: async () => "downloading",
		});
		const a = await device(meaning);
		await a.publish(notes);
		await expectPlain(a, embeddings);
	});

	test("a person turned search by meaning off for the project", async () => {
		const { meaning, embeddings } = fakeMeaning();
		const a = await device(meaning);
		await a.publish(notes);
		await a.knowledge.setMeaning("p1", false);
		await expectPlain(a, embeddings);
	});
});

describe("vectors from before", () => {
	test("still count while the model does not answer", async () => {
		let ready: KnowledgeMeaningReady = "ready";
		const { meaning, embeddings } = fakeMeaning({ ready: async () => ready });
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });

		ready = "no-ollama";
		await a.publish({ "learnings/proposed/run-3.s1.md": `- ${KITTEN}\n` });
		const list = await a.read();
		expect(list.get("run-1.s1.md")?.nearTo?.[0]?.[0]?.note).toBe(VEHICLE);
		await Bun.sleep(20);
		expect(embeddings.embedded).toBe(2);
	});

	test("of another model do not: its scale differs, and they embed again", async () => {
		const { meaning } = fakeMeaning();
		const a = await device(meaning);
		await a.publish({
			"learnings/proposed/run-1.s1.md": `- ${CAR}\n`,
			"learnings/proposed/run-2.s1.md": `- ${VEHICLE}\n`,
		});
		await a.read();
		await waitFor(() => a.told.length > 0, { label: "the vectors" });

		a.knowledge.close();
		const other = fakeMeaning({ model: "other" });
		const later = a.restarted(other.meaning);
		a.told.length = 0;
		const first = await later.knowledge.learnings(["p1"]);
		expect(first.some((learning) => learning.nearTo)).toBe(false);
		await waitFor(() => a.told.length > 0, { label: "the new vectors" });
		expect(other.embeddings.embedded).toBe(2);
		const again = await later.knowledge.learnings(["p1"]);
		expect(again.every((learning) => learning.nearTo)).toBe(true);
	});
});
