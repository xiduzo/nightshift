import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { connection } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	type ConnectionInput,
	type ConnectionStore,
	createConnectionStore,
	type PersonalSecrets,
	type ProjectSecrets,
	referencedVariables,
	type SecretBackend,
	type StepRun,
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

/** The rows of the Secrets page. */
async function listed(store: ConnectionStore, named?: Iterable<string>) {
	return (await store.secrets(named)).secrets;
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
		const scope = "computer";
		expect(await store.secrets()).toEqual({
			personal: "available",
			secrets: [
				{
					name: "DOCS_TOKEN",
					scope,
					saved: true,
					inEnv: false,
					usedBy: ["docs", "wiki"],
					setAt: 5000,
					usedAt: null,
				},
				{
					name: "ORPHAN",
					scope,
					saved: true,
					inEnv: false,
					usedBy: [],
					setAt: 5000,
					usedAt: null,
				},
				{
					name: "TEAM",
					scope,
					saved: false,
					inEnv: true,
					usedBy: ["docs"],
					...never,
				},
				{
					name: "TRACKER_TOKEN",
					scope,
					saved: false,
					inEnv: false,
					usedBy: ["tracker"],
					...never,
				},
			],
		});
		// A name only a Command node uses is listed too.
		expect(
			(await listed(store, ["ZAC_USER", "TEAM"])).map((s) => [
				s.name,
				s.usedBy,
			]),
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
		expect((await listed(store)).map((s) => s.name)).toEqual(["_my_token_2"]);
	});

	test("setSecret refuses an empty value", async () => {
		const secrets = memorySecrets();
		const { store } = await makeStore({}, secrets);
		await expect(store.setSecret("TOKEN", "")).rejects.toThrow(
			"A secret needs a value.",
		);
		expect(secrets.values.size).toBe(0);
		expect(await listed(store)).toEqual([]);
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
		expect(await listed(store)).toEqual([
			{
				name: "TRACKER_TOKEN",
				scope: "computer",
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
	async function times(store: ConnectionStore, name: string) {
		const found = (await listed(store, [name])).find((s) => s.name === name);
		return found && { setAt: found.setAt, usedAt: found.usedAt };
	}

	test("setting a value records when; setting it again moves it; a restart keeps it", async () => {
		const { store, document, clock, secrets } = await timedStore();
		await store.setSecret("TOKEN", "one");
		expect(await times(store, "TOKEN")).toEqual({
			setAt: 1_000_000,
			usedAt: null,
		});
		clock.advance(5000);
		await store.setSecret("TOKEN", "two");
		expect(await times(store, "TOKEN")).toEqual({
			setAt: 1_005_000,
			usedAt: null,
		});
		expect(document.facts.get("secrets")).toEqual([
			{ name: "TOKEN", setAt: 1_005_000 },
		]);

		await document.flush();
		const { store: again } = await makeStore({}, secrets);
		expect(await times(again, "TOKEN")).toEqual({
			setAt: 1_005_000,
			usedAt: null,
		});
	});

	test("removing a secret removes its times; the environment's use starts over", async () => {
		const { store, clock } = await timedStore({ TOKEN: "env" });
		await store.setSecret("TOKEN", "keychain");
		await store.setSecret("OTHER", "o");
		clock.advance(1000);
		await store.secretEnv(["TOKEN", "OTHER"]);
		await store.removeSecret("TOKEN");
		expect(await times(store, "TOKEN")).toEqual({ setAt: null, usedAt: null });
		expect(await times(store, "OTHER")).toEqual({
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
		expect(
			(await listed(store)).map((s) => [s.name, s.saved, s.setAt]),
		).toEqual([
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
		const usedAt = async (name: string) =>
			(await times(store, name))?.usedAt ?? null;

		// Reading for the list, the source, or to mask a run is not a use.
		store.list();
		store.secretSource("TRACKER_TOKEN");
		await store.secretValues();
		expect((await listed(store)).every((s) => s.usedAt === null)).toBe(true);

		clock.advance(1000); // an Agent node's or a Tool node's MCP server
		await store.mcpServersFor({ connections: ["tracker"] });
		expect(await usedAt("TRACKER_TOKEN")).toBe(1_001_000);
		expect(await usedAt("DOCS_TOKEN")).toBeNull();

		clock.advance(1000); // a connection test
		await store.expandForTest({ name: "docs" });
		expect(await usedAt("DOCS_TOKEN")).toBe(1_002_000);
		// A variable from the environment counts too.
		expect(await usedAt("TEAM")).toBe(1_002_000);

		clock.advance(1000); // a custom agent's environment
		// Its values are the session's to hide, from the environment too.
		expect(await store.expandEnv({ X: ref("FROM_ENV") })).toMatchObject({
			ok: true,
			values: ["e"],
		});
		expect(await usedAt("FROM_ENV")).toBe(1_003_000);

		clock.advance(1000); // a Command node's secrets
		await store.secretEnv(["CMD"]);
		expect(await usedAt("CMD")).toBe(1_004_000);

		clock.advance(1000); // a decider's API key
		await store.secret("API_KEY");
		expect(await usedAt("API_KEY")).toBe(1_005_000);

		expect(await usedAt("UNUSED")).toBeNull();
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
		expect((await listed(store)).map((s) => s.usedAt)).toEqual([null, null]);
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
		expect((await times(store, "A"))?.usedAt).toBe(1_000_000);

		clock.advance(30_000);
		await store.secretEnv(["A", "B"]);
		expect(writes).toBe(2);
		expect((await times(store, "A"))?.usedAt).toBe(1_060_000);
		expect((await times(store, "B"))?.usedAt).toBe(1_060_000);

		// What the next start reads.
		await document.flush();
		const { store: again } = await makeStore();
		expect((await times(again, "B"))?.usedAt).toBe(1_060_000);
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

/**
 * The Person's Personal secrets in memory, as the Home Host keeps them.
 * `down` makes every call fail, as a Host that cannot be reached.
 */
function memoryPersonal(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const state = { down: false, calls: 0 };
	const check = () => {
		state.calls += 1;
		if (state.down) throw new Error("The Host cannot be reached.");
	};
	const port: PersonalSecrets = {
		async list() {
			check();
			return [...values.keys()].sort().map((name) => ({ name, setAt: 7 }));
		},
		async values(names) {
			check();
			return Object.fromEntries(
				names.flatMap((name) => {
					const value = values.get(name);
					return value === undefined ? [] : [[name, value]];
				}),
			);
		},
		async set(name, value) {
			check();
			values.set(name, value);
		},
		async remove(name) {
			check();
			values.delete(name);
		},
	};
	return { port, values, state };
}

describe("Personal secrets (ADR 13)", () => {
	async function personalStore(options: {
		env?: Record<string, string>;
		keychain?: Record<string, string>;
		personal?: Record<string, string>;
	}) {
		const keychain = memorySecrets();
		const store = createConnectionStore({
			document: await sandbox.openDocument(),
			env: options.env ?? {},
			secrets: keychain.backend,
			personal: () => personal.port,
		});
		// Saved through the store, so the Device facts name them.
		for (const [name, value] of Object.entries(options.keychain ?? {})) {
			await store.setSecret(name, value);
		}
		const personal = memoryPersonal(options.personal);
		return { store, keychain, personal };
	}

	test("a name reads Personal, then this computer, then the environment", async () => {
		const { store } = await personalStore({
			env: { A: "env-a", B: "env-b", C: "env-c" },
			keychain: { A: "computer-a", B: "computer-b" },
			personal: { A: "personal-a" },
		});
		expect(await store.secretEnv(["A", "B", "C"])).toEqual({
			ok: true,
			env: { A: "personal-a", B: "computer-b", C: "env-c" },
		});
		expect(await store.secret("A")).toBe("personal-a");
		expect(store.secretSource("A")).toBe("personal");
		expect(store.secretSource("B")).toBe("keychain");
	});

	test("a use under an Offer reads no Personal secret", async () => {
		const { store, personal } = await personalStore({
			keychain: { SHARED: "computer" },
			personal: { SHARED: "personal", ONLY_MINE: "mine" },
		});
		await store.save({
			name: "mine",
			server: { command: "x", env: { T: ref("ONLY_MINE") } },
		});
		const calls = personal.state.calls;
		expect(
			await store.secretEnv(["SHARED", "ONLY_MINE"], { personal: false }),
		).toEqual({ ok: false, missing: ["ONLY_MINE"] });
		expect(await store.secretEnv(["SHARED"], { personal: false })).toEqual({
			ok: true,
			env: { SHARED: "computer" },
		});
		expect(
			(
				await store.mcpServersFor(
					{ connections: ["mine"] },
					{ personal: false },
				)
			).ok,
		).toBe(false);
		expect(await store.secretValues({ personal: false })).toEqual(["computer"]);
		// It never asked for them.
		expect(personal.state.calls).toBe(calls);
	});

	test("fails closed: a Personal name has no value while the Personal secrets cannot be read", async () => {
		const { store, personal } = await personalStore({
			env: { TOKEN: "env-token", OTHER: "env-other" },
			personal: { TOKEN: "personal-token" },
		});
		// This computer learns which names are Personal at a use or a list.
		await store.secrets();
		personal.state.down = true;
		const found = await store.secretEnv(["TOKEN", "OTHER"]);
		expect(found).toEqual({ ok: false, missing: ["TOKEN"], unreachable: true });
		// A name that is not Personal still reads the environment.
		expect(await store.secretEnv(["OTHER"])).toEqual({
			ok: true,
			env: { OTHER: "env-other" },
		});
		expect(await store.secrets()).toMatchObject({ personal: "unavailable" });
	});

	test("before the devices start, a Personal name is missing and says why", async () => {
		const store = createConnectionStore({
			document: await sandbox.openDocument(),
			env: {},
			secrets: memorySecrets().backend,
			personal: () => null,
		});
		expect(await store.secretEnv(["TOKEN"])).toEqual({
			ok: false,
			missing: ["TOKEN"],
			unreachable: true,
		});
	});

	test("the list has each scope: Personal first, a name in both scopes twice", async () => {
		const { store } = await personalStore({
			keychain: { BOTH: "c", HERE: "h" },
			personal: { BOTH: "p", MINE: "m" },
		});
		const rows = (await store.secrets()).secrets.map((s) => [
			s.name,
			s.scope,
			s.saved,
			s.setAt === null ? null : "set",
		]);
		expect(rows).toEqual([
			["BOTH", "personal", true, "set"],
			["BOTH", "computer", true, "set"],
			["HERE", "computer", true, "set"],
			["MINE", "personal", true, "set"],
		]);
	});

	test("set and remove a Personal secret: the value goes to the Person's store only", async () => {
		const { store, keychain, personal } = await personalStore({});
		let changes = 0;
		store.onSecretsChange(() => {
			changes += 1;
		});
		await store.setSecret("MINE", "m", "personal");
		expect(personal.values.get("MINE")).toBe("m");
		expect(keychain.values.has("MINE")).toBe(false);
		expect((await savedNow()).secrets).toEqual([]);
		await store.removeSecret("MINE", "personal");
		expect(personal.values.has("MINE")).toBe(false);
		expect(changes).toBe(2);
	});

	test("move to Personal: the value lands there, and this computer's copy goes", async () => {
		const { store, keychain, personal } = await personalStore({
			keychain: { GH_TOKEN: "ghp_secret" },
		});
		await store.moveSecret("GH_TOKEN", "personal");
		expect(personal.values.get("GH_TOKEN")).toBe("ghp_secret");
		expect(keychain.values.has("GH_TOKEN")).toBe(false);
		expect((await savedNow()).secrets).toEqual([]);
		expect(await store.secret("GH_TOKEN")).toBe("ghp_secret");
	});

	test("a move that cannot reach the Personal secrets keeps this computer's copy", async () => {
		const { store, keychain, personal } = await personalStore({
			keychain: { GH_TOKEN: "ghp_secret" },
		});
		personal.state.down = true;
		await expect(store.moveSecret("GH_TOKEN", "personal")).rejects.toThrow();
		expect(keychain.values.get("GH_TOKEN")).toBe("ghp_secret");
		expect((await savedNow()).secrets).toEqual(["GH_TOKEN"]);
	});

	test("move to this computer, and a move of a value that is not there", async () => {
		const { store, keychain, personal } = await personalStore({
			personal: { API_KEY: "sk-1" },
		});
		await store.moveSecret("API_KEY", "computer");
		expect(keychain.values.get("API_KEY")).toBe("sk-1");
		expect(personal.values.has("API_KEY")).toBe(false);
		await expect(store.moveSecret("API_KEY", "computer")).rejects.toThrow(
			"API_KEY is not a Personal secret.",
		);
		await expect(store.moveSecret("NOPE", "personal")).rejects.toThrow(
			"This computer has no saved value of NOPE.",
		);
	});

	test("masking takes every Personal value too", async () => {
		const { store } = await personalStore({
			keychain: { HERE: "computer-value" },
			personal: { MINE: "personal-value" },
		});
		expect((await store.secretValues()).sort()).toEqual([
			"computer-value",
			"personal-value",
		]);
	});
});

/**
 * The Project secrets in memory, as the Host that keeps the Space keeps
 * them, by Project. `down` makes every call fail, as a Host that cannot
 * be reached.
 */
function memoryProjects(initial: Record<string, Record<string, string>> = {}) {
	const values = new Map(
		Object.entries(initial).map(([id, v]) => [id, new Map(Object.entries(v))]),
	);
	const state = { down: false, calls: 0, asked: [] as StepRun[] };
	const check = () => {
		state.calls += 1;
		if (state.down) throw new Error("The Host cannot be reached.");
	};
	const of = (projectId: string) => {
		let found = values.get(projectId);
		if (!found) {
			found = new Map();
			values.set(projectId, found);
		}
		return found;
	};
	const port: ProjectSecrets = {
		async list({ projectId }) {
			check();
			return [...of(projectId).keys()].sort().map((name) => ({
				name,
				setAt: 9,
				setBy: { id: "ann", name: "Ann" },
			}));
		},
		async values(run, names) {
			check();
			state.asked.push(run);
			const kept = of(run.projectId);
			return Object.fromEntries(
				(names ?? [...kept.keys()]).flatMap((name) => {
					const value = kept.get(name);
					return value === undefined ? [] : [[name, value]];
				}),
			);
		},
		async set({ projectId }, name, value) {
			check();
			of(projectId).set(name, value);
		},
		async remove({ projectId }, name) {
			check();
			of(projectId).delete(name);
		},
		async take({ projectId }, name) {
			check();
			return of(projectId).get(name) ?? null;
		},
		async kept({ projectId }) {
			check();
			return [...of(projectId).values()];
		},
	};
	return { port, values, state };
}

describe("Project secrets (ADR 13)", () => {
	const project = { spaceId: "space-1", projectId: "app" };
	const step = { ...project, runId: "run-1" };

	async function scopedStore(options: {
		env?: Record<string, string>;
		keychain?: Record<string, string>;
		personal?: Record<string, string>;
		projects?: Record<string, Record<string, string>>;
	}) {
		const keychain = memorySecrets();
		const personal = memoryPersonal(options.personal);
		const projects = memoryProjects(options.projects);
		const store = createConnectionStore({
			document: await sandbox.openDocument(),
			env: options.env ?? {},
			secrets: keychain.backend,
			personal: () => personal.port,
			projects: () => projects.port,
		});
		for (const [name, value] of Object.entries(options.keychain ?? {})) {
			await store.setSecret(name, value);
		}
		return { store, keychain, personal, projects };
	}

	test("a step's name reads its Project, then Personal, then this computer, then the environment", async () => {
		const { store, projects } = await scopedStore({
			env: { A: "env-a", B: "env-b", C: "env-c", D: "env-d" },
			keychain: { A: "computer-a", B: "computer-b", C: "computer-c" },
			personal: { A: "personal-a", B: "personal-b" },
			projects: { app: { A: "project-a" }, other: { B: "other-b" } },
		});
		expect(
			await store.secretEnv(["A", "B", "C", "D"], { project: step }),
		).toEqual({
			ok: true,
			env: { A: "project-a", B: "personal-b", C: "computer-c", D: "env-d" },
		});
		// It asked for the step's run, and nothing of another Project.
		expect(projects.state.asked).toEqual([step]);
		// A use that is not a step's reads no Project secret.
		expect(await store.secretEnv(["A"])).toEqual({
			ok: true,
			env: { A: "personal-a" },
		});
	});

	test("an MCP server and a custom agent of a step read the Project's value", async () => {
		const { store } = await scopedStore({
			keychain: { TOKEN: "computer" },
			projects: { app: { TOKEN: "project" } },
		});
		await store.save({
			name: "tracker",
			server: { command: "x", env: { T: ref("TOKEN") } },
		});
		const servers = await store.mcpServersFor(
			{ connections: ["tracker"] },
			{ project: step },
		);
		expect(servers.ok && servers.servers.tracker).toMatchObject({
			env: { T: "project" },
		});
		expect(
			await store.expandEnv({ KEY: ref("TOKEN") }, { project: step }),
		).toMatchObject({ ok: true, env: { KEY: "project" } });
	});

	test("a decider's API key of a step reads the Project's value; without a run, this computer's", async () => {
		const { store } = await scopedStore({
			keychain: { MODEL_KEY: "computer" },
			projects: { app: { MODEL_KEY: "project" } },
		});
		expect(await store.secret("MODEL_KEY", { project: step })).toBe("project");
		expect(await store.secret("MODEL_KEY")).toBe("computer");
	});

	test("under an Offer: the run's Project secrets, but no Personal one", async () => {
		const { store, personal } = await scopedStore({
			personal: { MINE: "personal" },
			projects: { app: { SHARED: "project" } },
		});
		const calls = personal.state.calls;
		expect(
			await store.secretEnv(["SHARED", "MINE"], {
				personal: false,
				project: step,
			}),
		).toEqual({ ok: false, missing: ["MINE"] });
		expect(
			await store.secretEnv(["SHARED"], { personal: false, project: step }),
		).toEqual({ ok: true, env: { SHARED: "project" } });
		expect(personal.state.calls).toBe(calls);
	});

	test("fails closed: a Project name has no value while the Project's secrets cannot be read", async () => {
		const { store, projects } = await scopedStore({
			keychain: { TOKEN: "computer-token" },
			env: { OTHER: "env-other" },
			projects: { app: { TOKEN: "project-token" } },
		});
		// This computer learns which names are the Project's at a use or a list.
		await store.secretEnv(["TOKEN"], { project: step });
		projects.state.down = true;
		expect(
			await store.secretEnv(["TOKEN", "OTHER"], { project: step }),
		).toEqual({ ok: false, missing: ["TOKEN"], projectUnreachable: true });
		expect(await store.secretEnv(["OTHER"], { project: step })).toEqual({
			ok: true,
			env: { OTHER: "env-other" },
		});
	});

	test("masking a step's output takes every value of its Project, and the export the kept ones", async () => {
		const { store } = await scopedStore({
			keychain: { HERE: "computer-value" },
			projects: {
				app: { HERE: "project-here", DB_URL: "postgres://x" },
				other: { NOPE: "other-value" },
			},
		});
		expect((await store.secretValues({ project: step })).sort()).toEqual([
			"computer-value",
			"postgres://x",
			"project-here",
		]);
		expect((await store.exportValues(project)).sort()).toEqual([
			"computer-value",
			"postgres://x",
			"project-here",
		]);
		expect(await store.secretValues()).toEqual(["computer-value"]);
	});

	test("list, set and remove a Project secret: the value goes to the Project only", async () => {
		const { store, keychain, projects } = await scopedStore({});
		await store.setProjectSecret(project, "DB_URL", "postgres://x", "ann");
		expect(projects.values.get("app")?.get("DB_URL")).toBe("postgres://x");
		expect(keychain.values.has("DB_URL")).toBe(false);
		expect((await savedNow()).secrets).toEqual([]);
		expect(await store.projectSecrets(project, "ann")).toEqual([
			{ name: "DB_URL", setAt: 9, setBy: { id: "ann", name: "Ann" } },
		]);
		await store.removeProjectSecret(project, "DB_URL", "ann");
		expect(projects.values.get("app")?.has("DB_URL")).toBe(false);
		await expect(
			store.setProjectSecret(project, "EMPTY", "", "ann"),
		).rejects.toThrow("A secret needs a value.");
	});

	test("move into a Project: from this computer or from Personal, the old copy goes after", async () => {
		const { store, keychain, personal, projects } = await scopedStore({
			keychain: { GH_TOKEN: "ghp" },
			personal: { API_KEY: "sk" },
		});
		await store.moveToProject("GH_TOKEN", "computer", project, "ann");
		expect(projects.values.get("app")?.get("GH_TOKEN")).toBe("ghp");
		expect(keychain.values.has("GH_TOKEN")).toBe(false);
		expect((await savedNow()).secrets).toEqual([]);
		await store.moveToProject("API_KEY", "personal", project, "ann");
		expect(projects.values.get("app")?.get("API_KEY")).toBe("sk");
		expect(personal.values.has("API_KEY")).toBe(false);
		await expect(
			store.moveToProject("NOPE", "computer", project, "ann"),
		).rejects.toThrow("This computer has no saved value of NOPE.");
	});

	test("a move into a Project that fails keeps the copy it moves from", async () => {
		const { store, keychain, projects } = await scopedStore({
			keychain: { GH_TOKEN: "ghp" },
		});
		projects.state.down = true;
		await expect(
			store.moveToProject("GH_TOKEN", "computer", project, "ann"),
		).rejects.toThrow();
		expect(keychain.values.get("GH_TOKEN")).toBe("ghp");
	});

	test("move out of a Project: to this computer or to Personal, the Project's copy goes after", async () => {
		const { store, keychain, personal, projects } = await scopedStore({
			projects: { app: { DB_URL: "postgres://x", API_KEY: "sk" } },
		});
		await store.moveFromProject(project, "DB_URL", "computer", "ann");
		expect(keychain.values.get("DB_URL")).toBe("postgres://x");
		expect(projects.values.get("app")?.has("DB_URL")).toBe(false);
		await store.moveFromProject(project, "API_KEY", "personal", "ann");
		expect(personal.values.get("API_KEY")).toBe("sk");
		expect(projects.values.get("app")?.has("API_KEY")).toBe(false);
		await expect(
			store.moveFromProject(project, "API_KEY", "computer", "ann"),
		).rejects.toThrow("API_KEY is not a secret of this project.");
	});

	test("a move out of a Project whose save fails keeps the Project's copy", async () => {
		const { store, personal, projects } = await scopedStore({
			projects: { app: { DB_URL: "postgres://x" } },
		});
		personal.state.down = true;
		await expect(
			store.moveFromProject(project, "DB_URL", "personal", "ann"),
		).rejects.toThrow();
		expect(projects.values.get("app")?.get("DB_URL")).toBe("postgres://x");
	});
});
