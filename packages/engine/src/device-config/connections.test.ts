import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connection } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	type ConnectionInput,
	type ConnectionStore,
	createConnectionStore,
	referencedVariables,
	type SecretBackend,
} from "./connections";

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
	now?: () => number,
) {
	const store = createConnectionStore({
		document: await sandbox.openDocument(),
		env,
		secrets: secrets.backend,
		now,
	});
	await store.load();
	return { store, secrets };
}

/** What the next start reads: the connection names and the facts' secret names. */
async function savedNow() {
	const document = await sandbox.openDocument();
	const secrets =
		(document.facts.get("secrets") as { name: string }[] | undefined) ?? [];
	return {
		connections: [...document.connections.keys()].sort(),
		secrets: secrets.map((s) => s.name),
	};
}

/** A clock a test moves by hand. */
function testClock(start = 1_000_000) {
	let at = start;
	return {
		now: () => at,
		advance(ms: number) {
			at += ms;
		},
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
		const clock = testClock(5000);
		const { store } = await makeStore(
			{ TEAM: "night", UNUSED_ENV: "x" },
			memorySecrets(),
			clock.now,
		);
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

		const never = { setAt: null, usedAt: null };
		expect(store.secrets()).toEqual([
			{
				name: "DOCS_TOKEN",
				saved: true,
				inEnv: false,
				usedBy: ["docs", "wiki"],
				setAt: 5000,
				usedAt: null,
			},
			{
				name: "ORPHAN",
				saved: true,
				inEnv: false,
				usedBy: [],
				setAt: 5000,
				usedAt: null,
			},
			{ name: "TEAM", saved: false, inEnv: true, usedBy: ["docs"], ...never },
			{
				name: "TRACKER_TOKEN",
				saved: false,
				inEnv: false,
				usedBy: ["tracker"],
				...never,
			},
		]);
		// A name only a Command node uses is listed too.
		expect(
			store.secrets(["ZAC_USER", "TEAM"]).map((s) => [s.name, s.usedBy]),
		).toEqual([
			["DOCS_TOKEN", ["docs", "wiki"]],
			["ORPHAN", []],
			["TEAM", ["docs"]],
			["TRACKER_TOKEN", ["tracker"]],
			["ZAC_USER", []],
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
			{
				name: "TRACKER_TOKEN",
				saved: false,
				inEnv: true,
				usedBy: ["tracker"],
				setAt: null,
				usedAt: null,
			},
		]);
	});

	test("secretEnv: each name as itself, the keychain over the environment, or the names that are missing", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore(
			{ ZAC_USER: "env-user", ZAC_PASSWORD: "env-pw", PATH: "/bin" },
			secrets,
		);
		await store.setSecret("ZAC_PASSWORD", "keychain-pw");
		expect(await store.secretEnv(["ZAC_USER", "ZAC_PASSWORD"])).toEqual({
			ok: true,
			env: { ZAC_USER: "env-user", ZAC_PASSWORD: "keychain-pw" },
		});
		expect(
			await store.secretEnv(["ZAC_PASSWORD", "ZAC_ADMIN", "ZAC_ROOT"]),
		).toEqual({ ok: false, missing: ["ZAC_ADMIN", "ZAC_ROOT"] });
	});
});

