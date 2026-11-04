import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Embeddings } from "@langchain/core/embeddings";
import type { AgentEvent } from "@nightshift/agents/types";
import { event, project } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import type { ArchiveHost } from "../archive";
import { OLDER_HOST, OlderHostError } from "../contract";
import { createSandbox, type Sandbox, waitFor } from "../testing";
import { testKnowledge } from "../testing/knowledge";
import { otherSpace } from "../testing/test-support";
import type { UsageMoment } from "../usage";
import type { KnowledgeMeaning } from "./meaning";

/**
 * A project's knowledge on a Device, through the one door the daemon hands
 * out: what a step gets, the order of the reconciles around it, and what
 * the API and the terminal ask of it.
 */

const sandboxes: Sandbox[] = [];
const closes: (() => void)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) close();
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

/** A Host's archive in memory: content by hash, and the Spaces it came in. */
function memoryHost(): ArchiveHost & { spaces: Set<string> } {
	const kept = new Map<string, Uint8Array>();
	const spaces = new Set<string>();
	return {
		spaces,
		async archivePut({ ref, content }) {
			if (ref.kind !== "content" || typeof content === "string") return false;
			kept.set(ref.sha256, content.slice());
			spaces.add(ref.spaceId);
			return true;
		},
		async archiveGet(ref) {
			return ref.kind === "content"
				? (kept.get(ref.sha256)?.slice() ?? null)
				: null;
		},
	};
}

/** A Device with project p1, connected to `host`. */
async function device(
	host: ArchiveHost,
	options: Pick<
		Parameters<typeof testKnowledge>[1] & {},
		"meaning" | "timers" | "usage"
	> = {},
) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const built = testKnowledge(sandbox, { pageWaitMs: 5_000, ...options });
	closes.push(built.close);
	built.archive.connect(host);
	built.knowledge.connect({ inStep: async () => {} });
	const dir = built.folder("p1");
	return {
		...built,
		sandbox,
		dir,
		put: async (path: string, text: string) => {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), text);
		},
		paths: async () => [...(await built.documents.open("p1")).entries().keys()],
	};
}

describe("the size of the knowledge documents", () => {
	test("goes to the usage notes on a timer, by project, until `close`", async () => {
		const moments: UsageMoment[] = [];
		const a = await device(memoryHost(), {
			timers: { firstReconcileMs: 60_000, firstMeasureMs: 1, measureMs: 5 },
			usage: { note: (moment) => moments.push(moment) },
		});
		await a.put("wiki/Home.md", "# Home\n");
		await (await a.knowledge.forCommand("p1")).done();

		await waitFor(() => moments.length > 0);
		expect(moments[0]).toEqual({
			kind: "knowledge-document-measured",
			projectId: "p1",
			bytes: expect.any(Number),
		});

		a.knowledge.close();
		await Bun.sleep(20);
		const seen = moments.length;
		await Bun.sleep(20);
		expect(moments).toHaveLength(seen);
	});
});

