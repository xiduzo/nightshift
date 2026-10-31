import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import {
	createLocalSession,
	documentAccess,
	localPerson,
	type SyncDeviceKey,
} from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	turnOnTwoFactor,
} from "@nightshift/auth/testing";
import { project } from "@nightshift/db/schema";
import { deviceDirectory } from "@nightshift/devices";
import {
	createFlowDocuments,
	createKnowledgeDocuments,
	createSyncedDocuments,
	type FlowDocuments,
	type KnowledgeDocuments,
	type SyncedDocuments,
} from "@nightshift/engine";
import {
	type DeviceDocument,
	openDeviceDocument,
} from "@nightshift/engine/device-config";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import {
	createCliToolStore,
	createProjectFlows,
	createSandbox,
	createSettingsStore,
	type Sandbox,
	spaceDocumentName,
	waitFor,
} from "@nightshift/engine/testing";
import {
	type Flow,
	flowSchema,
	parsedFlows,
	singleAgentFlow,
} from "@nightshift/flows";
import type { Server } from "bun";
import * as Y from "yjs";
import { isThisComputer } from "../http";
import { hotSlots } from "../runtime";
import {
	createSync,
	type KeptSync,
	keepSync,
	type SocketData,
	type Sync,
} from "./sync";

/**
 * Hocuspocus 4 under Bun 1.3, in-process: Bun.serve accepts the socket and
 * hands it to Hocuspocus's `handleConnection`; a `HocuspocusProvider`
 * syncs the Device document through it.
 */

let sandbox: Sandbox;
let people: AuthSandbox;
/** A session of a Person who does not own this computer. */
let stranger: Headers;
let document: DeviceDocument;
/** Every document this Host syncs, by name: the views below are over them. */
let synced: SyncedDocuments;
let spaces: SpaceDocuments;
/** The flow documents of this Host's Projects. */
let flows: FlowDocuments;
/** The knowledge documents of this Host's Projects. */
let knowledge: KnowledgeDocuments;
let sync: Sync;
let server: Server<SocketData>;
const providers: HocuspocusProvider[] = [];

const ORIGIN = "http://localhost:3001";

/** The Person who owns this computer. */
let ownerId: string;
/** Device keys this test's Host knows: token → the key, resolved. */
let deviceKeys: Map<string, SyncDeviceKey>;
/** Documents this test's Host keeps for paired Devices: name → owner. */
let keptOwners: Map<string, string>;
let keptRows: Map<string, Uint8Array>;

beforeEach(async () => {
	sandbox = await createSandbox();
	people = await createAuthSandbox();
	const owner = await localPerson(people.db);
	ownerId = owner.userId;
	stranger = (await people.signUp("Dee")).headers;
	deviceKeys = new Map();
	keptOwners = new Map();
	keptRows = new Map();
	synced = createSyncedDocuments({ db: people.db });
	spaces = createSpaceDocuments({
		db: people.db,
		directory: deviceDirectory(people.db),
		documents: synced,
	});
	// This computer's Device document, among the documents the relay serves.
	document = await openDeviceDocument({
		db: people.db,
		deviceId: sandbox.deviceId,
		documents: synced,
	});
	flows = createFlowDocuments({ db: people.db, documents: synced });
	knowledge = createKnowledgeDocuments({ db: people.db, documents: synced });
	sync = createSync({
		document: async (name) => (await synced.find(name))?.doc ?? null,
		kept: {
			has: (name) => keptOwners.has(name),
			fetch: async (name) => keptRows.get(name) ?? null,
			store: async (name, state) => {
				keptRows.set(name, state);
			},
		},
		authorize: documentAccess({
			auth: people.auth,
			db: people.db,
			localSession: createLocalSession(people.auth, people.db, owner.userId),
			ownerId: owner.userId,
			isThisComputer: (peer, request) =>
				isThisComputer(peer, request, new Set([ORIGIN])),
			documentOf: (name) => synced.documentOf(name),
			keptOwner: async (name) => keptOwners.get(name) ?? null,
			deviceKey: async (token) => deviceKeys.get(token) ?? null,
		}),
	});
	server = Bun.serve<SocketData>({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request, s) =>
			new URL(request.url).pathname === "/sync"
				? sync.upgrade(request, s)
				: new Response("OK"),
		websocket: sync.websocket,
	});
});

