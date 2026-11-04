import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	KNOWLEDGE_RECONCILE_FILE,
	KNOWLEDGE_SEARCH_FILE,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import { sha256Of } from "../archive";
import {
	knowledgeDevice as device,
	memoryHost,
	removeKnowledgeDevices,
	syncKnowledgeDocuments as syncDocuments,
} from "../testing/knowledge-devices";
import { createKnowledgeFolderLocks } from "./folder-locks";
import { createKnowledgeSearch } from "./search";

/**
 * The reconcile of a knowledge folder with its document (ADR 4), on two
 * Devices with a Host in memory between them. The documents sync by hand,
 * as a Link does.
 */

afterEach(removeKnowledgeDevices);

const NOW = now();

describe("removeFolder", () => {
	test("removes a folder's entries for every Device, and its files here and there", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("web/a.md", "a");
		await a.put("web/b.md", "b");
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.has("web/a.md")).toBe(true);

		expect(await a.sync.removeFolder("p1", "web")).toBe(2);

		expect([...(await a.entries()).keys()]).toEqual(["wiki/Home.md"]);
		expect(await a.has("web/a.md")).toBe(false);
		expect(await a.has("wiki/Home.md")).toBe(true);
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.has("web/b.md")).toBe(false);
		expect(await b.has("wiki/Home.md")).toBe(true);
	});

	test("refuses a folder outside the knowledge, and Night Shift's own", async () => {
		const a = await device(null);
		for (const folder of ["", "../x", "learnings", "evals", ".hidden"]) {
			await expect(a.sync.removeFolder("p1", folder)).rejects.toThrow(
				"Choose a folder inside the knowledge",
			);
		}
	});
});

describe("a step that holds the folder", () => {
	test("the reconcile of every folder, the retry of what waits and a removal leave it alone until it ends", async () => {
		const { state, host } = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		// Its content waits for the Host: the retry would publish it.
		state.down = true;
		await a.put("wiki/Offline.md", "# Offline\n");
		await a.sync.reconcile("p1");
		state.down = false;

		const step = await a.sync.startStep("p1");
		await a.put("wiki/Page.md", "# Pa");
		await a.sync.reconcileAll();
		await a.sync.retryPending();
		expect([...(await a.entries()).keys()]).not.toContain("wiki/Page.md");
		await expect(a.sync.removeFolder("p1", "wiki")).rejects.toThrow(
			"A run is changing this knowledge now. Try again when it ends.",
		);

		await a.put("wiki/Page.md", "# Page\n");
		await step.done();
		expect([...(await a.entries()).keys()]).toContain("wiki/Page.md");
		expect(await a.sync.removeFolder("p1", "wiki")).toBe(3);
	});

	test("the retry reconciles only a folder whose content waits for the Host", async () => {
		const { kept, state, host } = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		const before = kept.size;

		await a.put("wiki/Later.md", "# Later\n");
		await a.sync.retryPending();
		expect(kept.size).toBe(before);

		state.down = true;
		await a.sync.reconcile("p1");
		state.down = false;
		await a.sync.retryPending();
		expect(kept.size).toBe(before + 1);
	});
});