describe("a step's knowledge", () => {
	// `bun --hot` makes a new Knowledge beside a step that goes on: the daemon
	// keeps one `KnowledgeFolderLocks` across the reload.
	test("a Knowledge made beside a running step leaves its folder alone", async () => {
		const a = await device(memoryHost());
		const step = await a.knowledge.forCommand("p1");
		await a.put("wiki/Page.md", "# Pa");

		const reloaded = testKnowledge(a.sandbox, {
			pageWaitMs: 5_000,
			folderLocks: a.folderLocks,
			archive: a.archive,
			synced: a.synced,
		});
		closes.push(reloaded.close);
		const listing = await reloaded.knowledge.listing("p1");
		expect(listing.files).toEqual([]);
		expect(await a.paths()).toEqual([]);

		await step.done();
		expect(await a.paths()).toEqual(["wiki/Page.md"]);
	});

	test("while a sync writes the folder, the page and the timers leave it alone: its end publishes", async () => {
		const a = await device(memoryHost(), {
			timers: { firstReconcileMs: 1, retryMs: 1 },
		});
		await a.put("wiki/Home.md", "# Home\n");
		const sync = await a.knowledge.forCommand("p1");
		expect(sync.env).toEqual({ NS_KNOWLEDGE: a.dir });
		// The reconcile before the step published what was there.
		expect(await a.paths()).toEqual(["wiki/Home.md"]);

		// The sync writes: half a file, as `jq > page.md` leaves it, and a
		// staging file.
		await a.put("wiki/Page.md", "# Pa");
		await a.put("wiki/Next.md.part", "# Ne");
		const listing = await a.knowledge.listing("p1");
		expect(listing.files.map((f) => f.path)).toEqual(["wiki/Home.md"]);
		await Bun.sleep(20);
		expect(await a.paths()).toEqual(["wiki/Home.md"]);

		// An agent of another run shares the folder: the first to end does
		// not reconcile, the last one does.
		const agent = await a.knowledge.forSession({
			knowledge: { projectId: "p1" },
		});
		await sync.done();
		expect(await a.paths()).toEqual(["wiki/Home.md"]);
		await a.put("wiki/Page.md", "# Page\n");
		await agent.done();
		// A second `done` changes nothing.
		await agent.done();
		expect(await a.paths()).toEqual(["wiki/Home.md", "wiki/Page.md"]);
	});

	test("an agent reads a file its folder lacks by its hash, as the API does: text from a PDF too, never a proposal", async () => {
		const host = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n\nThe wiki.\n");
		await a.put("learnings/proposed/run-1.md", "- Use bun.\n");
		await a.knowledge.listing("p1");
		// B's document has A's entries, as a Link brings them; its folder does not.
		applyUpdate(
			(await b.persisted("p1")).doc,
			encodeStateAsUpdate((await a.persisted("p1")).doc),
		);
		const session = await b.knowledge.forSession(
			{ knowledge: { projectId: "p1", always: true } },
			{ runId: "run-2" },
		);
		await session.done();
		expect(session.contribution.addDirs).toEqual([b.dir]);
		expect(session.contribution.report).toEqual({ learnings: true });
		const read = session.contribution.tools?.find(
			(tool) => tool.name === "read_knowledge",
		);
		const call = async (path: string) =>
			String(await read?.execute?.({ path }));
		// The reconciles of the step wrote Home.md into B's folder: without
		// it, the read goes by hash.
		await rm(join(b.dir, "wiki"), { recursive: true, force: true });
		expect(await call("wiki/Home.md")).toBe(
			"wiki/Home.md: Home\n\n# Home\n\nThe wiki.\n",
		);
		expect(await call("learnings/proposed/run-1.md")).toContain(
			'has no file "learnings/proposed/run-1.md"',
		);
		expect(
			await b.knowledge.read("p1", "wiki/Home.md", { maxBytes: 1024 }),
		).toMatchObject({
			title: "Home",
			text: "# Home\n\nThe wiki.\n",
		});
	});

	test("the agent's searches and reads go out before the session's next event, with what they found", async () => {
		const a = await device(memoryHost());
		await a.put("wiki/deploy.md", "# Deploy\n\nWe deploy at night.\n");
		const session = await a.knowledge.forSession(
			{ knowledge: { projectId: "p1" } },
			{ runId: "run-1" },
		);
		const tool = (name: string) =>
			session.contribution.tools?.find((t) => t.name === name);
		async function* harness(): AsyncGenerator<AgentEvent> {
			await tool("search_knowledge")?.execute?.({ query: "deploy" });
			await tool("read_knowledge")?.execute?.({ path: "wiki/deploy.md" });
			await tool("read_knowledge")?.execute?.({ path: "wiki/gone.md" });
			yield { type: "tool-result", toolCallId: "t1", content: "found" };
			yield { type: "finished" };
		}
		const seen: string[] = [];
		const uses: unknown[] = [];
		for await (const event of session.events(harness())) {
			seen.push(event.type);
			if (event.type === "knowledge") uses.push(event);
		}
		await session.done();
		expect(seen).toEqual([
			"knowledge",
			"knowledge",
			"knowledge",
			"tool-result",
			"finished",
		]);
		expect(uses).toEqual([
			{
				type: "knowledge",
				projectId: "p1",
				use: {
					kind: "search",
					query: "deploy",
					hits: [
						{
							path: "wiki/deploy.md",
							section: "Deploy",
							line: 1,
							page: null,
							found: ["words"],
						},
					],
				},
			},
			{
				type: "knowledge",
				projectId: "p1",
				use: { kind: "read", path: "wiki/deploy.md", found: true },
			},
			{
				type: "knowledge",
				projectId: "p1",
				use: { kind: "read", path: "wiki/gone.md", found: false },
			},
		]);
	});
});