afterEach(async () => {
	for (const provider of providers.splice(0)) provider.destroy();
	await sync.close();
	server.stop(true);
	await synced.close();
	await sandbox.cleanup();
	people.cleanup();
});

/** A client of the relay, as a UI or another Device opens one. */
function connect(
	name = document.name,
	options: {
		origin?: string;
		cookie?: string;
		token?: string;
		/** The client's own copy: a Device's document. Default: a new one. */
		doc?: Y.Doc;
	} = {},
) {
	const doc = options.doc ?? new Y.Doc();
	const failed: string[] = [];
	// A browser sends its page's origin and cookies; Bun's WebSocket takes headers.
	const headers: Record<string, string> = {};
	if (options.origin) headers.origin = options.origin;
	if (options.cookie) headers.cookie = options.cookie;
	class FromOrigin extends WebSocket {
		constructor(url: string) {
			super(url, { headers } as never);
		}
	}
	const provider = new HocuspocusProvider({
		websocketProvider: new HocuspocusProviderWebsocket({
			url: `ws://127.0.0.1:${server.port}/sync`,
			WebSocketPolyfill: FromOrigin,
		}),
		name,
		document: doc,
		token: options.token ?? "this-computer",
		onAuthenticationFailed: ({ reason }) => {
			failed.push(reason);
		},
	});
	// A provider on a socket of its own making attaches itself; on one it is given, it waits.
	provider.attach();
	providers.push(provider);
	return { doc, provider, failed };
}

describe("Hocuspocus on Bun", () => {
	test("a client gets the Owner's document, and the edits go both ways", async () => {
		const tools = createCliToolStore({ document });
		await tools.save({ name: "gh", description: "GitHub" });

		const client = connect();
		await waitFor(() => client.provider.isSynced);
		expect(client.doc.getMap("cliTools").get("gh")).toMatchObject({
			description: "GitHub",
		});

		// The client edits: the Owner's stores see it.
		client.doc
			.getMap("cliTools")
			.set("jq", { description: "JSON", updatedAt: 1 });
		await waitFor(() => tools.get("jq") !== null);

		// The Owner edits: the client sees it.
		await tools.remove("gh");
		await waitFor(() => !client.doc.getMap("cliTools").has("gh"));
	});

	test("two clients converge through the relay", async () => {
		const settings = createSettingsStore({ document, env: {} });
		const a = connect();
		const b = connect();
		await waitFor(() => a.provider.isSynced && b.provider.isSynced);

		a.doc.getMap("settings").set("agentModel", "opus");
		b.doc.getMap("settings").set("maxConcurrentRuns", 4);
		await waitFor(
			() =>
				a.doc.getMap("settings").get("maxConcurrentRuns") === 4 &&
				b.doc.getMap("settings").get("agentModel") === "opus",
		);
		expect(settings.current()).toMatchObject({
			agentModel: "opus",
			maxConcurrentRuns: 4,
		});
	});

	test("a client's edit lasts across a restart of the Owner", async () => {
		const client = connect();
		await waitFor(() => client.provider.isSynced);
		client.doc
			.getMap("cliTools")
			.set("aws", { description: null, updatedAt: 1 });
		await waitFor(() => document.cliTools.has("aws"));
		await document.flush();

		const again = createCliToolStore({
			document: await openDeviceDocument({
				db: people.db,
				deviceId: sandbox.deviceId,
			}),
		});
		expect([...again.names()]).toEqual(["aws"]);
	});

	test("a document this computer does not own is refused", async () => {
		const client = connect("device:someone-else");
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});

	test("the UI's origin gets in; a web page of another origin does not", async () => {
		const ui = connect(document.name, { origin: ORIGIN });
		const page = connect(document.name, { origin: "https://evil.example" });
		await waitFor(() => ui.provider.isSynced && page.failed.length > 0);
		expect(page.provider.isSynced).toBe(false);
		expect(page.doc.getMap("meta").size).toBe(0);
	});
});