describe("reconcile", () => {
	test("publishes a file the folder changed: content to the Host first, then its entry", async () => {
		const { kept, host } = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");

		await a.sync.reconcile("p1");

		const entry = (await a.entries()).get("wiki/Home.md");
		const sha256 = sha256Of(new TextEncoder().encode("# Home\n"));
		expect(entry).toMatchObject({
			sha256,
			size: 7,
			deviceId: a.sandbox.deviceId,
		});
		expect(entry?.local).toBeUndefined();
		expect(new TextDecoder().decode(kept.get(sha256))).toBe("# Home\n");
		// Nothing changed since: nothing to publish.
		await a.sync.reconcile("p1");
		expect((await a.entries()).get("wiki/Home.md")).toEqual(entry);
	});

	test("writes an entry another Device changed into the folder, and its next change", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		await b.sync.reconcile("p1");
		expect(await b.read("wiki/Home.md")).toBe("# Home\n");
		expect((await b.entries()).get("wiki/Home.md")?.deviceId).toBe(
			a.sandbox.deviceId,
		);

		await a.put("wiki/Home.md", "# Home, again\n", NOW + 60_000);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.read("wiki/Home.md")).toBe("# Home, again\n");
		// B wrote it, and did not change it: it publishes nothing.
		const entry = (await b.entries()).get("wiki/Home.md");
		await b.sync.reconcile("p1");
		expect((await b.entries()).get("wiki/Home.md")).toEqual(entry);
		expect(entry?.deviceId).toBe(a.sandbox.deviceId);
	});

	test("a removal travels: the entry goes, then the file and its empty folder on the other Device", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		await rm(join(a.dir, "wiki/Home.md"));
		await a.sync.reconcile("p1");
		expect((await a.entries()).has("wiki/Home.md")).toBe(false);
		await syncDocuments(a, b);

		await b.sync.reconcile("p1");
		expect(await b.has("wiki/Home.md")).toBe(false);
		expect(await b.has("wiki")).toBe(false);
	});

	test("a file that moves leaves its old folder empty: the one reconcile writes it all the same", async () => {
		// As a kept learning moves from `learnings/proposed` to
		// `learnings/accepted`. One folder does not always lose this race,
		// so the test moves many.
		const FOLDERS = 100;
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const moves = Array.from({ length: FOLDERS }, (_, n) => {
			const folder = `f${n}`;
			return n % 2 === 0
				? { from: `${folder}/old/x.md`, to: `${folder}/new/x.md`, n }
				: { from: `${folder}/old.md`, to: `${folder}/new.md`, n };
		});
		for (const { from, n } of moves) await a.put(from, `# ${n}\n`);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		for (const { from, to, n } of moves) {
			await rm(join(b.dir, from));
			await b.put(to, `# ${n}\n`);
		}
		await b.sync.reconcile("p1");
		await syncDocuments(a, b);

		await a.sync.reconcile("p1");
		const lost: string[] = [];
		for (const { from, to } of moves) {
			if (!(await a.has(to))) lost.push(to);
			expect(await a.has(from)).toBe(false);
		}
		expect(lost).toEqual([]);
	});

	test("a file that becomes a folder, and a folder that becomes a file, arrive in one reconcile", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("to-folder", "a file\n");
		await a.put("to-file/page.md", "a page\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		await rm(join(b.dir, "to-folder"));
		await rm(join(b.dir, "to-file"), { recursive: true });
		await b.put("to-folder/page.md", "a page\n");
		await b.put("to-file", "a file\n");
		await b.sync.reconcile("p1");
		await syncDocuments(a, b);

		await a.sync.reconcile("p1");
		expect(await a.read("to-folder/page.md")).toBe("a page\n");
		expect(await a.read("to-file")).toBe("a file\n");
	});

	test("when both Devices changed one path, the later change wins on both", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("notes.md", "first\n", NOW);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		// A changes it, then B, later, before it sees A's change.
		await a.put("notes.md", "from A\n", NOW + 10_000);
		await b.put("notes.md", "from B, later\n", NOW + 20_000);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect((await b.entries()).get("notes.md")?.deviceId).toBe(
			b.sandbox.deviceId,
		);
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");
		expect(await a.read("notes.md")).toBe("from B, later\n");
		expect(await b.read("notes.md")).toBe("from B, later\n");

		// The other way round: B's change is the earlier one, and loses.
		await b.put("notes.md", "from B, early\n", NOW + 30_000);
		await a.put("notes.md", "from A, late\n", NOW + 40_000);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.read("notes.md")).toBe("from A, late\n");
	});

	test("when the document keeps the earlier of two changes made at once, the later goes back in", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		// Both publish one path before their documents meet.
		await a.put("notes.md", "from A, early\n", NOW + 10_000);
		await b.put("notes.md", "from B, later\n", NOW + 20_000);
		await a.sync.reconcile("p1");
		await b.sync.reconcile("p1");
		const earlier = (await a.entries()).get("notes.md");
		if (!earlier) throw new Error("A did not publish its change.");
		await syncDocuments(a, b);
		// Yjs keeps one of two changes made at once: here, A's earlier one.
		await (await a.document()).apply({ set: [["notes.md", earlier]] });
		await syncDocuments(a, b);

		await b.sync.reconcile("p1");
		expect(await b.read("notes.md")).toBe("from B, later\n");
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");

		expect(await a.read("notes.md")).toBe("from B, later\n");
		expect(await b.read("notes.md")).toBe("from B, later\n");
		expect((await a.entries()).get("notes.md")?.deviceId).toBe(
			b.sandbox.deviceId,
		);
	});

	test("a change wins over a removal: nothing is lost", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("notes.md", "first\n", NOW);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		await rm(join(a.dir, "notes.md"));
		await b.put("notes.md", "changed on B\n", NOW + 10_000);
		await a.sync.reconcile("p1");
		await b.sync.reconcile("p1");
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");
		await b.sync.reconcile("p1");

		expect(await a.read("notes.md")).toBe("changed on B\n");
		expect(await b.read("notes.md")).toBe("changed on B\n");
	});

	test("a file over 10 MB stays on its Device: listed, never copied", async () => {
		const { kept, host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const large = new Uint8Array(10 * 1024 * 1024 + 1).fill(97);
		await a.put("big.txt", large);
		await a.sync.reconcile("p1");
		const entry = (await a.entries()).get("big.txt");
		expect(entry).toMatchObject({
			sha256: sha256Of(large),
			size: large.length,
			local: true,
		});
		expect(kept.size).toBe(0);

		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.has("big.txt")).toBe(false);
		const listing = await b.reader.listing("p1");
		expect(listing.files).toEqual([
			{
				path: "big.txt",
				size: large.length,
				changedAt: entry?.changedAt as number,
				local: true,
			},
		]);
		await expect(b.reader.read("p1", "big.txt", 1024)).rejects.toThrow(
			"stays on the computer that synced it",
		);
	});

	test("the first reconcile imports the folder, and the later change wins where the document has the path", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		// Both had a folder before the upgrade: no state yet.
		await a.put("wiki/Home.md", "A's home\n", NOW + 20_000);
		await a.put("wiki/Only-A.md", "only on A\n", NOW);
		await b.put("wiki/Home.md", "B's older home\n", NOW + 10_000);
		await b.put("wiki/Only-B.md", "only on B\n", NOW);

		await a.sync.reconcile("p1");
		expect([...(await a.entries()).keys()].sort()).toEqual([
			"wiki/Home.md",
			"wiki/Only-A.md",
		]);
		expect(await a.has(".reconciled.json")).toBe(true);
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");

		for (const d of [a, b]) {
			expect(await d.read("wiki/Home.md")).toBe("A's home\n");
			expect(await d.read("wiki/Only-A.md")).toBe("only on A\n");
			expect(await d.read("wiki/Only-B.md")).toBe("only on B\n");
		}
	});

	test("offline: content waits to be copied, a fetch that fails keeps the old file, and both go on later", async () => {
		const { kept, state, host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const v2 = sha256Of(new TextEncoder().encode("v2\n"));
		await a.put("notes.md", "v1\n", NOW);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		state.down = true;
		await a.put("notes.md", "v2\n", NOW + 10_000);
		await a.sync.reconcile("p1");
		expect((await a.entries()).get("notes.md")?.sha256).toBe(v2);
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.read("notes.md")).toBe("v1\n");

		state.down = false;
		// The Host does not have v2 yet: B still waits.
		await b.sync.reconcile("p1");
		expect(await b.read("notes.md")).toBe("v1\n");
		expect(kept.has(v2)).toBe(false);
		// A copies what waited at its next reconcile.
		await a.sync.reconcile("p1");
		expect(kept.has(v2)).toBe(true);
		await b.sync.reconcile("p1");
		expect(await b.read("notes.md")).toBe("v2\n");
	});

	test("never syncs the index or a hidden file, and never writes a path that leaves the folder", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("INDEX.md", "# Knowledge index\n");
		await a.put(".git/HEAD", "ref\n");
		await a.put("wiki/.draft.md", "hidden\n");
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		expect([...(await a.entries()).keys()]).toEqual(["wiki/Home.md"]);

		// Another Device's entries that are not paths of the folder.
		const home = (await a.entries()).get("wiki/Home.md");
		if (!home) throw new Error("A did not publish its file.");
		await (await a.document()).apply({
			set: ["../outside.md", ".hidden", "index.md", "a//b"].map(
				(path) => [path, home] as const,
			),
		});
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.has("wiki/Home.md")).toBe(true);
		expect(await b.has(".hidden")).toBe(false);
		expect(await b.has("index.md")).toBe(false);
		expect(
			await stat(join(b.dir, "..", "outside.md")).then(
				() => true,
				() => false,
			),
		).toBe(false);

		// Nor through a link in the folder that leads out of it.
		const outside = join(b.sandbox.root, "outside");
		await mkdir(outside, { recursive: true });
		await symlink(outside, join(b.dir, "linked"));
		await a.put("linked/Page.md", "# Page\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(
			await stat(join(outside, "Page.md")).then(
				() => true,
				() => false,
			),
		).toBe(false);
	});

	test("never publishes what a sync kit still writes: a staging file or folder", async () => {
		const { host, kept } = memoryHost();
		const a = await device(host);
		// As the kits stage them: `$dest.part`, and `page.md.part` beside the page.
		await a.put("wiki.part/Home.md", "# Home, half\n");
		await a.put("web/page.md.part", "half a pa");
		await a.put("jira/KEY-1.json.part", "{");
		await a.put("web/done.md", "# Done\n");
		await a.sync.reconcile("p1");
		expect([...(await a.entries()).keys()]).toEqual(["web/done.md"]);
		expect(kept.size).toBe(1);
	});

	test("a Replica that lost its document publishes the folder again: it removes nothing", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("notes.md", "kept\n");
		await a.sync.reconcile("p1");
		// A new Replica, the same folder: its document never had an update.
		await a.documents.remove("p1");
		expect((await a.document()).isNew()).toBe(true);

		await a.sync.reconcile("p1");

		expect([...(await a.entries()).keys()]).toEqual(["notes.md"]);
		expect(await a.read("notes.md")).toBe("kept\n");
	});
});