describe("a Host of an older version", () => {
	test("gets a plain message, not a failed sync: the Device works on its own copy and does not ask again for a while", async () => {
		let calls = 0;
		const older: ArchiveHost = {
			async archivePut() {
				calls++;
				throw new OlderHostError();
			},
			async archiveGet() {
				calls++;
				throw new OlderHostError();
			},
		};
		const a = await device(older);
		await a.put("wiki/Home.md", "# Home\n");
		const first = await a.knowledge.listing("p1");
		expect(first.olderHost).toBe(true);
		// The step goes on: its files are in the document of this Device.
		expect(first.files.map((f) => f.path)).toEqual(["wiki/Home.md"]);
		expect(calls).toBe(1);

		await a.put("wiki/Next.md", "# Next\n");
		const step = await a.knowledge.forCommand("p1");
		await step.done();
		expect(calls).toBe(1);
		expect(await a.paths()).toContain("wiki/Next.md");

		// A file another Device listed cannot come from that Host: it says why.
		const b = await device(older);
		applyUpdate(
			(await b.persisted("p1")).doc,
			encodeStateAsUpdate((await a.persisted("p1")).doc),
		);
		await expect(
			b.knowledge.read("p1", "wiki/Home.md", { maxBytes: 1024 }),
		).rejects.toThrow(OLDER_HOST);
	});
});

/** Every file under `dir`, by its path from there, sorted. */
async function filesUnder(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.sort();
}