describe("documentAccess: the Device document", () => {
	test("another Person is refused, even on this computer", async () => {
		const client = connect(document.name, {
			origin: ORIGIN,
			cookie: stranger.get("cookie") ?? "",
		});
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});
});

describe("documentAccess: a Space document", () => {
	/** Platform: Ada owns it, Bob is a member, Cy a viewer. Dee is not in it. */
	async function platform() {
		const ada = await people.signUp("Ada");
		const bob = await people.signUp("Bob");
		const cy = await people.signUp("Cy");
		const space = await people.auth.api.createOrganization({
			headers: ada.headers,
			body: { name: "Platform", slug: "platform" },
		});
		if (!space) throw new Error("no space");
		for (const [person, role] of [
			[bob, "member"],
			[cy, "viewer"],
		] as const) {
			await people.auth.api.addMember({
				body: { userId: person.userId, role, organizationId: space.id },
			});
		}
		const opened = await spaces.open(space.id);
		const cookie = (headers: Headers) => headers.get("cookie") ?? "";
		return {
			opened,
			spaceId: space.id,
			name: spaceDocumentName(space.id),
			ada: ada.headers,
			bob: cookie(bob.headers),
			cy: cookie(cy.headers),
		};
	}

	const entry = (name: string) => ({
		name,
		remote: null,
		createdAt: 1,
		removedAt: null,
		updatedAt: 1,
	});

	test("a member and a viewer read it; neither writes through the relay", async () => {
		const { opened, name, bob, cy } = await platform();
		expect(opened.members.size).toBe(3);
		const member = connect(name, { origin: ORIGIN, cookie: bob });
		const viewer = connect(name, { origin: ORIGIN, cookie: cy });
		await waitFor(() => member.provider.isSynced && viewer.provider.isSynced);
		expect(member.doc.getMap("members").size).toBe(3);

		member.doc.getMap("projects").set("p-bob", entry("From Bob"));
		viewer.doc.getMap("projects").set("p-cy", entry("From Cy"));
		// The Owner's own write (through a procedure) reaches both.
		await opened.change(() => {
			opened.projects.set("p-owner", entry("From the engine"));
		});
		await waitFor(
			() =>
				member.doc.getMap("projects").has("p-owner") &&
				viewer.doc.getMap("projects").has("p-owner"),
		);
		expect(opened.projects.has("p-bob")).toBe(false);
		expect(opened.projects.has("p-cy")).toBe(false);
		const rows = await people.db.select().from(project);
		expect(rows.map((row) => row.name)).toEqual(["From the engine"]);
	});

	test("a Person outside the Space is refused", async () => {
		const { name } = await platform();
		const outsider = connect(name, {
			origin: ORIGIN,
			cookie: stranger.get("cookie") ?? "",
		});
		await waitFor(() => outsider.failed.length > 0);
		expect(outsider.provider.isSynced).toBe(false);
		expect(outsider.doc.getMap("members").size).toBe(0);
	});

	test("a removed member is refused", async () => {
		const { spaceId, name, ada, bob } = await platform();
		await people.auth.api.removeMember({
			headers: ada,
			body: { memberIdOrEmail: "bob@example.com", organizationId: spaceId },
		});
		const removed = connect(name, { origin: ORIGIN, cookie: bob });
		await waitFor(() => removed.failed.length > 0);
		expect(removed.provider.isSynced).toBe(false);
	});

	test("this computer's Person is not a member of another Person's Space", async () => {
		const { name } = await platform();
		const local = connect(name, { origin: ORIGIN });
		await waitFor(() => local.failed.length > 0);
		expect(local.provider.isSynced).toBe(false);
	});
});

