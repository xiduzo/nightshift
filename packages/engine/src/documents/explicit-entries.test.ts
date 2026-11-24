import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cliTool, spaceMerge, spaceSplit, ydoc } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { inMemoryComputer } from "../access/computer/adapters/out/in-memory-computer";
import { wireCliTools } from "../settings/cli-tools";
import { aloneDirectory } from "../testing/alone-directory";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { openDeviceDocument } from "./device-document";
import {
	createSpaceDocuments,
	spaceDocumentName,
	spaceProjects,
} from "./space/space-document";
import { createSyncedDocuments } from "./synced-documents";

/**
 * The conversion that writes the defaults of a stored entry, over the real
 * document store. It goes with `explicit-entries.ts`.
 */

let sandbox: Sandbox;
let log: ReturnType<typeof spyOn<Console, "log">>;
let failure: ReturnType<typeof spyOn<Console, "error">>;
beforeEach(async () => {
	sandbox = await createSandbox();
	log = spyOn(console, "log").mockImplementation(() => {});
	failure = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
	log.mockRestore();
	failure.mockRestore();
	await sandbox.cleanup();
});

const entry = (name: string, more: Record<string, unknown> = {}) => ({
	name,
	remote: `github.com/acme/${name}`,
	createdAt: 1,
	removedAt: null,
	updatedAt: 2,
	...more,
});
const tool = (more: Record<string, unknown> = {}) => ({
	description: "GitHub",
	updatedAt: 5,
	...more,
});

/** Stores a document as another build left it: no hook of ours runs. */
async function keep(name: string, fill: (doc: Y.Doc) => void) {
	const doc = new Y.Doc();
	const [row] = await sandbox.db.select().from(ydoc).where(eq(ydoc.name, name));
	if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
	fill(doc);
	const state = Buffer.from(Y.encodeStateAsUpdate(doc));
	await sandbox.db
		.insert(ydoc)
		.values({ name, state })
		.onConflictDoUpdate({ target: ydoc.name, set: { state } });
}

const keepProjects = (projects: Record<string, unknown>) =>
	keep(spaceDocumentName(sandbox.spaceId), (doc) => {
		for (const [id, value] of Object.entries(projects)) {
			doc.getMap("projects").set(id, value);
		}
	});

const keepTools = (tools: Record<string, unknown>) =>
	keep(`device:${sandbox.deviceId}`, (doc) => {
		for (const [name, value] of Object.entries(tools)) {
			doc.getMap("cliTools").set(name, value);
		}
	});

type Directory = Parameters<typeof createSpaceDocuments>[0]["directory"];

/** One start: the Space documents over a store of their own. */
async function startSpace(directory: Partial<Directory> = {}) {
	const documents = createSpaceDocuments({
		db: sandbox.db,
		directory: { ...aloneDirectory(sandbox.db), ...directory },
	});
	const document = await documents.open(sandbox.spaceId);
	await documents.flush();
	return document;
}

const startDevice = (documents?: ReturnType<typeof createSyncedDocuments>) =>
	openDeviceDocument({
		db: sandbox.db,
		deviceId: sandbox.deviceId,
		...(documents ? { documents } : {}),
	});

const vector = (doc: Y.Doc) => [...Y.encodeStateVector(doc)];
const lines = () => log.mock.calls.flat().filter((l) => /^Explicit/.test(l));

