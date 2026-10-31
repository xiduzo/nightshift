import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import { project } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import type { ArchiveHost } from "../archive";
import { OLDER_HOST, OlderHostError } from "../contract";
import { createSandbox, type Sandbox } from "../testing";
import { testKnowledge } from "../testing/knowledge";
import { otherSpace } from "../testing/test-support";
import { knowledgeEntries } from "./knowledge-document";

/**
 * A project's knowledge on a Device, through the one module the daemon
 * hands out: what a step gets, and the order of the reconciles around it.
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
async function device(host: ArchiveHost) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const built = testKnowledge(sandbox, { pageWaitMs: 5_000 });
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
		paths: async () => [
			...knowledgeEntries(await built.documents.open("p1")).keys(),
		],
	};
}

describe("a step's knowledge", () => {
	test("while a sync writes the folder, the page and the timers leave it alone: its end publishes", async () => {
		const a = await device(memoryHost());
		await a.put("wiki/Home.md", "# Home\n");
		const sync = await a.knowledge.forCommand({ projectId: "p1" });
		expect(sync.env).toEqual({ NS_KNOWLEDGE: a.dir });
		// The reconcile before the step published what was there.
		expect(await a.paths()).toEqual(["wiki/Home.md"]);

		// The sync writes: half a file, as `jq > page.md` leaves it, and a
		// staging file.
		await a.put("wiki/Page.md", "# Pa");
		await a.put("wiki/Next.md.part", "# Ne");
		const listing = await a.knowledge.listing("p1");
		expect(listing.files.map((f) => f.path)).toEqual(["wiki/Home.md"]);
		await a.knowledge.reconcileAll();
		await a.knowledge.retryPending();
		expect(await a.paths()).toEqual(["wiki/Home.md"]);
		await expect(a.knowledge.removeFolder("p1", "wiki")).rejects.toThrow(
			"A run is changing this knowledge now. Try again when it ends.",
		);

		// An agent of another run shares the folder: the first to end does
		// not reconcile, the last one does.
		const agent = await a.knowledge.forSession({ projectId: "p1" });
		await sync.done();
		expect(await a.paths()).toEqual(["wiki/Home.md"]);
		await a.put("wiki/Page.md", "# Page\n");
		await agent.done();
		// A second `done` changes nothing.
		await agent.done();
		expect(await a.paths()).toEqual(["wiki/Home.md", "wiki/Page.md"]);
		expect(await a.knowledge.removeFolder("p1", "wiki")).toBe(2);
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
			(await b.documents.open("p1")).doc,
			encodeStateAsUpdate((await a.documents.open("p1")).doc),
		);
		const session = await b.knowledge.forSession(
			{ projectId: "p1", always: true },
			{ runId: "run-2", stepReport: true },
		);
		await session.done();
		expect(session.input.addDirs).toEqual([b.dir]);
		expect(session.input.stepReport).toEqual({ learnings: true });
		const read = session.input.tools?.find(
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
		expect(await b.knowledge.read("p1", "wiki/Home.md", 1024)).toMatchObject({
			title: "Home",
			text: "# Home\n\nThe wiki.\n",
		});
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
		const step = await a.knowledge.forCommand({ projectId: "p1" });
		await step.done();
		expect(calls).toBe(1);
		expect(await a.paths()).toContain("wiki/Next.md");

		// A file another Device listed cannot come from that Host: it says why.
		const b = await device(older);
		applyUpdate(
			(await b.documents.open("p1")).doc,
			encodeStateAsUpdate((await a.documents.open("p1")).doc),
		);
		await expect(b.knowledge.read("p1", "wiki/Home.md", 1024)).rejects.toThrow(
			OLDER_HOST,
		);
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
		(await a.documents.open("p1")).doc,
		(await b.documents.open("p1")).doc,
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
			stepReport: true as const,
		});
		const onA = await a.knowledge.forSession({ projectId: "p1" }, step("s1"));
		const onB = await b.knowledge.forSession({ projectId: "p1" }, step("s2"));
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
		expect(
			[...knowledgeEntries(await a.documents.open("p9")).keys()].sort(),
		).toEqual(["notes.md", "wiki/Home.md"]);
		// The old document is gone: an empty one opens in its place.
		expect(knowledgeEntries(await a.documents.open("p1")).size).toBe(0);
		// The content went to the Team's Host.
		expect(host.spaces.has(team)).toBe(true);
		expect(
			(await a.search.search("p9", "lighthouse")).map((hit) => hit.path),
		).toEqual(["wiki/Home.md"]);
		expect(await a.search.search("p1", "lighthouse")).toEqual([]);
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