describe("documentAccess on a Host that requires two-factor", () => {
	/** The relay's check, with the requirement on. */
	const authorize = () =>
		documentAccess({
			auth: people.auth,
			db: people.db,
			localSession: createLocalSession(people.auth, people.db, ownerId),
			ownerId,
			isThisComputer: (peer, request) =>
				isThisComputer(peer, request, new Set([ORIGIN])),
			documentOf: (name) => synced.documentOf(name),
			policy: { requireTwoFactor: true },
		});

	/** A socket's upgrade through a tunnel on this computer: it adds its header. */
	function throughTunnel(headers: Headers, documentName: string) {
		return authorize()({
			documentName,
			token: "browser",
			peer: "127.0.0.1",
			request: new Request("https://studio.example.com/sync", {
				headers: {
					origin: ORIGIN,
					cookie: headers.get("cookie") ?? "",
					"cf-connecting-ip": "203.0.113.9",
				},
			}),
		});
	}

	test("a session from another computer opens nothing until its Person turns two-factor on", async () => {
		const ada = await people.signUp("Ada");
		const space = await people.auth.api.createOrganization({
			headers: ada.headers,
			body: { name: "Platform", slug: "platform" },
		});
		if (!space) throw new Error("no space");
		await spaces.open(space.id);
		const name = spaceDocumentName(space.id);
		expect(await throughTunnel(ada.headers, name)).toBe(false);
		const { headers } = await turnOnTwoFactor(people.auth, ada.headers);
		expect(await throughTunnel(headers, name)).toBe("read");
	});

	test("this computer still opens its own document", async () => {
		const access = await authorize()({
			documentName: document.name,
			token: "this-computer",
			peer: "127.0.0.1",
			request: new Request(`http://localhost:${server.port}/sync`, {
				headers: { origin: ORIGIN },
			}),
		});
		expect(access).toBe("write");
	});
});