describe("what the reconcile takes as changed", () => {
	const sha256 = async (d: Awaited<ReturnType<typeof device>>, path: string) =>
		(await d.entries()).get(path)?.sha256;

	test("another size at the same time goes out, and another time with other content", async () => {
		const a = await device(null);
		await a.put("a.md", "aaaa", NOW);
		await a.sync.reconcile("p1");
		const first = await sha256(a, "a.md");

		await a.put("a.md", "aaaaa", NOW);
		await a.sync.reconcile("p1");
		const second = await sha256(a, "a.md");
		expect(second).not.toBe(first);

		await a.put("a.md", "bbbbb", NOW + 1_000);
		await a.sync.reconcile("p1");
		expect(await sha256(a, "a.md")).not.toBe(second);
	});

	test("another time with the same content changes no entry", async () => {
		const a = await device(null);
		await a.put("a.md", "same", NOW);
		await a.sync.reconcile("p1");
		const entry = (await a.entries()).get("a.md");
		await a.put("a.md", "same", NOW + 1_000);
		await a.sync.reconcile("p1");
		expect((await a.entries()).get("a.md")).toEqual(entry);
	});

	test("an edit that keeps both size and time is not seen, as long as both stay", async () => {
		const a = await device(null);
		await a.put("a.md", "aaaa", NOW);
		await a.sync.reconcile("p1");
		const first = await sha256(a, "a.md");
		await a.put("a.md", "bbbb", NOW);
		await a.sync.reconcile("p1");
		expect(await sha256(a, "a.md")).toBe(first);
		// The next change of its time shows it.
		await a.put("a.md", "bbbb", NOW + 1_000);
		await a.sync.reconcile("p1");
		expect(await sha256(a, "a.md")).not.toBe(first);
	});
});