describe("the projects of a Space", () => {
	test("each gets folder: true, and keeps every other field, also an unknown one", async () => {
		await keepProjects({
			p1: entry("app", { later: { nested: [1] } }),
			p2: entry("feeds", { folder: false, remote: null }),
			p3: entry("site", { folder: true }),
			p4: "not an entry",
			p5: { name: 7 },
			p6: ["a", "list"],
		});
		const document = await startSpace();
		expect(document.projects.toJSON()).toEqual({
			p1: entry("app", { folder: true, later: { nested: [1] } }),
			p2: entry("feeds", { folder: false, remote: null }),
			p3: entry("site", { folder: true }),
			p4: "not an entry",
			p5: { name: 7, folder: true },
			p6: ["a", "list"],
		});
		expect(lines()).toEqual(["Explicit projects: 2 of 6 written."]);
	});

	test("a second start changes nothing", async () => {
		await keepProjects({ p1: entry("app") });
		const first = await startSpace();
		const again = await startSpace();
		expect(vector(again.doc)).toEqual(vector(first.doc));
		expect(Y.encodeStateAsUpdate(again.doc)).toEqual(
			Y.encodeStateAsUpdate(first.doc),
		);
		expect(lines()).toHaveLength(1);
	});

	test("a Space a Host keeps is not written", async () => {
		await keepProjects({ p1: entry("app") });
		const document = await startSpace({ hostedElsewhere: async () => true });
		expect(document.projects.get("p1")).toEqual(entry("app"));
	});

	test("a Space that gets another keeper while it opens is not written", async () => {
		// Imported and mirrored: the second ask is the conversion's own.
		await startSpace();
		await keepProjects({ p1: entry("app") });
		let asked = 0;
		const document = await startSpace({
			hostedElsewhere: async () => ++asked > 1,
		});
		expect(document.projects.get("p1")).toEqual(entry("app"));
	});

	for (const side of ["fromSpace", "toSpace"] as const) {
		test(`an unfinished merge (${side}) waits, a finished one does not`, async () => {
			await keepProjects({ p1: entry("app") });
			await sandbox.db.insert(spaceMerge).values({
				fromSpace: "other",
				hostId: "host",
				personId: "person",
				state: "moved",
				backup: "copy.db",
				[side]: sandbox.spaceId,
			});
			const waiting = await startSpace();
			expect(waiting.projects.get("p1")).toEqual(entry("app"));
			expect(lines()).toEqual([
				"Explicit projects: 1 Space waits for its move.",
			]);

			await sandbox.db.update(spaceMerge).set({ state: "pushed" });
			const document = await startSpace();
			expect(document.projects.get("p1")).toMatchObject({ folder: true });
		});

		test(`an unfinished split (${side}) waits, a finished one does not`, async () => {
			await keepProjects({ p1: entry("app") });
			await sandbox.db.insert(spaceSplit).values({
				toSpace: "other",
				fromSpace: "another",
				hostId: "host",
				hostName: "Host",
				personId: "person",
				hostPersonId: "person",
				state: "moved",
				backup: "copy.db",
				[side]: sandbox.spaceId,
			});
			const waiting = await startSpace();
			expect(waiting.projects.get("p1")).toEqual(entry("app"));

			await sandbox.db.update(spaceSplit).set({ state: "done" });
			const document = await startSpace();
			expect(document.projects.get("p1")).toMatchObject({ folder: true });
		});
	}

	test("the move of another Space does not hold this one", async () => {
		await sandbox.db.insert(spaceMerge).values({
			fromSpace: "third",
			hostId: "host",
			personId: "person",
			state: "planned",
			backup: "copy.db",
		});
		await keepProjects({ p1: entry("app") });
		const document = await startSpace();
		expect(document.projects.get("p1")).toMatchObject({ folder: true });
	});

	test("a failure is logged and the document opens", async () => {
		await startSpace();
		await keepProjects({ p1: entry("app") });
		let asked = 0;
		const document = await startSpace({
			hostedElsewhere: async () => {
				if (++asked === 2) throw new Error("no answer");
				return false;
			},
		});
		expect(spaceProjects(document).get("p1")?.name).toBe("app");
		expect(failure.mock.calls.flat().join(" ")).toContain("no answer");
	});

	test("a rename that lands while the keeper is asked is kept", async () => {
		// Imported and mirrored: the second ask is the conversion's own.
		await startSpace();
		await keepProjects({ p1: entry("app") });
		const synced = createSyncedDocuments({ db: sandbox.db });
		let opened: Y.Doc | null = null;
		let asked = 0;
		const documents = createSpaceDocuments({
			db: sandbox.db,
			documents: {
				...synced,
				handle: (kind, hooks) =>
					synced.handle(kind, {
						...hooks,
						opened: async (document) => {
							opened = document.doc;
							await hooks.opened?.(document);
						},
					}),
			},
			directory: {
				...aloneDirectory(sandbox.db),
				hostedElsewhere: async () => {
					if (++asked === 2) {
						opened?.getMap("projects").set("p1", entry("renamed"));
					}
					return false;
				},
			},
		});
		const document = await documents.open(sandbox.spaceId);
		await documents.flush();
		expect(document.projects.get("p1")).toEqual(
			entry("renamed", { folder: true }),
		);
	});

	test("two writers: a rename made elsewhere at the same time wins, on both sides", async () => {
		for (let turn = 0; turn < 20; turn++) {
			await keepProjects({ p1: entry("app") });
			const [row] = await sandbox.db.select().from(ydoc);
			const peer = new Y.Doc();
			Y.applyUpdate(peer, new Uint8Array(row?.state as Buffer));
			peer.getMap("projects").set("p1", entry("renamed"));

			const document = await startSpace();
			expect(document.projects.get("p1")).toEqual(
				entry("app", { folder: true }),
			);
			Y.applyUpdate(document.doc, Y.encodeStateAsUpdate(peer));
			Y.applyUpdate(peer, Y.encodeStateAsUpdate(document.doc));
			expect(peer.getMap("projects").toJSON()).toEqual({
				p1: entry("renamed"),
			});
			expect(document.projects.toJSON()).toEqual({ p1: entry("renamed") });
			await document.flush();

			// The next start adds the field to it.
			const again = await startSpace();
			expect(again.projects.get("p1")).toEqual(
				entry("renamed", { folder: true }),
			);
		}
	});

	test("a later change of this Replica has its own client id", async () => {
		await keepProjects({ p1: entry("app") });
		const document = await startSpace();
		expect(document.doc.clientID).toBeGreaterThan(0xffff);
	});
});

