import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import * as Y from "yjs";
import { type ArchiveHost, createSpaceArchive, sha256Of } from "../archive";
import { createSandbox, type Sandbox } from "../testing";
import { tinyDocx, tinyPdf } from "../testing/documents";
import { createKnowledgeFolders } from "./folder";
import {
	createKnowledgeDocuments,
	knowledgeEntries,
	knowledgeFiles,
} from "./knowledge-document";
import { proposeLearnings } from "./learnings";
import { createKnowledgeSync } from "./reconcile";

/**
 * The reconcile of a knowledge folder with its document (ADR 4), on two
 * Devices with a Host in memory between them. The documents sync by hand,
 * as a Link does.
 */

const sandboxes: Sandbox[] = [];
afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

/** A Host's archive in memory: content by hash. `down` is the network gone. */
function memoryHost() {
	const kept = new Map<string, Uint8Array>();
	const state = { down: false };
	const host: ArchiveHost = {
		async archivePut({ ref, content }) {
			if (state.down) throw new TypeError("The network connection was lost.");
			if (ref.kind !== "content" || typeof content === "string") return false;
			kept.set(ref.sha256, content.slice());
			return true;
		},
		async archiveGet(ref) {
			if (state.down) throw new TypeError("The network connection was lost.");
			if (ref.kind !== "content") return null;
			return kept.get(ref.sha256)?.slice() ?? null;
		},
	};
	return { kept, state, host };
}

/** A Device's archive, connected to `host` when there is one. */
function archiveOf(dataDir: string, host: ArchiveHost | null) {
	const archive = createSpaceArchive(dataDir);
	if (host) archive.connect(host);
	return archive;
}

/** A Device with project p1 and its knowledge, reaching `host`. */
async function device(host: ArchiveHost | null) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const folders = createKnowledgeFolders(sandbox.dataDir);
	const documents = createKnowledgeDocuments({ db: sandbox.db });
	const sync = createKnowledgeSync({
		db: sandbox.db,
		folders,
		documents,
		archive: archiveOf(sandbox.dataDir, host),
		deviceId: sandbox.deviceId,
		pageWaitMs: 5_000,
	});
	const dir = folders.folder("p1");
	const document = () => documents.open("p1");
	return {
		sandbox,
		folders,
		sync,
		dir,
		document,
		entries: async () => knowledgeEntries(await document()),
		put: async (path: string, text: string | Uint8Array, at?: number) => {
			const file = join(dir, path);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, text);
			if (at !== undefined) await utimes(file, at / 1000, at / 1000);
		},
		read: (path: string) => readFile(join(dir, path), "utf8"),
		has: (path: string) =>
			stat(join(dir, path)).then(
				() => true,
				() => false,
			),
	};
}
type TestDevice = Awaited<ReturnType<typeof device>>;

/** The documents of the Devices in step, as their Links leave them. */
async function syncDocuments(...devices: TestDevice[]) {
	const docs = await Promise.all(
		devices.map(async (d) => (await d.document()).doc),
	);
	for (const from of docs) {
		const update = Y.encodeStateAsUpdate(from);
		for (const to of docs) if (to !== from) Y.applyUpdate(to, update);
	}
}

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
		for (const folder of ["", "../x", "learnings", ".hidden"]) {
			await expect(a.sync.removeFolder("p1", folder)).rejects.toThrow(
				"Choose a folder inside the knowledge",
			);
		}
	});
});