describe("Device keys on the relay", () => {
	const KEY = "nsd_the-key-of-device-b";
	const B = "device:device-b";

	/** Device B, paired with this Host as its home, of this computer's Person. */
	function pairB(home = true) {
		keptOwners.set(B, ownerId);
		deviceKeys.set(KEY, { deviceId: "device-b", personId: ownerId, home });
	}

	test("a Device opens its own document on its home Host, and the Host keeps it", async () => {
		pairB();
		const device = connect(B, { token: KEY });
		await waitFor(() => device.provider.isSynced);
		device.doc.getMap("facts").set("platform", "darwin");

		// The owner's UI on the Host sees it, and the Host stores it.
		const ui = connect(B, { origin: ORIGIN });
		await waitFor(() => ui.doc.getMap("facts").get("platform") === "darwin");
		await waitFor(() => keptRows.has(B), { timeoutMs: 15_000 });

		// Not for another Person.
		const page = connect(B, {
			origin: ORIGIN,
			cookie: stranger.get("cookie") ?? "",
		});
		await waitFor(() => page.failed.length > 0);
	}, 20_000);

	describe("the documents of the owner's other Devices (ADR 1, decision 2)", () => {
		const C = "device:device-c";
		const D = "device:device-d";

		/** C is another home Device of the owner. D is a home Device of Dee. */
		async function others() {
			pairB();
			keptOwners.set(C, ownerId);
			keptOwners.set(D, (await people.signUp("Dee3")).userId);
			const writer = connect(C, { origin: ORIGIN });
			await waitFor(() => writer.provider.isSynced);
			writer.doc
				.getMap("facts")
				.set("secrets", [{ name: "GH_TOKEN", setAt: 1 }]);
			return writer;
		}

		test("a home Device reads another Device of its owner, and writes nothing to it", async () => {
			const writer = await others();
			const reader = connect(C, { token: KEY });
			await waitFor(
				() => reader.doc.getMap("facts").get("secrets") !== undefined,
			);
			expect(reader.doc.getMap("facts").get("secrets")).toEqual([
				{ name: "GH_TOKEN", setAt: 1 },
			]);

			reader.doc.getMap("facts").set("platform", "from-b");
			await Bun.sleep(100);
			expect(writer.doc.getMap("facts").get("platform")).toBeUndefined();
		});

		test("a home Device reads the Host's own document when its owner owns the Host, and writes nothing to it", async () => {
			pairB();
			document.doc.getMap("facts").set("platform", "linux");
			const reader = connect(document.name, { token: KEY });
			await waitFor(
				() => reader.doc.getMap("facts").get("platform") === "linux",
			);
			reader.doc.getMap("facts").set("platform", "from-b");
			await Bun.sleep(100);
			expect(document.facts.get("platform")).toBe("linux");
		});

		test("another Person's Device document is refused", async () => {
			await others();
			const client = connect(D, { token: KEY });
			await waitFor(() => client.failed.length > 0);
			expect(client.provider.isSynced).toBe(false);
		});

		test("a Device of another Person reads neither the owner's Devices nor the Host's own", async () => {
			await others();
			deviceKeys.set("nsd_dee", {
				deviceId: "device-d",
				personId: keptOwners.get(D) as string,
				home: true,
			});
			for (const name of [C, document.name]) {
				const client = connect(name, { token: "nsd_dee" });
				await waitFor(() => client.failed.length > 0);
				expect(client.provider.isSynced).toBe(false);
			}
		});

		test("over a Guest Host a Device reads no other Device's document", async () => {
			await others();
			deviceKeys.set(KEY, {
				deviceId: "device-b",
				personId: ownerId,
				home: false,
			});
			for (const name of [C, document.name]) {
				const client = connect(name, { token: KEY });
				await waitFor(() => client.failed.length > 0);
				expect(client.provider.isSynced).toBe(false);
			}
		});
	});

	test("a guest Host never opens a Device document to a key", async () => {
		pairB(false);
		const client = connect(B, { token: KEY });
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});

	test("a key of another Person is refused", async () => {
		keptOwners.set(B, ownerId);
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: "someone",
			home: true,
		});
		const client = connect(B, { token: KEY });
		await waitFor(() => client.failed.length > 0);
	});

	test("an unknown key from this computer does not get the local session", async () => {
		const client = connect(document.name, { token: "nsd_unknown" });
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});

	test("a Device reads the Space documents of its owner's Spaces, and writes none", async () => {
		const dee = (await people.signUp("Dee2")).userId;
		const space = await people.auth.api.createOrganization({
			body: { name: "Platform", slug: "platform", userId: ownerId },
		});
		if (!space) throw new Error("no space");
		const opened = await spaces.open(space.id);
		const name = spaceDocumentName(space.id);

		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: ownerId,
			home: false,
		});
		const device = connect(name, { token: KEY });
		await waitFor(() => device.provider.isSynced);
		device.doc.getMap("projects").set("p-device", {
			name: "From the Device",
			remote: null,
			createdAt: 1,
			removedAt: null,
			updatedAt: 1,
		});
		await Bun.sleep(100);
		expect(opened.projects.has("p-device")).toBe(false);

		// A Device of a Person outside the Space: refused.
		deviceKeys.set("nsd_other", {
			deviceId: "device-d",
			personId: dee,
			home: true,
		});
		const other = connect(name, { token: "nsd_other" });
		await waitFor(() => other.failed.length > 0);
	});

	test("removing a Device's access ends its connections", async () => {
		pairB();
		const device = connect(B, { token: KEY });
		const ui = connect(B);
		await waitFor(() => device.provider.isSynced && ui.provider.isSynced);

		deviceKeys.delete(KEY);
		sync.disconnect((context) => context.deviceId === "device-b");
		await waitFor(() => device.failed.length > 0);
		// The owner's own client stays.
		expect(ui.provider.isSynced).toBe(true);
		expect(ui.failed).toEqual([]);
	});
});