describe("the CLI tools of a Device", () => {
	const git = { host: "github.com", helper: "auth git-credential" };

	test("each gets the fields it misses, with what the reader gives today", async () => {
		const stored = {
			gh: tool({ later: true }),
			work: tool({ program: "gh" }),
			full: tool({ program: "gh", login: null, git }),
			broken: "not an entry",
		};
		await keepTools(stored);
		// What the reader gives for the entries before they change.
		const raw = await createSyncedDocuments({ db: sandbox.db }).open(
			`device:${sandbox.deviceId}`,
		);
		const read = (document: Awaited<ReturnType<typeof startDevice>>) =>
			wireCliTools({ computerAccess: inMemoryComputer(), document }).list();
		const before = read({
			...raw,
			cliTools: raw.doc.getMap("cliTools"),
		} as Awaited<ReturnType<typeof startDevice>>);

		const document = await startDevice();
		expect(document.cliTools.toJSON()).toEqual({
			gh: tool({ later: true, program: null, login: null, git: null }),
			work: tool({ program: "gh", login: null, git: null }),
			full: stored.full,
			broken: "not an entry",
		});
		expect(before).toHaveLength(3);
		expect(read(document)).toEqual(before);
		expect(lines()).toEqual(["Explicit CLI tools: 2 of 4 written."]);
	});

	test("the import of a new document writes them itself", async () => {
		await sandbox.db.insert(cliTool).values({ name: "gh" });
		const document = await startDevice();
		expect(document.cliTools.get("gh")).toMatchObject({
			program: null,
			login: null,
			git: null,
		});
		expect(lines()).toEqual([]);
	});

	test("a login this version cannot read stays in the document", async () => {
		await keepTools({ gh: tool({ login: { later: 1 } }) });
		const document = await startDevice();
		expect(document.cliTools.get("gh")).toEqual(
			tool({ login: { later: 1 }, program: null, git: null }),
		);
	});

	test("a second start changes nothing", async () => {
		await keepTools({ gh: tool() });
		const first = await startDevice();
		const again = await startDevice();
		expect(vector(again.doc)).toEqual(vector(first.doc));
		expect(lines()).toHaveLength(1);
	});

	test("a failure is logged and the document opens", async () => {
		await keepTools({ gh: tool() });
		// The import of a first start is done before the failure.
		const synced = createSyncedDocuments({ db: sandbox.db });
		let changes = 0;
		const document = await startDevice({
			...synced,
			open: async (name) => {
				const opened = await synced.open(name);
				return {
					...opened,
					change: async (fn) => {
						if (++changes === 2) throw new Error("no room");
						return opened.change(fn);
					},
				};
			},
		});
		expect(document.cliTools.get("gh")).toEqual(tool());
		expect(failure.mock.calls.flat().join(" ")).toContain("no room");
	});
});