describe("a node that lists folders of the knowledge", () => {
	/** A Device whose knowledge has the folders of the lab, and some that look like them. */
	async function lab() {
		const a = await device(memoryHost());
		await a.put(
			"books/graham.md",
			"# Graham\n\nBuy with a margin of safety.\n",
		);
		await a.put("research/papers/2013-gem.md", "# GEM\n\nDual momentum.\n");
		await a.put("results/gem.md", "# GEM card\n\nPost-publication: held.\n");
		await a.put("bookshelf/gem.md", "# Shelf\n\nGEM held, says the shelf.\n");
		await a.put("learnings/accepted/costs.md", "- Costs are always on.\n");
		await a.put("learnings/proposed/run-0.s1.md", "- A proposal.\n");
		await a.knowledge.listing("p1");
		return a;
	}

	test("gets a copy of those folders only, with its own index, in NS_KNOWLEDGE and to read", async () => {
		const a = await lab();
		const session = await a.knowledge.forSession(
			{
				knowledgeOnly: {
					projectId: "p1",
					folders: ["books", "research/papers"],
				},
			},
			{ runId: "run-1", stepId: "s1" },
		);
		const view = session.contribution.env?.NS_KNOWLEDGE as string;
		expect(view).toBeString();
		// Outside the knowledge folders, where no reconcile looks.
		expect(view.startsWith(join(a.sandbox.dataDir, "knowledge"))).toBe(false);
		expect(session.contribution.addDirs).toEqual([view]);
		expect(session.contribution.instructions).toContain(view);
		expect(session.contribution.instructions).not.toContain(a.dir);
		expect(JSON.stringify(session.contribution)).not.toContain(a.dir);
		// The learnings stay on: proposals go to the real folder.
		expect(session.contribution.report).toEqual({ learnings: true });
		expect(await filesUnder(view)).toEqual([
			"INDEX.md",
			"books/graham.md",
			"research/papers/2013-gem.md",
		]);
		const index = await readFile(join(view, "INDEX.md"), "utf8");
		expect(index).toContain("`books/graham.md`: Graham");
		expect(index).toContain("`research/papers/2013-gem.md`: GEM");
		for (const hidden of ["results/", "bookshelf/", "learnings/"]) {
			expect(index).not.toContain(hidden);
		}
		await session.done();
	});

	test("searches and reads nothing outside them", async () => {
		const a = await lab();
		const session = await a.knowledge.forSession(
			{
				knowledgeOnly: {
					projectId: "p1",
					folders: ["books", "research/papers"],
				},
			},
			{ runId: "run-1", stepId: "s1" },
		);
		const tool = (name: string) =>
			session.contribution.tools?.find((t) => t.name === name);
		const search = async (query: string) =>
			String(await tool("search_knowledge")?.execute?.({ query }));
		const read = async (path: string) =>
			String(await tool("read_knowledge")?.execute?.({ path }));

		const gem = await search("GEM");
		expect(gem).toContain("research/papers/2013-gem.md");
		expect(gem).not.toContain("results/gem.md");
		expect(gem).not.toContain("bookshelf/gem.md");
		expect(await search("held")).toContain("No file");
		expect(await search("costs")).toContain("No file");

		expect(await read("books/graham.md")).toContain("margin of safety");
		expect(await read("./books/graham.md")).toContain("margin of safety");
		for (const path of [
			"results/gem.md",
			"bookshelf/gem.md",
			"books/../results/gem.md",
			"/results/gem.md",
			"learnings/accepted/costs.md",
		]) {
			expect(await read(path)).toContain("has no file");
		}
		await session.done();
	});

	test("gets the kept learnings only when it lists them, and its proposals still go to the knowledge", async () => {
		const a = await lab();
		const session = await a.knowledge.forSession(
			{ knowledgeOnly: { projectId: "p1", folders: ["learnings/accepted"] } },
			{ runId: "run-1", stepId: "s1" },
		);
		const view = session.contribution.env?.NS_KNOWLEDGE as string;
		expect(await filesUnder(view)).toEqual([
			"INDEX.md",
			"learnings/accepted/costs.md",
		]);
		for await (const _ of session.events(reporting(["Use total returns."]))) {
		}
		await session.done();
		expect(
			await readFile(join(a.dir, "learnings/proposed/run-1.s1.md"), "utf8"),
		).toContain("Use total returns.");
		expect(await a.paths()).toContain("learnings/proposed/run-1.s1.md");
	});

	test("is gone when the step ends: what the agent wrote there never reaches the knowledge", async () => {
		const a = await lab();
		const before = await a.paths();
		const session = await a.knowledge.forSession(
			{
				knowledgeOnly: { projectId: "p1", folders: ["books", "nothing/here"] },
			},
			{ runId: "run-1", stepId: "s1" },
		);
		const view = session.contribution.env?.NS_KNOWLEDGE as string;
		// The agent writes in its copy.
		await writeFile(join(view, "books/graham.md"), "# Changed\n");
		await writeFile(join(view, "books/new.md"), "# New\n");
		await session.done();
		expect(await stat(view).catch(() => null)).toBeNull();
		expect(await readFile(join(a.dir, "books/graham.md"), "utf8")).toContain(
			"margin of safety",
		);
		expect(await a.paths()).toEqual(before);
		expect(await filesUnder(a.dir)).not.toContain("books/new.md");
	});

	test("an empty view is still a view: never the whole folder", async () => {
		const a = await lab();
		const session = await a.knowledge.forSession(
			{ knowledgeOnly: { projectId: "p1", folders: ["nothing/here"] } },
			{ runId: "run-1" },
		);
		const view = session.contribution.env?.NS_KNOWLEDGE as string;
		expect(view).not.toBe(a.dir);
		expect(await filesUnder(view)).toEqual(["INDEX.md"]);
		expect(await readFile(join(view, "INDEX.md"), "utf8")).toContain(
			"No files yet.",
		);
		await session.done();
	});

	test("without a list, the agent gets the whole folder as before", async () => {
		const a = await lab();
		const session = await a.knowledge.forSession({
			knowledge: { projectId: "p1" },
		});
		expect(session.contribution.env).toEqual({ NS_KNOWLEDGE: a.dir });
		expect(session.contribution.addDirs).toEqual([a.dir]);
		await session.done();
	});
});

/** An agent's events: one report with these learnings. */
async function* reporting(learnings: string[]): AsyncGenerator<AgentEvent> {
	yield { type: "report", outcome: "pass", summary: "Done.", learnings };
}

/** Brings two Devices' knowledge documents in step, as their Links to the Host do. */
async function exchange(
	a: Awaited<ReturnType<typeof device>>,
	b: Awaited<ReturnType<typeof device>>,
) {
	const [docA, docB] = [
		(await a.persisted("p1")).doc,
		(await b.persisted("p1")).doc,
	];
	applyUpdate(docB, encodeStateAsUpdate(docA));
	applyUpdate(docA, encodeStateAsUpdate(docB));
}

