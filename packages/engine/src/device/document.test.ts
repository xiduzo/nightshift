import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	agentProfile,
	cliTool,
	clone,
	connection,
	project,
	secret,
	setting,
	ydoc,
} from "@nightshift/db/schema/nightshift";
import * as Y from "yjs";

import { createCliToolStore } from "../cli-tools";
import { createConnectionStore, type SecretBackend } from "../connections";
import { createProfileStore } from "../profiles";
import { createSettingsStore } from "../settings";
import { createSandbox, type Sandbox } from "../test-support";
import {
	type DeviceDocument,
	deviceDocumentName,
	deviceFacts,
	refreshDeviceFacts,
	setDeviceFacts,
} from "./document";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const noSecrets: SecretBackend = {
	get: async () => null,
	set: async () => {},
	delete: async () => {},
};

/** The four stores a daemon builds over one document. */
function stores(document: DeviceDocument) {
	return {
		profiles: createProfileStore({ document }),
		cliTools: createCliToolStore({ document }),
		connections: createConnectionStore({
			document,
			env: {},
			secrets: noSecrets,
		}),
		settings: createSettingsStore({ document, env: {} }),
	};
}

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `\${${name}}`;

/** The rows a Replica from before the Device document has. */
async function seedOlderRows() {
	await sandbox.db.insert(setting).values([
		{ key: "maxConcurrentRuns", value: "4" },
		{ key: "claudeBin", value: JSON.stringify("/opt/claude") },
	]);
	await sandbox.db.insert(connection).values({
		name: "tracker",
		description: "Issues",
		server: JSON.stringify({
			command: "tracker-mcp",
			env: { TOKEN: ref("TRACKER_TOKEN") },
		}),
	});
	await sandbox.db
		.insert(cliTool)
		.values({ name: "gh", description: "GitHub" });
	await sandbox.db.insert(agentProfile).values({
		name: "builder",
		description: "Builds.",
		settings: JSON.stringify({
			harness: "claude-code",
			model: "opus",
			permissionMode: "auto",
			clis: ["gh"],
			connections: ["tracker"],
		}),
	});
	await sandbox.db.insert(secret).values({ name: "TRACKER_TOKEN" });
}

describe("the Device document", () => {
	test("is named after its Device and saved in the Replica", async () => {
		const document = await sandbox.openDocument();
		expect(document.name).toBe(deviceDocumentName(sandbox.deviceId));
		expect(document.name).toBe(`device:${sandbox.deviceId}`);
		const rows = await sandbox.db.select().from(ydoc);
		expect(rows.map((r) => r.name)).toEqual([document.name]);
	});

	test("imports the rows of the tables it replaces on its first start", async () => {
		await seedOlderRows();
		const s = stores(await sandbox.openDocument());

		expect(s.settings.current().maxConcurrentRuns).toBe(4);
		expect(s.settings.current().claudeBin).toBe("/opt/claude");
		expect(s.connections.get("tracker")).toMatchObject({
			description: "Issues",
			variables: [{ name: "TRACKER_TOKEN", source: "keychain" }],
		});
		expect(s.cliTools.get("gh")?.description).toBe("GitHub");
		expect(s.profiles.settingsFor("builder")).toMatchObject({
			model: "opus",
			clis: ["gh"],
			connections: ["tracker"],
		});
		expect(s.profiles.get("builder")?.description).toBe("Builds.");
	});

	test("imports once: a later start keeps what changed since", async () => {
		await seedOlderRows();
		const first = stores(await sandbox.openDocument());
		await first.profiles.remove("builder");
		await first.cliTools.save({ name: "jq" });
		await first.settings.save({ maxConcurrentRuns: null });

		// The old rows are still there, and are not read again.
		const again = stores(await sandbox.openDocument());
		expect(again.profiles.list()).toEqual([]);
		expect([...again.cliTools.names()].sort()).toEqual(["gh", "jq"]);
		expect(again.settings.current().maxConcurrentRuns).toBe(2);
	});

	test("every store's change lasts across a restart", async () => {
		const first = stores(await sandbox.openDocument());
		await first.settings.save({ agentModel: "opus" });
		await first.cliTools.save({ name: "gh" });
		await first.connections.save({
			name: "docs",
			server: { url: "https://docs.example.com/mcp" },
		});
		await first.profiles.save({
			name: "reviewer",
			harness: "codex",
			model: "gpt-5",
			permissionMode: "default",
			clis: ["gh"],
			connections: ["docs"],
		});

		const again = stores(await sandbox.openDocument());
		expect(again.settings.current().agentModel).toBe("opus");
		expect([...again.cliTools.names()]).toEqual(["gh"]);
		expect([...again.connections.names()]).toEqual(["docs"]);
		expect(again.profiles.settingsFor("reviewer")).toMatchObject({
			harness: "codex",
			connections: ["docs"],
		});
	});

	test("an edit from another client applies to the stores at once, and lasts", async () => {
		const document = await sandbox.openDocument();
		const s = stores(document);
		const { client, flush } = connectClient(document);

		client.transact(() => {
			client.getMap("cliTools").set("gh", {
				description: "From the laptop",
				updatedAt: 1,
			});
			client.getMap("settings").set("maxConcurrentRuns", 3);
		});
		expect(s.cliTools.get("gh")?.description).toBe("From the laptop");
		expect(s.settings.current().maxConcurrentRuns).toBe(3);

		await flush();
		const again = stores(await sandbox.openDocument());
		expect(again.cliTools.get("gh")?.description).toBe("From the laptop");
	});

	test("two clients that edit at once converge", async () => {
		const document = await sandbox.openDocument();
		const s = stores(document);
		const a = connectClient(document);
		const b = connectClient(document);

		// Both edit the same setting and different tools before either hears the other.
		a.pause();
		b.pause();
		a.client.getMap("settings").set("agentModel", "opus");
		b.client.getMap("settings").set("agentModel", "haiku");
		a.client.getMap("cliTools").set("aws", { description: null, updatedAt: 1 });
		b.client.getMap("cliTools").set("jq", { description: null, updatedAt: 2 });
		a.resume();
		b.resume();

		const model = s.settings.current().agentModel;
		expect(["opus", "haiku"]).toContain(model);
		for (const peer of [a.client, b.client]) {
			expect(peer.getMap("settings").get("agentModel")).toBe(model);
			expect([...peer.getMap("cliTools").keys()].sort()).toEqual(["aws", "jq"]);
		}
		expect([...s.cliTools.names()].sort()).toEqual(["aws", "jq"]);
	});

	test("stores built again (a hot reload) register nothing on the document", async () => {
		const document = await sandbox.openDocument();
		const handlers = () =>
			[
				document.profiles,
				document.cliTools,
				document.connections,
				document.settings,
				document.facts,
			].reduce(
				(n, map) =>
					n +
					(map as unknown as { _eH: { l: unknown[] }; _dEH: { l: unknown[] } })
						._eH.l.length +
					(map as unknown as { _dEH: { l: unknown[] } })._dEH.l.length,
				0,
			);
		for (let i = 0; i < 20; i++) stores(document);
		expect(handlers()).toBe(0);

		// A view made earlier still sees a change made through a later one.
		const first = stores(document);
		expect(first.cliTools.list()).toEqual([]);
		await stores(document).cliTools.save({ name: "gh" });
		expect([...first.cliTools.names()]).toEqual(["gh"]);
	});

	test("an entry a store cannot read is skipped, and stays in the document", async () => {
		const document = await sandbox.openDocument();
		const s = stores(document);
		await document.change(() => {
			document.profiles.set("broken", { description: null, settings: 7 });
			document.connections.set("odd", {
				description: null,
				server: { neither: true },
				updatedAt: 1,
			});
		});
		expect(s.profiles.list()).toEqual([]);
		expect(s.connections.list()).toEqual([]);
		const again = await sandbox.openDocument();
		expect([...again.profiles.keys()]).toEqual(["broken"]);
	});
});

