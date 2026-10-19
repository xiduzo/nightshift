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
import { project } from "@nightshift/db/schema/nightshift";
import {
	createCliToolStore,
	createSettingsStore,
	createSpaceDocuments,
	type DeviceDocument,
	type SpaceDocuments,
	spaceDocumentName,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/test-support";
import type { Server } from "bun";
import * as Y from "yjs";

import { createSync, documentAccess, type SocketData, type Sync } from "./sync";

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

beforeEach(async () => {
	sandbox = await createSandbox();
	document = await sandbox.openDocument();
	people = await createAuthSandbox();
	const owner = await localPerson(people.db);
	stranger = (await people.signUp("Dee")).headers;
	spaces = createSpaceDocuments({ db: people.db });
	sync = createSync({
		document: (name) =>
			name === document.name
				? document.doc
				: (spaces.byName(name)?.doc ?? null),
		authorize: documentAccess({
			auth: people.auth,
			db: people.db,
			localSession: createLocalSession(people.auth, people.db, owner.userId),
			ownerId: owner.userId,
			trustedOrigins: new Set([ORIGIN]),
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
	options: { origin?: string; cookie?: string } = {},
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
			name: spaceDocumentName(space.id),
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

	test("a member opens it and edits; the project rows follow", async () => {
		const { opened, name, bob } = await platform();
		expect(opened.members.size).toBe(3);
		const client = connect(name, { origin: ORIGIN, cookie: bob });
		await waitFor(() => client.provider.isSynced);
		expect(client.doc.getMap("members").size).toBe(3);

		client.doc.getMap("projects").set("p-bob", entry("From Bob"));
		await waitFor(async () => {
			const rows = await people.db.select().from(project);
			return rows.some((row) => row.name === "From Bob");
		});
	});

	test("a viewer reads it, and their edits go nowhere", async () => {
		const { opened, name, bob, cy } = await platform();
		const viewer = connect(name, { origin: ORIGIN, cookie: cy });
		const member = connect(name, { origin: ORIGIN, cookie: bob });
		await waitFor(() => viewer.provider.isSynced && member.provider.isSynced);

		viewer.doc.getMap("projects").set("p-cy", entry("From Cy"));
		await Bun.sleep(100);
		member.doc.getMap("projects").set("p-bob", entry("From Bob"));
		await waitFor(() => opened.projects.has("p-bob"));
		// The viewer still sees what others write.
		await waitFor(() => viewer.doc.getMap("projects").has("p-bob"));
		expect(opened.projects.has("p-cy")).toBe(false);
		expect(member.doc.getMap("projects").has("p-cy")).toBe(false);
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

	test("this computer's Person is not a member of another Person's Space", async () => {
		const { name } = await platform();
		const local = connect(name, { origin: ORIGIN });
		await waitFor(() => local.failed.length > 0);
		expect(local.provider.isSynced).toBe(false);
	});
});
