import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connection } from "@nightshift/db/schema/nightshift";

import {
	type ConnectionInput,
	createConnectionStore,
	referencedVariables,
	type SecretBackend,
} from "./connections";
import { createSandbox, type Sandbox } from "./test-support";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `\${${name}}`;

/** A keychain in memory. Tests never touch the real one. */
function memorySecrets(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const reads: string[] = [];
	const backend: SecretBackend = {
		async get(name) {
			reads.push(name);
			return values.get(name) ?? null;
		},
		async set(name, value) {
			values.set(name, value);
		},
		async delete(name) {
			values.delete(name);
		},
	};
	return { backend, values, reads };
}

/** A store over the Device document as a daemon start opens it. */
async function makeStore(
	env: Record<string, string | undefined> = {},
	secrets = memorySecrets(),
) {
	const store = createConnectionStore({
		document: await sandbox.openDocument(),
		env,
		secrets: secrets.backend,
	});
	await store.load();
	return { store, secrets };
}

/** What the next start reads: the connection names and the facts' secret names. */
async function savedNow() {
	const document = await sandbox.openDocument();
	return {
		connections: [...document.connections.keys()].sort(),
		secrets: (document.facts.get("secrets") as string[] | undefined) ?? [],
	};
}

const tracker: ConnectionInput = {
	name: "tracker",
	description: "The issue tracker",
	server: {
		command: "tracker-mcp",
		args: ["--stdio"],
		env: { TOKEN: ref("TRACKER_TOKEN"), MODE: "night" },
	},
};

const docs: ConnectionInput = {
	name: "docs",
	server: {
		url: "https://docs.example.com/mcp",
		headers: {
			Authorization: `Bearer ${ref("DOCS_TOKEN")}`,
			"X-Team": `${ref("TEAM")}-${ref("DOCS_TOKEN")}`,
		},
	},
};

describe("referencedVariables", () => {
	test("reads env values of a command server, once each", () => {
		expect(
			referencedVariables({
				command: "x",
				// Arguments are not expanded, so they are not references.
				args: [ref("IN_ARGS")],
				env: { A: `${ref("ONE")}:${ref("TWO")}`, B: ref("ONE"), C: "$PLAIN" },
			}),
		).toEqual(["ONE", "TWO"]);
	});

	test("reads headers of a URL server", () => {
		expect(
			referencedVariables({
				url: `https://x.test/mcp?k=${ref("IN_URL")}`,
				headers: { H: ref("HEADER_TOKEN") },
			}),
		).toEqual(["HEADER_TOKEN"]);
	});

	test("none without env or headers", () => {
		expect(referencedVariables({ command: "x", args: [], env: {} })).toEqual(
			[],
		);
	});
});

