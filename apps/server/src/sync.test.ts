import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { createLocalSession } from "@nightshift/auth/local-session";
import { localPerson } from "@nightshift/auth/spaces";
import {
	type AuthSandbox,
	createAuthSandbox,
} from "@nightshift/auth/test-support";
import {
	createCliToolStore,
	createSettingsStore,
	type DeviceDocument,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/test-support";
import type { Server } from "bun";
import * as Y from "yjs";

import {
	createSync,
	ownerOnly,
	type SocketData,
	type Sync,
	type SyncDeviceKey,
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
	sync = createSync({
		document: (name) => (name === document.name ? document.doc : null),
		kept: {
			has: (name) => keptOwners.has(name),
			fetch: async (name) => keptRows.get(name) ?? null,
			store: async (name, state) => {
				keptRows.set(name, state);
			},
		},
		authorize: ownerOnly({
			auth: people.auth,
			db: people.db,
			localSession: createLocalSession(people.auth, people.db, owner.userId),
			ownerId: owner.userId,
			trustedOrigins: new Set([ORIGIN]),
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

describe("ownerOnly", () => {
	test("another Person is refused, even on this computer", async () => {
		const client = connect(document.name, {
			origin: ORIGIN,
			cookie: stranger.get("cookie") ?? "",
		});
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});
});

describe("Device keys on the relay", () => {
	const KEY = "nsd_the-key-of-device-b";

	test("another Device of the owner opens the document on its home Host", async () => {
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: ownerId,
			home: true,
		});
		const client = connect(document.name, { token: KEY });
		await waitFor(() => client.provider.isSynced);
	});

	test("a guest Host never opens a Device document to a key", async () => {
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: ownerId,
			home: false,
		});
		const client = connect(document.name, { token: KEY });
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});

	test("a key of another Person is refused", async () => {
		deviceKeys.set(KEY, {
			deviceId: "device-c",
			personId: "someone",
			home: true,
		});
		const client = connect(document.name, { token: KEY });
		await waitFor(() => client.failed.length > 0);
	});

	test("an unknown key from this computer does not get the local session", async () => {
		const client = connect(document.name, { token: "nsd_unknown" });
		await waitFor(() => client.failed.length > 0);
		expect(client.provider.isSynced).toBe(false);
	});

	test("a Host keeps a paired Device's document, for that Device and its owner", async () => {
		keptOwners.set("device:device-b", ownerId);
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: ownerId,
			home: true,
		});
		const device = connect("device:device-b", { token: KEY });
		await waitFor(() => device.provider.isSynced);
		device.doc.getMap("facts").set("platform", "darwin");

		// The owner's UI on the Host sees it, and the Host stores it.
		const ui = connect("device:device-b", { origin: ORIGIN });
		await waitFor(() => ui.doc.getMap("facts").get("platform") === "darwin");
		await waitFor(() => keptRows.has("device:device-b"), { timeoutMs: 15_000 });

		// Not for another Person.
		const page = connect("device:device-b", {
			origin: ORIGIN,
			cookie: stranger.get("cookie") ?? "",
		});
		await waitFor(() => page.failed.length > 0);
	}, 20_000);

	test("removing a Device's access ends its connections", async () => {
		deviceKeys.set(KEY, {
			deviceId: "device-b",
			personId: ownerId,
			home: true,
		});
		const device = connect(document.name, { token: KEY });
		const ui = connect(document.name);
		await waitFor(() => device.provider.isSynced && ui.provider.isSynced);

		deviceKeys.delete(KEY);
		sync.disconnect((context) => context.deviceId === "device-b");
		await waitFor(() => device.failed.length > 0);
		// The owner's own client stays.
		expect(ui.provider.isSynced).toBe(true);
		expect(ui.failed).toEqual([]);
	});
});