describe("the learnings of a run", () => {
	test("from two Agent steps on two Devices at once are both kept", async () => {
		const host = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.knowledge.listing("p1");
		await exchange(a, b);

		// One run, two branches: a step on each Device, at the same time.
		const step = (stepId: string) => ({
			runId: "run-1",
			stepId,
		});
		const onA = await a.knowledge.forSession(
			{ knowledge: { projectId: "p1" } },
			step("s1"),
		);
		const onB = await b.knowledge.forSession(
			{ knowledge: { projectId: "p1" } },
			step("s2"),
		);
		for await (const _ of onA.events(reporting(["Use bun."]))) {
		}
		for await (const _ of onB.events(
			reporting(["The API is in packages/api."]),
		)) {
		}
		await Promise.all([onA.done(), onB.done()]);
		await exchange(a, b);

		for (const knowledge of [a, b]) {
			const listing = await knowledge.knowledge.listing("p1");
			expect(listing.proposed).toBe(2);
		}
		const [learned] = await Promise.all([
			readProposals(a.dir),
			readProposals(b.dir),
		]);
		expect(learned).toEqual(["- The API is in packages/api.", "- Use bun."]);
		expect(await readProposals(b.dir)).toEqual(learned);
	});

	test("wait with their notes on another computer, and keep or delete there as the review does", async () => {
		const host = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const step = (stepId: string) => ({
			runId: "run-1",
			stepId,
		});
		for (const [stepId, notes] of [
			["s1", ["Use bun.", "Tests  run\n with bun test."]],
			["s2", ["The API is in packages/api."]],
		] as const) {
			const session = await a.knowledge.forSession(
				{ knowledge: { projectId: "p1", always: true } },
				step(stepId),
			);
			for await (const _ of session.events(reporting([...notes]))) {
			}
			await session.done();
		}
		await exchange(a, b);

		// B has no folder copy of them yet: the document and the Host's archive list them.
		const waiting = await b.knowledge.learnings(["p1"]);
		expect(
			waiting.map((w) => [w.id, w.runId, w.stepId, w.notes]).sort(),
		).toEqual([
			["run-1.s1.md", "run-1", "s1", ["Use bun.", "Tests run with bun test."]],
			["run-1.s2.md", "run-1", "s2", ["The API is in packages/api."]],
		]);
		expect(waiting[0]?.proposedAt).toBeGreaterThanOrEqual(
			waiting[1]?.proposedAt ?? 0,
		);

		await b.knowledge.settleLearning("p1", "run-1.s1.md", "keep");
		await b.knowledge.settleLearning("p1", "run-1.s2.md", "delete");
		await expect(
			b.knowledge.settleLearning("p1", "run-1.s2.md", "keep"),
		).rejects.toThrow("This learning no longer waits.");
		await expect(
			b.knowledge.settleLearning("p1", "../x.md", "keep"),
		).rejects.toThrow("This learning no longer waits.");
		expect(await b.knowledge.learnings(["p1"])).toEqual([]);

		// A gets the change as a Link brings it: the kept notes are what agents read.
		await exchange(a, b);
		expect(await a.knowledge.learnings(["p1"])).toEqual([]);
		await a.knowledge.listing("p1");
		expect(await readProposals(a.dir)).toEqual([]);
		const kept = await readFile(
			join(a.dir, "learnings", "accepted", "run-1.s1.md"),
			"utf8",
		);
		expect(kept).toContain("- Use bun.\n- Tests run with bun test.\n");
		expect((await a.knowledge.listing("p1")).proposed).toBe(0);
		expect(await a.paths()).toContain("learnings/accepted/run-1.s1.md");
		expect(await a.paths()).not.toContain("learnings/accepted/run-1.s2.md");
	});
});

/** The notes of every proposal in a knowledge folder, sorted. */
async function readProposals(dir: string): Promise<string[]> {
	const folder = join(dir, "learnings", "proposed");
	const names = await readdir(folder).catch(() => [] as string[]);
	const notes: string[] = [];
	for (const name of names) {
		const text = await readFile(join(folder, name), "utf8");
		notes.push(...text.split("\n").filter((line) => line.startsWith("- ")));
	}
	return notes.sort();
}