describe("the relay across a bun --hot reload", () => {
	test("the next daemon keeps it with its connections, and it answers with that daemon's closures", async () => {
		// The first daemon made the relay of `beforeEach`.
		const kept: KeptSync = { nightshiftSync: sync };
		const client = connect();
		await waitFor(() => client.provider.isSynced);

		// The next daemon: its own documents, kept documents and access check.
		const fresh = new Y.Doc();
		fresh.getMap("facts").set("from", "the next daemon");
		const keptState = new Y.Doc();
		keptState.getMap("facts").set("platform", "linux");
		const asked: string[] = [];
		const next = await keepSync(hotSlots(kept), {
			document: (name) =>
				name === document.name ? document.doc : name === "fresh" ? fresh : null,
			kept: {
				has: (name) => name === "device:kept-by-next",
				fetch: async () => Y.encodeStateAsUpdate(keptState),
				store: async () => {},
			},
			authorize: async ({ documentName }) => {
				asked.push(documentName);
				return "write" as const;
			},
		});
		expect(next).toBe(sync);
		expect(kept.nightshiftSync).toBe(sync);

		// The client from before the reload stays, and still syncs.
		const tools = createCliToolStore({ document });
		await tools.save({ name: "gh", description: "GitHub" });
		await waitFor(() => client.doc.getMap("cliTools").has("gh"));
		expect(client.failed).toEqual([]);

		// A client after it: the next daemon's documents and check answer.
		const later = connect("fresh");
		const keptHere = connect("device:kept-by-next");
		await waitFor(() => later.provider.isSynced && keptHere.provider.isSynced);
		expect(later.doc.getMap("facts").get("from")).toBe("the next daemon");
		expect(keptHere.doc.getMap("facts").get("platform")).toBe("linux");
		expect(asked.sort()).toEqual(["device:kept-by-next", "fresh"]);
	});

	test("a relay of an older version, which cannot be bound again, is kept as it is", async () => {
		const { rebind: _, ...older } = sync;
		const kept = { nightshiftSync: older } as KeptSync;
		const next = await keepSync(hotSlots(kept), {
			document: () => null,
			authorize: async () => false as const,
		});
		expect(next).toBe(older as Sync);
	});
});