describe("connections", () => {
	test("save, get, list and remove", async () => {
		const { store } = await makeStore();
		expect(store.list()).toEqual([]);
		expect(store.get("tracker")).toBeNull();

		const saved = await store.save(tracker);
		expect(saved).toMatchObject({
			name: "tracker",
			description: "The issue tracker",
			server: tracker.server,
			variables: [{ name: "TRACKER_TOKEN", source: "missing" }],
		});
		expect(saved.updatedAt).toBeGreaterThan(0);
		await store.save(docs);

		// Sorted by name; a URL server gets its defaults filled in.
		expect(store.list().map((c) => c.name)).toEqual(["docs", "tracker"]);
		expect(store.get("docs")).toMatchObject({
			description: null,
			server: docs.server,
		});
		expect(store.names()).toEqual(new Set(["docs", "tracker"]));

		await store.remove("tracker");
		expect(store.get("tracker")).toBeNull();
		expect(store.list().map((c) => c.name)).toEqual(["docs"]);
		expect((await savedNow()).connections).toEqual(["docs"]);
	});

	test("saving a name again replaces the connection", async () => {
		const { store } = await makeStore();
		await store.save(tracker);
		const replaced = await store.save({
			name: "tracker",
			description: "   ",
			server: { url: "https://tracker.example.com/mcp" },
		});
		expect(replaced).toMatchObject({
			description: null,
			server: { url: "https://tracker.example.com/mcp", headers: {} },
			variables: [],
		});
		expect(store.list()).toHaveLength(1);
		expect((await savedNow()).connections).toEqual(["tracker"]);
	});

	test("refuses a bad name or server", async () => {
		const { store } = await makeStore();
		await expect(
			store.save({ ...tracker, name: "Bad Name" }),
		).rejects.toThrow();
		await expect(
			store.save({ name: "nourl", server: { url: "not a url" } }),
		).rejects.toThrow();
		expect(store.list()).toEqual([]);
	});

	test("a restart restores the connections and the saved secret names", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({}, secrets);
		await store.save(tracker);
		await store.save(docs);
		await store.setSecret("TRACKER_TOKEN", "tracker-secret");

		const { store: again } = await makeStore({ TEAM: "night" }, secrets);
		expect(again.list().map((c) => c.name)).toEqual(["docs", "tracker"]);
		expect(again.get("tracker")?.variables).toEqual([
			{ name: "TRACKER_TOKEN", source: "keychain" },
		]);
		expect(again.get("docs")?.variables).toEqual([
			{ name: "DOCS_TOKEN", source: "missing" },
			{ name: "TEAM", source: "env" },
		]);
	});

	test("skips a row of an older version whose server no longer parses", async () => {
		await sandbox.db.insert(connection).values([
			{ name: "broken", server: "{not json" },
			{ name: "wrong", server: JSON.stringify({ neither: true }) },
			{ name: "fine", server: JSON.stringify({ command: "ok" }) },
		]);
		const { store } = await makeStore();
		expect(store.list().map((c) => c.name)).toEqual(["fine"]);
		expect(store.get("fine")?.server).toEqual({
			command: "ok",
			args: [],
			env: {},
		});
	});
});