describe("facts", () => {
	test("the Owner writes what changed; secret names are facts", async () => {
		const document = await sandbox.openDocument();
		await setDeviceFacts(document, {
			platform: "darwin",
			programs: ["gh", "git"],
			harnesses: { "claude-code": "/usr/local/bin/claude" },
			clones: [{ projectId: "p1", path: "/code/app" }],
			checkedAt: 10,
		});
		await setDeviceFacts(document, { programs: ["gh", "git"], checkedAt: 20 });
		expect(deviceFacts(document)).toMatchObject({
			platform: "darwin",
			programs: ["gh", "git"],
			checkedAt: 10,
		});

		const { connections } = stores(document);
		await connections.setSecret("TRACKER_TOKEN", "value");
		const again = await sandbox.openDocument();
		expect(deviceFacts(again)).toMatchObject({
			secrets: ["TRACKER_TOKEN"],
			clones: [{ projectId: "p1", path: "/code/app" }],
		});
	});

	test("a refresh reports this computer: platform, harnesses, programs, Clones", async () => {
		await sandbox.db
			.insert(project)
			.values({ id: "p1", name: "app", spaceId: sandbox.spaceId });
		await sandbox.db.insert(clone).values({
			id: "c1",
			projectId: "p1",
			deviceId: sandbox.deviceId,
			path: "/code/app",
			spaceId: sandbox.spaceId,
		});
		const document = await sandbox.openDocument();
		await refreshDeviceFacts({
			db: sandbox.db,
			document,
			deviceId: sandbox.deviceId,
			harnesses: () => ({ "claude-code": "/bin/claude", codex: null }),
			programs: async () => ["gh", "git"],
		});
		expect(deviceFacts(document)).toMatchObject({
			platform: process.platform,
			harnesses: { "claude-code": "/bin/claude", codex: null },
			programs: ["gh", "git"],
			clones: [{ projectId: "p1", path: "/code/app" }],
		});
	});

	test("there is a place for offers, empty until a Device makes one", async () => {
		const document = await sandbox.openDocument();
		expect(document.offers.size).toBe(0);
	});
});

/**
 * Another Yjs client of the document (a UI, or the same owner's laptop),
 * wired the way the relay wires them: every update both ways. `pause`
 * holds this client's updates back, to make concurrent edits.
 */
function connectClient(document: DeviceDocument) {
	const client = new Y.Doc();
	const relay = Symbol("relay");
	Y.applyUpdate(client, Y.encodeStateAsUpdate(document.doc), relay);
	let held: Uint8Array[] | null = null;
	client.on("update", (update: Uint8Array, origin: unknown) => {
		if (origin === relay) return;
		if (held) held.push(update);
		else Y.applyUpdate(document.doc, update, relay);
	});
	document.doc.on("update", (update: Uint8Array, origin: unknown) => {
		if (origin !== relay) Y.applyUpdate(client, update, relay);
	});
	return {
		client,
		flush: () => document.flush(),
		pause() {
			held = [];
		},
		resume() {
			const updates = held ?? [];
			held = null;
			for (const update of updates) Y.applyUpdate(document.doc, update, relay);
		},
	};
}
