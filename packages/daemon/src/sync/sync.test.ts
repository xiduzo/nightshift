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
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import { project } from "@nightshift/db/schema";
import { deviceDirectory } from "@nightshift/devices";
import {
	createFlowDocuments,
	createSyncedDocuments,
	type FlowDocuments,
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

/**
 * Platform: Ada owns it, Bob is a member, Cy a viewer. With `projectId`,
 * it has that Project, and Bob and Cy each have a Device with a key of
 * this Host. Who may open what is `documentAccess`'s, tested in
 * `@nightshift/auth`: these tests check that the relay honours it.
 */
async function platform(projectId?: string) {
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
	if (projectId) {
		await people.db.insert(project).values({
			id: projectId,
			spaceId: space.id,
			name: "Shop",
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
	}
	const opened = await spaces.open(space.id);
	const cookie = (headers: Headers) => headers.get("cookie") ?? "";
	return {
		opened,
		name: spaceDocumentName(space.id),
		bob: cookie(bob.headers),
		cy: cookie(cy.headers),
	};
}

describe("a read-only connection", () => {
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

	/** C is another home Device of the owner. */
	const C = "device:device-c";

	test("a home Device reads another Device of its owner, and writes nothing to it", async () => {
		pairB();
		keptOwners.set(C, ownerId);
		const writer = connect(C, { origin: ORIGIN });
		await waitFor(() => writer.provider.isSynced);
		writer.doc.getMap("facts").set("secrets", [{ name: "GH_TOKEN", setAt: 1 }]);
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

describe("a flow document a Device keeps a copy of", () => {
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

	test("a Device of a member saves into it; a Device of a viewer only reads", async () => {
		await platform(PROJECT);
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

	test("edits on a Device without its Link and on the Host merge when the Link is back", async () => {
		await platform(PROJECT);
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