/**
 * The state of the reconcile and the `files` table of the search index stay
 * two records (`folder-snapshot.ts`): each moves only when its own work is
 * done, and neither stands in for the other.
 */
describe("the two records of a folder", () => {
	test("a lost state loses no file: a newer edit and a file of the folder alone go out", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("kept.md", "kept\n", NOW);
		await a.put("edited.md", "before\n", NOW);
		await a.sync.reconcile("p1");

		await rm(join(a.dir, KNOWLEDGE_RECONCILE_FILE));
		await a.put("edited.md", "after, by a person\n", NOW + 20_000);
		await a.put("new.md", "new\n", NOW);
		await a.sync.reconcile("p1");

		expect(await a.read("kept.md")).toBe("kept\n");
		expect(await a.read("edited.md")).toBe("after, by a person\n");
		expect(await a.read("new.md")).toBe("new\n");
		expect([...(await a.entries()).keys()].sort()).toEqual([
			"edited.md",
			"kept.md",
			"new.md",
		]);
		const b = await device(host);
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.read("edited.md")).toBe("after, by a person\n");
	});

	test("an index built again brings back no file another Device removed", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("gone.md", "gone\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		await rm(join(a.dir, "gone.md"));
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");
		expect(await b.has("gone.md")).toBe(false);

		const search = createKnowledgeSearch(b.sandbox.dataDir);
		await search.refresh("p1");
		search.close();
		await rm(join(b.sandbox.dataDir, "knowledge", KNOWLEDGE_SEARCH_FILE));
		await b.sync.reconcile("p1");
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");

		expect((await b.entries()).has("gone.md")).toBe(false);
		expect(await a.has("gone.md")).toBe(false);
	});

	test("a crash after a reconcile, before the index read the files: the next search reads them", async () => {
		const a = await device(null);
		await a.put("first.md", "word one\n");
		const before = createKnowledgeSearch(a.sandbox.dataDir);
		await before.refresh("p1");
		before.close();

		await a.put("late.md", "word late\n");
		await a.sync.reconcile("p1");

		const after = createKnowledgeSearch(a.sandbox.dataDir);
		const hits = await after.search("p1", "late");
		after.close();
		expect(hits.map((hit) => hit.path)).toEqual(["late.md"]);
	});

	test("a crash after the index read a file, before a reconcile: the file still goes out", async () => {
		const a = await device(null);
		await a.put("a.md", "before\n", NOW);
		await a.sync.reconcile("p1");
		const first = (await a.entries()).get("a.md")?.sha256;

		await a.put("a.md", "after\n", NOW + 1_000);
		const search = createKnowledgeSearch(a.sandbox.dataDir);
		await search.refresh("p1");
		search.close();
		await a.sync.reconcile("p1");

		expect((await a.entries()).get("a.md")?.sha256).not.toBe(first);
	});
});

