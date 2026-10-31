import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import type { ArchiveHost } from "../archive";
import { createSandbox, type Sandbox } from "../testing";
import { testKnowledge } from "../testing/knowledge";
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

/** A Host's archive in memory: content by hash. */
function memoryHost(): ArchiveHost {
	const kept = new Map<string, Uint8Array>();
	return {
		async archivePut({ ref, content }) {
			if (ref.kind !== "content" || typeof content === "string") return false;
			kept.set(ref.sha256, content.slice());
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