describe("secrets", () => {
	test("a variable reads the keychain first, then the environment, else it is missing", async () => {
		const { store } = await makeStore({ DOCS_TOKEN: "from-env", TEAM: "" });
		await store.save(docs);
		await store.save(tracker);
		// An empty variable in the environment counts as set.
		expect(store.get("docs")?.variables).toEqual([
			{ name: "DOCS_TOKEN", source: "env" },
			{ name: "TEAM", source: "env" },
		]);
		expect(store.get("tracker")?.variables).toEqual([
			{ name: "TRACKER_TOKEN", source: "missing" },
		]);

		await store.setSecret("DOCS_TOKEN", "from-keychain");
		expect(store.get("docs")?.variables[0]).toEqual({
			name: "DOCS_TOKEN",
			source: "keychain",
		});
	});

	test("the secrets view: referenced or saved names, where each is set, and who uses it", async () => {
		const { store } = await makeStore({ TEAM: "night", UNUSED_ENV: "x" });
		await store.save(docs);
		await store.save(tracker);
		await store.save({
			name: "wiki",
			server: {
				url: "https://wiki.test/mcp",
				headers: { A: ref("DOCS_TOKEN") },
			},
		});
		await store.setSecret("DOCS_TOKEN", "d");
		await store.setSecret("ORPHAN", "o");

		expect(store.secrets()).toEqual([
			{
				name: "DOCS_TOKEN",
				saved: true,
				inEnv: false,
				usedBy: ["docs", "wiki"],
			},
			{ name: "ORPHAN", saved: true, inEnv: false, usedBy: [] },
			{ name: "TEAM", saved: false, inEnv: true, usedBy: ["docs"] },
			{
				name: "TRACKER_TOKEN",
				saved: false,
				inEnv: false,
				usedBy: ["tracker"],
			},
		]);
	});

	test("setSecret stores the value in the backend and only the name in the document", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({}, secrets);
		await store.setSecret("TRACKER_TOKEN", "first-value");
		await store.setSecret("TRACKER_TOKEN", "second-value");
		expect(secrets.values.get("TRACKER_TOKEN")).toBe("second-value");
		expect((await savedNow()).secrets).toEqual(["TRACKER_TOKEN"]);
		const document = await sandbox.openDocument();
		expect(JSON.stringify(document.doc.toJSON())).not.toContain("value");
	});

	test.each([
		"1STARTS_WITH_DIGIT",
		"has-dash",
		"has space",
		"",
		`A${"x".repeat(128)}`,
	])("setSecret refuses the name %p", async (name) => {
		const secrets = memorySecrets();
		const { store } = await makeStore({}, secrets);
		await expect(store.setSecret(name, "v")).rejects.toThrow();
		expect(secrets.values.size).toBe(0);
		expect((await savedNow()).secrets).toEqual([]);
	});

	test("setSecret accepts a name with _ and digits", async () => {
		const { store } = await makeStore();
		await store.setSecret("_my_token_2", "v");
		expect(store.secrets().map((s) => s.name)).toEqual(["_my_token_2"]);
	});

	test("setSecret refuses an empty value", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({}, secrets);
		await expect(store.setSecret("TOKEN", "")).rejects.toThrow(
			"A secret needs a value.",
		);
		expect(secrets.values.size).toBe(0);
		expect(store.secrets()).toEqual([]);
	});

	test("removeSecret deletes the value and the name; the environment takes over", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({ TRACKER_TOKEN: "env" }, secrets);
		await store.save(tracker);
		await store.setSecret("TRACKER_TOKEN", "keychain");
		await store.removeSecret("TRACKER_TOKEN");
		expect(secrets.values.has("TRACKER_TOKEN")).toBe(false);
		expect((await savedNow()).secrets).toEqual([]);
		expect(store.get("tracker")?.variables).toEqual([
			{ name: "TRACKER_TOKEN", source: "env" },
		]);
		expect(store.secrets()).toEqual([
			{ name: "TRACKER_TOKEN", saved: false, inEnv: true, usedBy: ["tracker"] },
		]);
	});
});

describe("mcpServersFor", () => {
	test("the node's connections, then its own servers, expanded", async () => {
		const { store } = await makeStore({
			TRACKER_TOKEN: "env-tracker",
			DOCS_TOKEN: "env-docs",
			TEAM: "night",
		});
		await store.save(tracker);
		await store.save(docs);
		await store.setSecret("DOCS_TOKEN", "keychain-docs");

		const result = await store.mcpServersFor({
			connections: ["tracker", "docs"],
			mcpServers: {
				local: { command: "local-mcp", args: [], env: { T: ref("TEAM") } },
			},
		});
		expect(result).toEqual({
			ok: true,
			servers: {
				tracker: {
					command: "tracker-mcp",
					args: ["--stdio"],
					env: { TOKEN: "env-tracker", MODE: "night" },
				},
				// The keychain beats the environment.
				docs: {
					url: "https://docs.example.com/mcp",
					headers: {
						Authorization: "Bearer keychain-docs",
						"X-Team": "night-keychain-docs",
					},
				},
				local: { command: "local-mcp", args: [], env: { T: "night" } },
			},
		});
	});

	test("a server the node defines itself wins over a connection of the same name", async () => {
		const { store } = await makeStore({ TRACKER_TOKEN: "t" });
		await store.save(tracker);
		const result = await store.mcpServersFor({
			connections: ["tracker"],
			mcpServers: {
				tracker: { url: "https://own.example.com/mcp", headers: {} },
			},
		});
		expect(result).toEqual({
			ok: true,
			servers: {
				tracker: { url: "https://own.example.com/mcp", headers: {} },
			},
		});
	});

	test("an unknown connection refuses and names it", async () => {
		const { store } = await makeStore();
		await store.save(tracker);
		const result = await store.mcpServersFor({
			connections: ["tracker", "ghost"],
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.message).toContain('"ghost"');
		expect(!result.ok && result.message).toContain("There is no connection");
	});

	test("a missing variable refuses with a message that names it, never a value", async () => {
		const { store } = await makeStore({ TEAM: "team-value" });
		await store.save(docs);
		const result = await store.mcpServersFor({ connections: ["docs"] });
		expect(result).toEqual({
			ok: false,
			message: expect.stringContaining(
				'The MCP server "docs" needs the secret DOCS_TOKEN',
			),
		});
		expect(JSON.stringify(result)).not.toContain("team-value");
	});

	test("only the keychain secrets the servers reference are read", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({ TRACKER_TOKEN: "t" }, secrets);
		await store.save(tracker);
		await store.setSecret("OTHER", "o");
		await store.setSecret("TRACKER_TOKEN", "k");
		secrets.reads.length = 0;
		await store.mcpServersFor({ connections: ["tracker"] });
		expect(secrets.reads).toEqual(["TRACKER_TOKEN"]);
	});

	test("no connections and no servers is an empty set", async () => {
		const { store } = await makeStore();
		expect(await store.mcpServersFor({})).toEqual({ ok: true, servers: {} });
	});
});