describe("a folder's locks", () => {
	/** A wait that ends when `open` is called. */
	function gate() {
		let open = () => {};
		const opened = new Promise<void>((resolve) => {
			open = resolve;
		});
		return { open, opened };
	}

	// `bun --hot` makes a second instance beside a step of the first: the
	// daemon keeps one `KnowledgeFolderLocks` across the reload.
	test("a second instance does not reconcile a folder a step of the first writes", async () => {
		const a = await device(null);
		const after = a.newSync();
		const hold = await a.sync.startStep("p1");
		await a.put("wiki/half.md", "half of what the step writes\n");

		await after.reconcileUnlessHeld("p1");
		expect(await a.entries()).toEqual(new Map());

		await hold.done();
		expect([...(await a.entries()).keys()]).toEqual(["wiki/half.md"]);
	});

	test("reconciles of two instances take turns on one folder", async () => {
		const a = await device(null);
		const inFirst = gate();
		const leaveFirst = gate();
		let secondStarted = false;
		const first = a.newSync({
			inStep: async () => {
				inFirst.open();
				await leaveFirst.opened;
			},
		});
		const second = a.newSync({
			inStep: async () => {
				secondStarted = true;
			},
		});
		await a.put("notes.md", "a file, so each reconcile changes something\n");

		const running = first.reconcile("p1");
		await inFirst.opened;
		const waiting = second.reconcile("p1");
		await Bun.sleep(50);
		expect(secondStarted).toBe(false);

		leaveFirst.open();
		await Promise.all([running, waiting]);
		expect(secondStarted).toBe(true);
	});

	test("without one set of locks, a second instance scans in the middle of a step", async () => {
		const a = await device(null);
		const apart = a.newSync({ locks: createKnowledgeFolderLocks() });
		const hold = await a.sync.startStep("p1");
		await a.put("wiki/half.md", "half of what the step writes\n");

		await apart.reconcileUnlessHeld("p1");

		// This is what a reload did with a map in the module: it published half.
		expect([...(await a.entries()).keys()]).toEqual(["wiki/half.md"]);
		await hold.done();
	});
});