describe("a project that moves to another Space", () => {
	test("to a new id there takes its knowledge along: the document, the folder, the content and the search index", async () => {
		const host = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n\nThe lighthouse wiki.\n");
		await a.put("notes.md", "Notes\n");
		await a.knowledge.listing("p1");
		const team = await otherSpace(a.sandbox.db, "Team");
		// The move's batch re-ids the project's rows: p1 is p9 in the Team.
		await a.sandbox.db
			.update(project)
			.set({ id: "p9", spaceId: team })
			.where(eq(project.id, "p1"));

		await a.knowledge.moved({
			from: a.sandbox.spaceId,
			projects: { p1: { spaceId: team, projectId: "p9" } },
		});

		expect(await stat(a.dir).catch(() => null)).toBeNull();
		const folder = a.folder("p9");
		expect(await readFile(join(folder, "wiki/Home.md"), "utf8")).toContain(
			"lighthouse",
		);
		const listing = await a.knowledge.listing("p9");
		expect(listing.files.map((f) => f.path)).toEqual([
			"notes.md",
			"wiki/Home.md",
		]);
		expect([...(await a.documents.open("p9")).entries().keys()].sort()).toEqual(
			["notes.md", "wiki/Home.md"],
		);
		// The old document is gone: an empty one opens in its place.
		expect((await a.documents.open("p1")).entries().size).toBe(0);
		// The content went to the Team's Host.
		expect(host.spaces.has(team)).toBe(true);
		expect(
			(await a.knowledge.search("p9", "lighthouse")).map((hit) => hit.path),
		).toEqual(["wiki/Home.md"]);
		expect(await a.knowledge.search("p1", "lighthouse")).toEqual([]);
	});

	test("with its id takes its content to the new Space's Host, though no file changed", async () => {
		const host = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.knowledge.listing("p1");
		const team = await otherSpace(a.sandbox.db, "Team");
		await a.sandbox.db
			.update(project)
			.set({ spaceId: team })
			.where(eq(project.id, "p1"));
		expect(host.spaces.has(team)).toBe(false);

		await a.knowledge.moved({
			from: a.sandbox.spaceId,
			projects: { p1: { spaceId: team, projectId: "p1" } },
		});
		await a.knowledge.listing("p1");

		expect(host.spaces.has(team)).toBe(true);
		expect(await a.paths()).toEqual(["wiki/Home.md"]);
		expect(await readFile(join(a.dir, "wiki/Home.md"), "utf8")).toBe(
			"# Home\n",
		);
	});

	test("to an id whose folder is here already keeps the newer file of each path", async () => {
		const a = await device(memoryHost());
		await a.put("old.md", "from p1\n");
		await a.put("both.md", "older\n");
		await a.knowledge.listing("p1");
		const target = a.folder("p9");
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "both.md"), "newer\n");
		const team = await otherSpace(a.sandbox.db, "Team");
		await a.sandbox.db
			.update(project)
			.set({ id: "p9", spaceId: team })
			.where(eq(project.id, "p1"));

		await a.knowledge.moved({
			from: a.sandbox.spaceId,
			projects: { p1: { spaceId: team, projectId: "p9" } },
		});

		expect(await readFile(join(target, "old.md"), "utf8")).toBe("from p1\n");
		expect(await readFile(join(target, "both.md"), "utf8")).toBe("newer\n");
		expect(await stat(a.dir).catch(() => null)).toBeNull();
	});
});

describe("the question set", () => {
	test("a marked question syncs through the knowledge to another computer, and never shows as a file", async () => {
		const host = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/deploy.md", "# Deploy\n");
		expect((await a.knowledge.questions("p1")).set).toEqual([]);
		const set = await a.knowledge.markQuestion("p1", {
			query: "  How do we  deploy? ",
			answers: ["wiki/deploy.md", "learnings/proposed/run-1.md", "evals/x"],
			by: "ann",
		});
		expect(set).toEqual([
			{
				query: "How do we  deploy?",
				answers: ["wiki/deploy.md"],
				markedAt: expect.any(Number),
				by: "ann",
			},
		]);
		expect((await a.paths()).sort()).toEqual([
			"evals/questions.json",
			"wiki/deploy.md",
		]);
		const listing = await a.knowledge.listing("p1");
		expect(listing.files.map((f) => f.path)).toEqual(["wiki/deploy.md"]);
		expect(
			await a.knowledge.read("p1", "evals/questions.json", { maxBytes: 1024 }),
		).toBeNull();

		// B gets the set as a Link brings the document.
		applyUpdate(
			(await b.persisted("p1")).doc,
			encodeStateAsUpdate((await a.persisted("p1")).doc),
		);
		expect((await b.knowledge.questions("p1")).set.map((q) => q.query)).toEqual(
			["How do we  deploy?"],
		);
		// The same words, written another way, are the same question: no files takes it out.
		expect(
			await b.knowledge.markQuestion("p1", {
				query: "how do we deploy?",
				answers: [],
				by: "bob",
			}),
		).toEqual([]);
	});

	test("what agents asked comes with its answers once a person marked them", async () => {
		const a = await device(memoryHost());
		await a.put("wiki/deploy.md", "# Deploy\n");
		await a.knowledge.search("p1", "deploy", { agent: true });
		const asked = await a.knowledge.questions("p1");
		expect(asked.set).toEqual([]);
		expect(asked.asked).toMatchObject([
			{ query: "deploy", times: 1, runId: null, answers: null },
		]);

		await a.knowledge.markQuestion("p1", {
			query: "Deploy",
			answers: ["wiki/deploy.md"],
			by: "ann",
		});
		const marked = await a.knowledge.questions("p1", { limit: 1 });
		// The same words, written another way, are the same question.
		expect(marked.asked[0]?.answers).toEqual(["wiki/deploy.md"]);
		expect(marked.set).toHaveLength(1);
	});

	test("runs against the search by words while search by meaning is not there", async () => {
		const a = await device(memoryHost());
		await a.put("wiki/deploy.md", "# Deploy\n");
		await a.knowledge.markQuestion("p1", {
			query: "deploy",
			answers: ["wiki/deploy.md"],
			by: "ann",
		});
		expect(await a.knowledge.evaluate("p1")).toMatchObject({
			questions: 1,
			advice: "unavailable",
			modes: { words: { found: 1, recall: 1 }, meaning: null, both: null },
		});
	});
});