describe("documentAccess: a flow document", () => {
	const PROJECT = "project-shop";
	const name = `flows:${PROJECT}`;
	const historyName = `flows-history:${PROJECT}`;
	const of = PROJECT;

	/** A flow with two Agent nodes, `a` and `b`. */
	const twoNodes = (prompts: { a?: string; b?: string } = {}): Flow => {
		const quick = flowSchema.parse(
			singleAgentFlow({
				prompt: "First",
				model: "sonnet",
				permissionMode: "acceptEdits",
			}),
		);
		const [agent] = quick.nodes;
		if (agent?.type !== "agent") throw new Error("Expected an Agent node.");
		return {
			...quick,
			start: "a",
			nodes: [
				{ ...agent, id: "a", prompt: prompts.a ?? "First" },
				{ ...agent, id: "b", prompt: prompts.b ?? "Second" },
			],
		};
	};

	const promptsOf = (flows: Record<string, Flow | null>) =>
		Object.fromEntries(
			(flows.build?.nodes ?? []).map((node) => [
				node.id,
				node.type === "agent" ? node.prompt : null,
			]),
		);

	/**
	 * Platform with one Project: Ada owns it, Bob is a member, Cy a viewer.
	 * Bob and Cy each have a Device with a key of this Host.
	 */
	async function platform() {
		const ada = await people.signUp("Ada");
		const bob = await people.signUp("Bob");
		const cy = await people.signUp("Cy");
		const space = await people.auth.api.createOrganization({
			headers: ada.headers,
			body: { name: "Platform", slug: "platform" },
		});
		if (!space) throw new Error("no space");
		for (const [person, role] of [
			[bob, "member"],
			[cy, "viewer"],
		] as const) {
			await people.auth.api.addMember({
				body: { userId: person.userId, role, organizationId: space.id },
			});
		}
		await people.db.insert(project).values({
			id: PROJECT,
			spaceId: space.id,
			name: "Shop",
			createdAt: new Date(),
		});
		deviceKeys.set("nsd_bob", {
			deviceId: "device-bob",
			personId: bob.userId,
			home: false,
		});
		deviceKeys.set("nsd_cy", {
			deviceId: "device-cy",
			personId: cy.userId,
			home: false,
		});
		const cookie = (headers: Headers) => headers.get("cookie") ?? "";
		return { bob: cookie(bob.headers), cy: cookie(cy.headers) };
	}

	/** The flows on this Host, as its engine saves them. */
	const onHost = () =>
		createProjectFlows({
			documents: flows,
			project: async () => ({ spaceId: sandbox.spaceId }),
			deviceId: "host",
		});

	/** A Device's own copy of the Project's flows, on its own Replica. */
	async function deviceCopy() {
		await sandbox.db.insert(project).values({
			id: PROJECT,
			spaceId: sandbox.spaceId,
			name: "Shop",
			createdAt: new Date(),
		});
		const documents = createFlowDocuments({ db: sandbox.db });
		const opened = await documents.open(PROJECT);
		return {
			documents,
			opened,
			flows: createProjectFlows({
				documents,
				project: async () => ({ spaceId: sandbox.spaceId }),
				deviceId: "device-bob",
			}),
			/** Its Link to this Host: both documents. */
			link(token: string) {
				return [
					connect(name, { token, doc: opened.current.doc }),
					connect(historyName, { token, doc: opened.history.doc }),
				];
			},
		};
	}

	test("a member and a viewer read it in a browser; neither writes through the relay", async () => {
		const { bob, cy } = await platform();
		const member = connect(name, { origin: ORIGIN, cookie: bob });
		const viewer = connect(name, { origin: ORIGIN, cookie: cy });
		await waitFor(() => member.provider.isSynced && viewer.provider.isSynced);

		member.doc.getMap("meta").set("from", "Bob");
		viewer.doc.getMap("meta").set("from", "Cy");
		await onHost().save(of, "build", twoNodes());
		await waitFor(
			() =>
				member.doc.getMap("flows").size === 1 &&
				viewer.doc.getMap("flows").size === 1,
		);
		expect(
			(await flows.open(PROJECT)).current.doc.getMap("meta").has("from"),
		).toBe(false);
	});

	test("a Device of a member saves into it; a Device of a viewer only reads", async () => {
		await platform();
		const device = await deviceCopy();
		try {
			const [current, history] = device.link("nsd_bob");
			await waitFor(
				() => !!current?.provider.isSynced && !!history?.provider.isSynced,
			);
			await device.flows.save(of, "build", twoNodes({ a: "From Bob" }), {
				personId: "bob",
			});
			await waitFor(
				async () =>
					promptsOf(parsedFlows(await onHost().flows(of))).a === "From Bob",
			);

			const viewer = connect(name, { token: "nsd_cy" });
			await waitFor(() => viewer.provider.isSynced);
			viewer.doc.getMap("meta").set("from", "Cy");
			await Bun.sleep(100);
			expect(
				(await flows.open(PROJECT)).current.doc.getMap("meta").has("from"),
			).toBe(false);
		} finally {
			await device.documents.flush();
		}
	});

	test("a Person outside the Space, and a Project this Host does not have, are refused", async () => {
		await platform();
		const dee = (await people.signUp("Dee2")).userId;
		deviceKeys.set("nsd_dee", {
			deviceId: "device-dee",
			personId: dee,
			home: true,
		});
		const outsider = connect(name, { token: "nsd_dee" });
		const unknown = connect("flows:no-such-project", { token: "nsd_bob" });
		await waitFor(
			() => outsider.failed.length > 0 && unknown.failed.length > 0,
		);
		expect(outsider.provider.isSynced).toBe(false);
		expect(unknown.provider.isSynced).toBe(false);
	});

	test("edits on a Device without its Link and on the Host merge when the Link is back", async () => {
		await platform();
		const host = onHost();
		await host.save(of, "build", twoNodes());
		const device = await deviceCopy();
		try {
			const first = device.link("nsd_bob");
			await waitFor(async () => {
				const sources = await device.flows.flows(of);
				return "build" in sources;
			});
			for (const client of first) client.provider.destroy();

			await host.save(of, "build", twoNodes({ a: "On the Host" }));
			await device.flows.save(of, "build", twoNodes({ b: "On the Device" }), {
				personId: "bob",
			});

			device.link("nsd_bob");
			const merged = { a: "On the Host", b: "On the Device" };
			await waitFor(
				async () =>
					JSON.stringify(promptsOf(parsedFlows(await host.flows(of)))) ===
						JSON.stringify(merged) &&
					JSON.stringify(
						promptsOf(parsedFlows(await device.flows.flows(of))),
					) === JSON.stringify(merged),
				{ label: "both edits on both sides" },
			);
		} finally {
			await device.documents.flush();
		}
	});
});