describe("reconcile", () => {
	test("publishes a file the folder changed: content to the Host first, then its entry", async () => {
		const { kept, host } = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");

		const result = await a.sync.reconcile("p1");

		expect(result).toMatchObject({ published: 1, written: 0, unpushed: 0 });
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
		expect(await a.sync.reconcile("p1")).toMatchObject({ published: 0 });
	});

	test("writes an entry another Device changed into the folder, and its next change", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		expect(await b.sync.reconcile("p1")).toMatchObject({
			written: 1,
			published: 0,
		});
		expect(await b.read("wiki/Home.md")).toBe("# Home\n");

		await a.put("wiki/Home.md", "# Home, again\n", NOW + 60_000);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		expect(await b.sync.reconcile("p1")).toMatchObject({ written: 1 });
		expect(await b.read("wiki/Home.md")).toBe("# Home, again\n");
		// B wrote it, and did not change it: it publishes nothing.
		expect(await b.sync.reconcile("p1")).toMatchObject({
			published: 0,
			written: 0,
		});
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
		expect(await a.sync.reconcile("p1")).toMatchObject({ unpublished: 1 });
		expect((await a.entries()).has("wiki/Home.md")).toBe(false);
		await syncDocuments(a, b);

		expect(await b.sync.reconcile("p1")).toMatchObject({ removed: 1 });
		expect(await b.has("wiki/Home.md")).toBe(false);
		expect(await b.has("wiki")).toBe(false);
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
		expect(await b.sync.reconcile("p1")).toMatchObject({ published: 1 });
		await syncDocuments(a, b);
		expect(await a.sync.reconcile("p1")).toMatchObject({ written: 1 });
		expect(await a.read("notes.md")).toBe("from B, later\n");
		expect(await b.read("notes.md")).toBe("from B, later\n");

		// The other way round: B's change is the earlier one, and loses.
		await b.put("notes.md", "from B, early\n", NOW + 30_000);
		await a.put("notes.md", "from A, late\n", NOW + 40_000);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		expect(await b.sync.reconcile("p1")).toMatchObject({ written: 1 });
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
		await syncDocuments(a, b);
		// Yjs keeps one of two changes made at once: here, A's earlier one.
		const document = await a.document();
		await document.change(() => {
			knowledgeFiles(document).set("notes.md", earlier);
		});
		await syncDocuments(a, b);

		expect(await b.sync.reconcile("p1")).toMatchObject({
			published: 1,
			written: 0,
		});
		await syncDocuments(a, b);
		expect(await a.sync.reconcile("p1")).toMatchObject({ written: 1 });

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
		expect(await b.sync.reconcile("p1")).toMatchObject({ waiting: 1 });
		expect(await b.has("big.txt")).toBe(false);
		const listing = await b.sync.listing("p1");
		expect(listing.files).toEqual([
			{
				path: "big.txt",
				size: large.length,
				changedAt: entry?.changedAt as number,
				local: true,
			},
		]);
		await expect(b.sync.read("p1", "big.txt", 1024)).rejects.toThrow(
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

		expect(await a.sync.reconcile("p1")).toMatchObject({ published: 2 });
		expect(await a.has(".reconciled.json")).toBe(true);
		await syncDocuments(a, b);
		expect(await b.sync.reconcile("p1")).toMatchObject({
			published: 1,
			written: 2,
		});
		await syncDocuments(a, b);
		await a.sync.reconcile("p1");

		for (const d of [a, b]) {
			expect(await d.read("wiki/Home.md")).toBe("A's home\n");
			expect(await d.read("wiki/Only-A.md")).toBe("only on A\n");
			expect(await d.read("wiki/Only-B.md")).toBe("only on B\n");
		}
	});

	test("offline: content waits to be copied, a fetch that fails keeps the old file, and both go on later", async () => {
		const { state, host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("notes.md", "v1\n", NOW);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);
		await b.sync.reconcile("p1");

		state.down = true;
		await a.put("notes.md", "v2\n", NOW + 10_000);
		expect(await a.sync.reconcile("p1")).toMatchObject({
			published: 1,
			unpushed: 1,
		});
		await syncDocuments(a, b);
		expect(await b.sync.reconcile("p1")).toMatchObject({ waiting: 1 });
		expect(await b.read("notes.md")).toBe("v1\n");

		state.down = false;
		// The Host does not have v2 yet: B still waits.
		expect(await b.sync.reconcile("p1")).toMatchObject({ waiting: 1 });
		// A copies what waited at its next reconcile.
		expect(await a.sync.reconcile("p1")).toMatchObject({ unpushed: 0 });
		expect(await b.sync.reconcile("p1")).toMatchObject({
			written: 1,
			waiting: 0,
		});
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
		const document = await a.document();
		const home = (await a.entries()).get("wiki/Home.md");
		await document.change(() => {
			const files = knowledgeFiles(document);
			for (const path of ["../outside.md", ".hidden", "index.md", "a//b"]) {
				files.set(path, home);
			}
		});
		await syncDocuments(a, b);
		expect(await b.sync.reconcile("p1")).toMatchObject({ written: 1 });
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
		expect(await b.sync.reconcile("p1")).toMatchObject({ waiting: 1 });
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
		const fresh = createKnowledgeSync({
			db: a.sandbox.db,
			folders: a.folders,
			documents: { open: async () => blankDocument(), remove: async () => {} },
			archive: archiveOf(a.sandbox.dataDir, host),
			deviceId: a.sandbox.deviceId,
		});
		expect(await fresh.reconcile("p1")).toMatchObject({
			published: 1,
			removed: 0,
		});
		expect(await a.read("notes.md")).toBe("kept\n");
	});

	test("lists the document's files and counts the proposed notes", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.put("logo.png", new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
		await proposeLearnings(a.dir, { runId: "run-1" }, [
			"Use bun.",
			"Tests are slow.",
		]);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		const listing = await b.sync.listing("p1");
		expect(listing.files.map((f) => f.path)).toEqual([
			"logo.png",
			"wiki/Home.md",
		]);
		expect(listing.proposed).toBe(2);
		// The sandbox's Space is the personal one of its Person.
		expect(listing.shared).toBe(false);
	});
});