describe("expandForTest", () => {
	test("a saved connection by name, with the secret values it read", async () => {
		const { store } = await makeStore({ TEAM: "night" });
		await store.save(docs);
		await store.setSecret("DOCS_TOKEN", "docs-secret");
		const { expansion, values } = await store.expandForTest({ name: "docs" });
		expect(expansion).toEqual({
			ok: true,
			servers: {
				docs: {
					url: "https://docs.example.com/mcp",
					headers: {
						Authorization: "Bearer docs-secret",
						"X-Team": "night-docs-secret",
					},
				},
			},
		});
		expect(values.sort()).toEqual(["docs-secret", "night"]);
	});

	test("a draft that is not saved yet", async () => {
		const { store } = await makeStore({ TRACKER_TOKEN: "env-token" });
		const { expansion, values } = await store.expandForTest({
			server: {
				command: "draft-mcp",
				args: [],
				env: { T: ref("TRACKER_TOKEN") },
			},
		});
		expect(expansion).toEqual({
			ok: true,
			servers: {
				draft: { command: "draft-mcp", args: [], env: { T: "env-token" } },
			},
		});
		expect(values).toEqual(["env-token"]);
		expect(store.list()).toEqual([]);
	});

	test("an unknown name", async () => {
		const { store } = await makeStore();
		expect(await store.expandForTest({ name: "ghost" })).toEqual({
			expansion: {
				ok: false,
				message: 'There is no connection named "ghost".',
			},
			values: [],
		});
	});

	test("a missing variable refuses the expansion", async () => {
		const { store } = await makeStore();
		await store.save(tracker);
		const { expansion, values } = await store.expandForTest({
			name: "tracker",
		});
		expect(expansion.ok).toBe(false);
		expect(!expansion.ok && expansion.message).toContain("TRACKER_TOKEN");
		expect(values).toEqual([]);
	});
});

describe("secretValues", () => {
	test("saved secrets and the variables of saved connections, nothing else", async () => {
		const { store } = await makeStore({
			TEAM: "night",
			TRACKER_TOKEN: "env-token",
			HOME: "/home/someone",
		});
		await store.save(docs);
		await store.save(tracker);
		await store.setSecret("DOCS_TOKEN", "docs-secret");
		await store.setSecret("UNUSED", "unused-secret");
		expect((await store.secretValues()).sort()).toEqual([
			"docs-secret",
			"env-token",
			"night",
			"unused-secret",
		]);
	});

	test("a referenced variable without a value adds nothing", async () => {
		const { store } = await makeStore();
		await store.save(tracker);
		expect(await store.secretValues()).toEqual([]);
	});
});
