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
import {
	createCliToolStore,
	createSettingsStore,
	createSpaceDocuments,
	type DeviceDocument,
	type SpaceDocuments,
	spaceDocumentName,
	spaceIdOf,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Server } from "bun";
import * as Y from "yjs";

import { isThisComputer } from "../http";
import { createSync, type SocketData, type Sync } from "./sync";

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
let spaces: SpaceDocuments;
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
	document = await sandbox.openDocument();
	people = await createAuthSandbox();
	const owner = await localPerson(people.db);
	ownerId = owner.userId;
	stranger = (await people.signUp("Dee")).headers;
	deviceKeys = new Map();
	keptOwners = new Map();
	keptRows = new Map();
	spaces = createSpaceDocuments({ db: people.db });
	sync = createSync({
		document: (name) =>
			name === document.name
				? document.doc
				: (spaces.byName(name)?.doc ?? null),
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
			spaceIdOf,
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
	await document.close();
	await spaces.close();
	await sandbox.cleanup();
	people.cleanup();
});

/** A client of the relay, as a UI or another Device opens one. */
function connect(
	name = document.name,
	options: { origin?: string; cookie?: string; token?: string } = {},
) {
	const doc = new Y.Doc();
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
			document: await sandbox.openDocument(),
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
			spaceIdOf,
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

	test("a Device key opens no other Device's document, not even the Host's own", async () => {
		pairB();
		const client = connect(document.name, { token: KEY });
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
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