describe("documentAccess: a knowledge document", () => {
	const PROJECT = "project-wiki";
	const name = `knowledge:${PROJECT}`;
	const entry = {
		sha256: "a".repeat(64),
		size: 7,
		changedAt: 1,
		deviceId: "device-bob",
	};

	/**
	 * Platform with one Project: Ada owns it, Bob is a member, Cy a viewer.
	 * Bob and Cy each have a Device with a key of this Host.
	 */
	async function platform() {
		const ada = await people.signUp("Ada");
		const bob = await people.signUp("Bob");
		const cy = await people.signUp("Cy");
		const space = await people.auth.api.createOrganization({
			headers: ada.headers,
			body: { name: "Platform", slug: "platform" },
		});
		if (!space) throw new Error("no space");
		for (const [person, role] of [
			[bob, "member"],
			[cy, "viewer"],
		] as const) {
			await people.auth.api.addMember({
				body: { userId: person.userId, role, organizationId: space.id },
			});
		}
		await people.db.insert(project).values({
			id: PROJECT,
			spaceId: space.id,
			name: "Wiki",
			createdAt: new Date(),
		});
		for (const [token, person] of [
			["nsd_bob", bob],
			["nsd_cy", cy],
		] as const) {
			deviceKeys.set(token, {
				deviceId: `device-${person.userId}`,
				personId: person.userId,
				home: false,
			});
		}
		return { bob: bob.headers.get("cookie") ?? "" };
	}

	const onHost = async () =>
		(await knowledge.open(PROJECT)).doc.getMap("files");

	test("a Member reads it in a browser, and does not change it through the relay", async () => {
		const { bob } = await platform();
		const member = connect(name, { origin: ORIGIN, cookie: bob });
		await waitFor(() => member.provider.isSynced);
		member.doc.getMap("files").set("wiki/Home.md", entry);
		await Bun.sleep(100);
		expect((await onHost()).size).toBe(0);
	});

	test("a Device of a Member who may start runs publishes into it; a viewer's Device only reads", async () => {
		await platform();
		const device = connect(name, { token: "nsd_bob" });
		await waitFor(() => device.provider.isSynced);
		device.doc.getMap("files").set("wiki/Home.md", entry);
		await waitFor(async () => (await onHost()).has("wiki/Home.md"));

		const viewer = connect(name, { token: "nsd_cy" });
		await waitFor(
			() =>
				viewer.provider.isSynced &&
				viewer.doc.getMap("files").has("wiki/Home.md"),
		);
		viewer.doc.getMap("files").set("wiki/Other.md", entry);
		await Bun.sleep(100);
		expect((await onHost()).has("wiki/Other.md")).toBe(false);
	});

	test("a Person outside the Space, and a Project this Host does not have, are refused", async () => {
		await platform();
		const dee = (await people.signUp("Dee2")).userId;
		deviceKeys.set("nsd_dee", {
			deviceId: "device-dee",
			personId: dee,
			home: true,
		});
		const outsider = connect(name, { token: "nsd_dee" });
		const unknown = connect("knowledge:no-such-project", { token: "nsd_bob" });
		await waitFor(
			() => outsider.failed.length > 0 && unknown.failed.length > 0,
		);
		expect(outsider.provider.isSynced).toBe(false);
	});
});