describe("when a secret was set and used", () => {
	/** A store with a hand-moved clock, over a document the test holds too. */
	async function timedStore(env: Record<string, string> = {}) {
		const clock = testClock();
		const document = await sandbox.openDocument();
		const secrets = memorySecrets();
		const store = createConnectionStore({
			document,
			env,
			secrets: secrets.backend,
			now: clock.now,
		});
		return { store, document, clock, secrets };
	}
	function times(store: ConnectionStore, name: string) {
		const found = store.secrets([name]).find((s) => s.name === name);
		return found && { setAt: found.setAt, usedAt: found.usedAt };
	}

	test("setting a value records when; setting it again moves it; a restart keeps it", async () => {
		const { store, document, clock, secrets } = await timedStore();
		await store.setSecret("TOKEN", "one");
		expect(times(store, "TOKEN")).toEqual({ setAt: 1_000_000, usedAt: null });
		clock.advance(5000);
		await store.setSecret("TOKEN", "two");
		expect(times(store, "TOKEN")).toEqual({ setAt: 1_005_000, usedAt: null });
		expect(document.facts.get("secrets")).toEqual([
			{ name: "TOKEN", setAt: 1_005_000 },
		]);

		await document.flush();
		const { store: again } = await makeStore({}, secrets);
		expect(times(again, "TOKEN")).toEqual({ setAt: 1_005_000, usedAt: null });
	});

	test("removing a secret removes its times; the environment's use starts over", async () => {
		const { store, clock } = await timedStore({ TOKEN: "env" });
		await store.setSecret("TOKEN", "keychain");
		await store.setSecret("OTHER", "o");
		clock.advance(1000);
		await store.secretEnv(["TOKEN", "OTHER"]);
		await store.removeSecret("TOKEN");
		expect(times(store, "TOKEN")).toEqual({ setAt: null, usedAt: null });
		expect(times(store, "OTHER")).toEqual({
			setAt: 1_000_000,
			usedAt: 1_001_000,
		});
	});

	test("an older document's bare names still read, with no time; the next save keeps them", async () => {
		const document = await sandbox.openDocument();
		await document.change(() => {
			document.facts.set("secrets", [
				"OLD_TOKEN",
				42,
				{ name: "NEWER", setAt: 7 },
			]);
		});
		const store = createConnectionStore({
			document,
			env: {},
			secrets: memorySecrets({ OLD_TOKEN: "old" }).backend,
			now: testClock().now,
		});
		expect(store.secrets().map((s) => [s.name, s.saved, s.setAt])).toEqual([
			["NEWER", true, 7],
			["OLD_TOKEN", true, null],
		]);
		expect(await store.secret("OLD_TOKEN")).toBe("old");

		await store.setSecret("ADDED", "a");
		expect(document.facts.get("secrets")).toEqual([
			{ name: "ADDED", setAt: 1_000_000 },
			{ name: "NEWER", setAt: 7 },
			{ name: "OLD_TOKEN", setAt: null },
		]);
	});

	test("each kind of use records the names it read; listing and masking do not", async () => {
		const { store, clock } = await timedStore({
			TEAM: "night",
			FROM_ENV: "e",
		});
		await store.save(tracker);
		await store.save(docs);
		for (const name of ["TRACKER_TOKEN", "DOCS_TOKEN", "API_KEY", "CMD"]) {
			await store.setSecret(name, "v");
		}
		await store.setSecret("UNUSED", "u");
		const usedAt = (name: string) => times(store, name)?.usedAt ?? null;

		// Reading for the list, the source, or to mask a run is not a use.
		store.list();
		store.secretSource("TRACKER_TOKEN");
		await store.secretValues();
		expect(store.secrets().every((s) => s.usedAt === null)).toBe(true);

		clock.advance(1000); // an Agent node's or a Tool node's MCP server
		await store.mcpServersFor({ connections: ["tracker"] });
		expect(usedAt("TRACKER_TOKEN")).toBe(1_001_000);
		expect(usedAt("DOCS_TOKEN")).toBeNull();

		clock.advance(1000); // a connection test
		await store.expandForTest({ name: "docs" });
		expect(usedAt("DOCS_TOKEN")).toBe(1_002_000);
		// A variable from the environment counts too.
		expect(usedAt("TEAM")).toBe(1_002_000);

		clock.advance(1000); // a custom agent's environment
		// Its values are the session's to hide, from the environment too.
		expect(await store.expandEnv({ X: ref("FROM_ENV") })).toMatchObject({
			ok: true,
			values: ["e"],
		});
		expect(usedAt("FROM_ENV")).toBe(1_003_000);

		clock.advance(1000); // a Command node's secrets
		await store.secretEnv(["CMD"]);
		expect(usedAt("CMD")).toBe(1_004_000);

		clock.advance(1000); // a decider's API key
		await store.secret("API_KEY");
		expect(usedAt("API_KEY")).toBe(1_005_000);

		expect(usedAt("UNUSED")).toBeNull();
	});

	test("a use that fails for a missing value records nothing", async () => {
		const { store } = await timedStore();
		await store.setSecret("HAVE", "h");
		await store.save({
			name: "half",
			server: { command: "x", env: { A: ref("HAVE"), B: ref("LACK") } },
		});
		expect((await store.mcpServersFor({ connections: ["half"] })).ok).toBe(
			false,
		);
		expect((await store.expandForTest({ name: "half" })).expansion.ok).toBe(
			false,
		);
		expect((await store.secretEnv(["HAVE", "LACK"])).ok).toBe(false);
		expect((await store.expandEnv({ X: ref("HAVE") + ref("LACK") })).ok).toBe(
			false,
		);
		expect(await store.secret("LACK")).toBeUndefined();
		expect(store.secrets().map((s) => s.usedAt)).toEqual([null, null]);
	});

	test("a use writes the document at most once a minute per secret", async () => {
		const { store, document, clock } = await timedStore();
		await store.setSecret("A", "a");
		await store.setSecret("B", "b");
		let writes = 0;
		document.doc.on("update", () => {
			writes++;
		});

		await store.secretEnv(["A", "B"]);
		expect(writes).toBe(1);
		clock.advance(30_000);
		await store.secretEnv(["A"]);
		await store.secret("B");
		expect(writes).toBe(1);
		expect(times(store, "A")?.usedAt).toBe(1_000_000);

		clock.advance(30_000);
		await store.secretEnv(["A", "B"]);
		expect(writes).toBe(2);
		expect(times(store, "A")?.usedAt).toBe(1_060_000);
		expect(times(store, "B")?.usedAt).toBe(1_060_000);

		// What the next start reads.
		await document.flush();
		const { store: again } = await makeStore();
		expect(times(again, "B")?.usedAt).toBe(1_060_000);
	});
});

describe("mcpServersFor", () => {
	test("the node's connections, expanded", async () => {
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
			},
			values: ["env-tracker", "keychain-docs", "night"],
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

	test("no connections is an empty set", async () => {
		const { store } = await makeStore();
		expect(await store.mcpServersFor({})).toEqual({
			ok: true,
			servers: {},
			values: [],
		});
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
			values: ["docs-secret", "night"],
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
			values: ["env-token"],
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