describe("what an agent in a terminal asks", () => {
	const logged = async (a: Awaited<ReturnType<typeof device>>) =>
		(await a.sandbox.db.select().from(event))
			.filter((row) => row.type.startsWith("Knowledge"))
			.sort((x, y) => x.seq - y.seq);

	test("is logged for the project with no run, and a person's search and read on the page are not", async () => {
		const a = await device(memoryHost());
		await a.put("wiki/deploy.md", "# Deploy\n");
		await a.knowledge.search("p1", "deploy");
		await a.knowledge.read("p1", "wiki/deploy.md", { maxBytes: 1024 });
		expect(await logged(a)).toEqual([]);

		await a.knowledge.search("p1", " deploy ", { agent: true });
		await a.knowledge.read("p1", "nope.md", { maxBytes: 1024, agent: true });
		await a.knowledge.read("p1", "./wiki/deploy.md", {
			maxBytes: 1024,
			from: { line: 1 },
			agent: true,
		});
		const rows = await logged(a);
		expect(rows.map((row) => [row.type, row.runId])).toEqual([
			["KnowledgeSearched", null],
			["KnowledgeRead", null],
			["KnowledgeRead", null],
		]);
		expect(rows.map((row) => JSON.parse(row.payload))).toEqual([
			{
				projectId: "p1",
				query: "deploy",
				hits: [
					{
						path: "wiki/deploy.md",
						section: "Deploy",
						line: 1,
						page: null,
						found: ["words"],
					},
				],
				via: "mcp",
			},
			{ projectId: "p1", path: "nope.md", found: false, via: "mcp" },
			{
				projectId: "p1",
				path: "wiki/deploy.md",
				found: true,
				via: "mcp",
				from: { line: 1 },
			},
		]);
		expect(await a.knowledge.use("p1")).toMatchObject({
			runsUsedIt: false,
			files: [{ path: "wiki/deploy.md", found: 1, read: 1, lastRunAt: null }],
		});
	});

	test("gets its answer though the use cannot be written", async () => {
		const sandbox = await createSandbox();
		sandboxes.push(sandbox);
		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
		const built = testKnowledge(sandbox);
		closes.push(built.close);
		await mkdir(join(built.folder("p1"), "wiki"), { recursive: true });
		await writeFile(join(built.folder("p1"), "wiki/deploy.md"), "# Deploy\n");
		// A project no row names: its event has no Space, so its write fails.
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			await sandbox.db.delete(project).where(eq(project.id, "p1"));
			expect(
				(await built.knowledge.search("p1", "deploy", { agent: true })).map(
					(hit) => hit.path,
				),
			).toEqual(["wiki/deploy.md"]);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

describe("the learnings that wait", () => {
	test("of several projects come newest first, each with its project", async () => {
		const a = await device(memoryHost());
		await a.sandbox.db
			.insert(project)
			.values({ id: "p2", spaceId: a.sandbox.spaceId, name: "p2" });
		await a.put("learnings/proposed/run-1.s1.md", "- One.\n");
		await a.knowledge.listing("p1");
		await Bun.sleep(5);
		const other = join(a.folder("p2"), "learnings", "proposed");
		await mkdir(other, { recursive: true });
		await writeFile(join(other, "run-2.s1.md"), "- Two.\n");
		await a.knowledge.listing("p2");
		expect(
			(await a.knowledge.learnings(["p1", "p2"])).map((learning) => [
				learning.projectId,
				learning.id,
				learning.notes,
			]),
		).toEqual([
			["p2", "run-2.s1.md", ["Two."]],
			["p1", "run-1.s1.md", ["One."]],
		]);
		expect(await a.knowledge.learnings([])).toEqual([]);
	});
});

describe("search by meaning", () => {
	/** A model that counts what it embeds, and is ready at once. */
	function countingModel() {
		const counted = { embedded: 0 };
		class CountingEmbeddings extends Embeddings {
			constructor() {
				super({});
			}
			async embedDocuments(texts: string[]) {
				counted.embedded += texts.length;
				return texts.map(() => [1, 0]);
			}
			async embedQuery() {
				return [1, 0];
			}
		}
		const meaning: KnowledgeMeaning = {
			model: "fake-model",
			embeddings: new CountingEmbeddings(),
			query: (text) => text,
			ready: async () => "ready",
		};
		return { counted, meaning };
	}

	test("follows the project's setting in its document, for every Device of the Space", async () => {
		const { meaning } = countingModel();
		const host = memoryHost();
		const a = await device(host, { meaning });
		const b = await device(host, { meaning });
		await a.put("wiki/deploy.md", "# Deploy\n");
		expect((await a.knowledge.setMeaning("p1", false)).state).toBe(
			"turned-off",
		);
		applyUpdate(
			(await b.persisted("p1")).doc,
			encodeStateAsUpdate((await a.persisted("p1")).doc),
		);
		expect((await b.knowledge.meaning("p1")).state).toBe("turned-off");
		expect((await a.knowledge.setMeaning("p1", true)).state).not.toBe(
			"turned-off",
		);
	});

	test("a closed Knowledge prepares nothing, and still answers a session that outlives it", async () => {
		const { counted, meaning } = countingModel();
		const a = await device(memoryHost(), { meaning });
		await a.put("wiki/deploy.md", "# Deploy\n\nWe deploy at night.\n");
		a.close();
		const hits = await a.knowledge.search("p1", "deploy");
		expect(hits.map((hit) => hit.path)).toEqual(["wiki/deploy.md"]);
		await Bun.sleep(20);
		expect(counted.embedded).toBe(0);
		a.close();
	});

	test("the next Knowledge over the same folder finds by meaning, and embeds nothing again", async () => {
		const { counted, meaning } = countingModel();
		const a = await device(memoryHost(), { meaning });
		await a.put("wiki/deploy.md", "# Deploy\n\nWe deploy at night.\n");
		const prepared = async (knowledge: typeof a.knowledge) => {
			await waitFor(async () => (await knowledge.meaning("p1")).state === "on");
		};
		await prepared(a.knowledge);
		const embedded = counted.embedded;
		expect(embedded).toBeGreaterThan(0);
		a.close();

		const next = testKnowledge(a.sandbox, { meaning });
		closes.push(next.close);
		await prepared(next.knowledge);
		expect(counted.embedded).toBe(embedded);
	});
});

describe("connect and close", () => {
	test("once connected the folders come in step on their own; after close they do not", async () => {
		const a = await device(memoryHost(), {
			timers: { firstReconcileMs: 1 },
		});
		await a.put("wiki/Home.md", "# Home\n");
		await waitFor(async () => (await a.paths()).includes("wiki/Home.md"));
		a.close();
		await a.put("wiki/Later.md", "# Later\n");
		await Bun.sleep(20);
		expect(await a.paths()).toEqual(["wiki/Home.md"]);
	});

	test("nothing on its own before the Hosts are connected", async () => {
		const sandbox = await createSandbox();
		sandboxes.push(sandbox);
		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
		const built = testKnowledge(sandbox, { timers: { firstReconcileMs: 1 } });
		closes.push(built.close);
		const folder = built.folder("p1");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "a.md"), "# A\n");
		await Bun.sleep(20);
		expect((await built.documents.open("p1")).entries().size).toBe(0);
	});
});