describe("read", () => {
	/** A's folder has the files, B has them by hash only: both must read alike. */
	async function twoDevices() {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const both = async () => {
			await a.sync.reconcile("p1");
			await syncDocuments(a, b);
		};
		return { a, b, both };
	}

	test("a file reads the same from this Device's folder and by its hash", async () => {
		const { a, b, both } = await twoDevices();
		await a.put("wiki/a.md", "# Alpha\n\nSome text here.\n");
		await a.put(
			"docs/guide.docx",
			tinyDocx("Onboarding guide", ["Every new teammate meets the wombat."]),
		);
		await a.put(
			"docs/release.pdf",
			tinyPdf(["Release checklist", "We ship on Fridays."]),
		);
		await both();
		expect(await b.has("wiki/a.md")).toBe(false);
		for (const path of ["wiki/a.md", "docs/guide.docx", "docs/release.pdf"]) {
			const here = await a.sync.read("p1", path, 1024);
			expect(await b.sync.read("p1", path, 1024)).toEqual(here);
			expect(await b.sync.read("p1", path, 7)).toEqual(
				await a.sync.read("p1", path, 7),
			);
		}
		expect(await a.sync.read("p1", "./wiki/a.md", 1024)).toEqual({
			path: "wiki/a.md",
			title: "Alpha",
			text: "# Alpha\n\nSome text here.\n",
			size: 25,
			truncated: false,
		});
		expect(await b.sync.read("p1", "wiki/a.md", 7)).toMatchObject({
			text: "# Alpha",
			truncated: true,
		});
		expect(await b.sync.read("p1", "docs/guide.docx", 1024)).toMatchObject({
			title: "Onboarding guide",
			text: "Onboarding guide\n\nEvery new teammate meets the wombat.",
		});
		expect(await b.sync.read("p1", "docs/release.pdf", 1024)).toMatchObject({
			title: "Release checklist",
		});
	});

	test("never a proposal, a hidden file, a link or a path out of the folder: here or by hash", async () => {
		const { a, b, both } = await twoDevices();
		await writeFile(join(a.sandbox.root, "outside.md"), "secret");
		await a.put(".hidden.md", "hidden");
		await proposeLearnings(a.dir, { runId: "run-1" }, ["Use bun."]);
		await mkdir(a.dir, { recursive: true });
		await symlink(join(a.sandbox.root, "outside.md"), join(a.dir, "link.md"));
		await both();
		expect((await b.entries()).has("learnings/proposed/run-1.md")).toBe(true);
		for (const reader of [a, b]) {
			for (const path of [
				"../outside.md",
				"/etc/hosts",
				"wiki/../../outside.md",
				".hidden.md",
				"learnings/proposed/run-1.md",
				"link.md",
				"missing.md",
				"",
				"wiki",
			]) {
				expect(await reader.sync.read("p1", path, 1024)).toBeNull();
			}
		}
	});

	test("refuses a file that is not text, and a document it cannot read: here and by hash", async () => {
		const { a, b, both } = await twoDevices();
		await a.put("logo.png", new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
		await a.put("broken.pdf", "not a pdf");
		await both();
		for (const reader of [a, b]) {
			const binary = reader.sync.read("p1", "logo.png", 1024);
			await expect(binary).rejects.toBeInstanceOf(Refusal);
			await expect(binary).rejects.toThrow('"logo.png" is not a text file.');
			const broken = reader.sync.read("p1", "broken.pdf", 1024);
			await expect(broken).rejects.toBeInstanceOf(Refusal);
			await expect(broken).rejects.toThrow("cannot read the text");
		}
	});
});

/** A knowledge document of a new Replica: it never had an update. */
function blankDocument() {
	const doc = new Y.Doc();
	return {
		name: "knowledge:p1",
		doc,
		revision: () => 0,
		change: async (fn: () => void) => doc.transact(fn),
		flush: async () => {},
		close: async () => {},
	};
}
