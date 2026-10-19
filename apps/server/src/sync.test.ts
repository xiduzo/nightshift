import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
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
	type SocketData,
	type Sync,
	thisComputerOnly,
} from "./sync";

/**
 * Hocuspocus 4 under Bun 1.3, in-process: Bun.serve accepts the socket and
 * hands it to Hocuspocus's `handleConnection`; a `HocuspocusProvider`
 * syncs the Device document through it.
 */

let sandbox: Sandbox;
let document: DeviceDocument;
let sync: Sync;
let server: Server<SocketData>;
const providers: HocuspocusProvider[] = [];

const ORIGIN = "http://localhost:3001";

beforeEach(async () => {
	sandbox = await createSandbox();
	document = await sandbox.openDocument();
	sync = createSync({
		document: (name) => (name === document.name ? document.doc : null),
		authorize: thisComputerOnly([ORIGIN]),
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
});

/** A client of the relay, as a UI or another Device opens one. */
function connect(name = document.name, origin?: string) {
	const doc = new Y.Doc();
	const failed: string[] = [];
	// A browser sends its page's origin; Bun's WebSocket takes headers.
	class FromOrigin extends WebSocket {
		constructor(url: string) {
			super(url, { headers: origin ? { origin } : {} } as never);
		}
	}
	const provider = new HocuspocusProvider({
		websocketProvider: new HocuspocusProviderWebsocket({
			url: `ws://127.0.0.1:${server.port}/sync`,
			WebSocketPolyfill: FromOrigin,
		}),
		name,
		document: doc,
		token: "this-computer",
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
		const ui = connect(document.name, ORIGIN);
		const page = connect(document.name, "https://evil.example");
		await waitFor(() => ui.provider.isSynced && page.failed.length > 0);
		expect(page.provider.isSynced).toBe(false);
		expect(page.doc.getMap("meta").size).toBe(0);
	});
});

describe("thisComputerOnly", () => {
	const allow = thisComputerOnly([ORIGIN]);
	const ask = (peer: string | null, origin?: string) =>
		allow({
			documentName: "device:x",
			token: "",
			peer,
			request: new Request("http://localhost/sync", {
				headers: origin ? { origin } : {},
			}),
		});

	test("lets in this computer, from the UI or a program", () => {
		expect(ask("127.0.0.1", ORIGIN)).toBe(true);
		expect(ask("::1")).toBe(true);
		expect(ask("::ffff:127.0.0.1")).toBe(true);
	});

	test("refuses another computer, and a web page of another origin", () => {
		expect(ask("192.168.1.20", ORIGIN)).toBe(false);
		expect(ask(null)).toBe(false);
		expect(ask("127.0.0.1", "https://evil.example")).toBe(false);
	});
});
