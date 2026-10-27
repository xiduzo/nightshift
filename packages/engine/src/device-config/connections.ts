import { join } from "node:path";
import {
	type AgentNode,
	type McpServer,
	mcpServerSchema,
	nameSchema,
	secretNameSchema,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device-document";
import { type KeyStoreKind, keychainValues, valueStore } from "./keychain";
import { expandMcpServers, type McpExpansion } from "./mcp";

/**
 * Connections: MCP servers defined once in this Device's document, named
 * by Agent nodes. Secrets stay `${NAME}` references. A reference reads the
 * system keychain first (a secret saved on the Connections page), then the
 * daemon's environment. Values never reach the database, the document, the
 * log or the UI: the document holds the names of the saved secrets only,
 * with when each was last set and last used.
 */

/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const connectionInputSchema = z.object({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
	server: mcpServerSchema,
});
export type ConnectionInput = z.input<typeof connectionInputSchema>;

/** Where a `${NAME}` gets its value. */
export type SecretSource = "keychain" | "env" | "missing";

export type Connection = {
	name: string;
	description: string | null;
	server: McpServer;
	/** The `${NAME}` references in its env values and headers. */
	variables: { name: string; source: SecretSource }[];
	updatedAt: number;
};

export type SecretView = {
	name: string;
	/** Saved in the system keychain from the Connections page. */
	saved: boolean;
	/** Set in the daemon's environment. */
	inEnv: boolean;
	/** The connections that reference it. */
	usedBy: string[];
	/** When a value was last saved through Night Shift (epoch ms). Null: not known, or never. */
	setAt: number | null;
	/** When Night Shift last read it to use it (epoch ms), to the minute. Null: never, or not since it was removed. */
	usedAt: number | null;
};

/** A use is written at most once a minute per secret: the time is to the minute. */
const SECRET_USE_INTERVAL_MS = 60_000;

/** Where secret values live: the system keychain through `Bun.secrets`, or files on a headless computer. */
export type SecretBackend = {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
};

const SECRETS_SERVICE = "nightshift";

export function keychainSecrets(service = SECRETS_SERVICE): SecretBackend {
	return keychainValues(service);
}

/**
 * The secrets saved on the Connections page: in the keychain where it
 * works, else in `<data dir>/secrets`, one file per secret, readable by
 * this user only. `prefer: "file"` skips the keychain.
 */
export function secretStore(options: {
	dataDir: string;
	prefer?: KeyStoreKind;
}): Promise<SecretBackend & { readonly kind: KeyStoreKind }> {
	return valueStore({
		service: SECRETS_SERVICE,
		dir: join(options.dataDir, "secrets"),
		prefer: options.prefer,
	});
}

export type ConnectionStore = {
	/** Reads the connections and secret names. Call once before `names`. */
	load(): Promise<void>;
	/** The connection names, for the start check. */
	names(): ReadonlySet<string>;
	list(): Connection[];
	get(name: string): Connection | null;
	/** Creates or replaces a connection. */
	save(input: ConnectionInput): Promise<Connection>;
	remove(name: string): Promise<void>;
	/**
	 * The secrets: the saved ones and the ones connections reference, and
	 * `named` (a Command node's), with where each is set and when.
	 */
	secrets(named?: Iterable<string>): SecretView[];
	/** A secret's value, to use: the keychain, then the daemon's environment. */
	secret(name: string): Promise<string | undefined>;
	/** Where a secret's value comes from. */
	secretSource(name: string): SecretSource;
	setSecret(name: string, value: string): Promise<void>;
	removeSecret(name: string): Promise<void>;
	/** An Agent node's MCP servers: its connections, with `${NAME}` expanded. */
	mcpServersFor(node: Pick<AgentNode, "connections">): Promise<McpExpansion>;
	/**
	 * One server, expanded, for a test: a saved connection by name, or a draft.
	 * `values` are the secret values it read, to take out of error text.
	 */
	expandForTest(
		target: { name: string } | { server: McpServer },
	): Promise<{ expansion: McpExpansion; values: string[] }>;
	/**
	 * The values of the saved secrets and of the variables the connections
	 * reference, to take out of an exported run. Not a use.
	 */
	secretValues(): Promise<string[]>;
	/**
	 * Environment values with `${NAME}` expanded from the secrets, then the
	 * daemon's environment: a custom agent's env. `missing` names the
	 * references with no value; then nothing is expanded.
	 */
	expandEnv(values: Record<string, string>): Promise<SecretEnv>;
	/**
	 * Secrets by name, each as an environment variable of that name: the
	 * keychain, then the daemon's environment. A Command node's `secrets`.
	 * `missing` names the ones with no value; then `env` is not given.
	 */
	secretEnv(names: readonly string[]): Promise<SecretEnv>;
};

/** Environment values read from the secrets, or the names that have no value. */
export type SecretEnv =
	| { ok: true; env: Record<string, string> }
	| { ok: false; missing: string[] };

/** The `${NAME}` references of a server's env values and headers. */
export function referencedVariables(server: McpServer): string[] {
	const values = Object.values(
		"command" in server ? (server.env ?? {}) : (server.headers ?? {}),
	);
	const names = new Set<string>();
	for (const value of values) {
		for (const match of value.matchAll(REFERENCE)) {
			if (match[1]) names.add(match[1]);
		}
	}
	return [...names];
}

/** A connection as the Device document holds it. */
const entrySchema = z.object({
	description: z.string().nullable(),
	server: z.unknown(),
	updatedAt: z.number(),
});

/** A saved secret as the Device facts hold it. An older document holds the bare name. */
/** A saved secret as the document's facts hold it: an older document holds bare names. */
export const savedSecretSchema = z.union([
	z.string().transform((name) => ({ name, setAt: null })),
	z.object({ name: z.string(), setAt: z.number().nullable() }),
]);

export function createConnectionStore(options: {
	document: DeviceDocument;
	env: Readonly<Record<string, string | undefined>>;
	secrets: SecretBackend;
	/** The clock for the set and use times. */
	now?: () => number;
}): ConnectionStore {
	const { document, env, secrets, now = Date.now } = options;
	const connectionView = mapView(document, document.connections, () => {
		const out = new Map<string, Omit<Connection, "variables">>();
		for (const [name, value] of document.connections.entries()) {
			const entry = entrySchema.safeParse(value);
			if (!entry.success) continue;
			const server = mcpServerSchema.safeParse(entry.data.server);
			if (!server.success) continue;
			out.set(name, {
				name,
				description: entry.data.description,
				server: server.data,
				updatedAt: entry.data.updatedAt,
			});
		}
		return out;
	});
	/**
	 * The saved secrets, name → when it was set, are a Device fact: the
	 * keychain cannot list them. An entry that does not parse is skipped.
	 */
	const secretView = mapView(document, document.facts, () => {
		const stored = document.facts.get("secrets");
		const out = new Map<string, number | null>();
		for (const item of Array.isArray(stored) ? stored : []) {
			const parsed = savedSecretSchema.safeParse(item);
			if (parsed.success) out.set(parsed.data.name, parsed.data.setAt);
		}
		return out;
	});
	/** When each secret was last used: any name, saved or from the environment. */
	const usedView = mapView(document, document.facts, () => {
		const parsed = z
			.record(z.string(), z.unknown())
			.safeParse(document.facts.get("secretsUsedAt"));
		const out = new Map<string, number>();
		for (const [name, at] of Object.entries(
			parsed.success ? parsed.data : {},
		)) {
			if (typeof at === "number") out.set(name, at);
		}
		return out;
	});
	/** Writes the saved secrets, and the use times without `forget`. */
	function writeSecrets(
		saved: Map<string, number | null>,
		forget?: string,
	): Promise<void> {
		return document.change(() => {
			document.facts.set(
				"secrets",
				[...saved.keys()].sort().map((name) => ({
					name,
					setAt: saved.get(name) ?? null,
				})),
			);
			if (forget !== undefined && usedView().has(forget)) {
				const used = new Map(usedView());
				used.delete(forget);
				document.facts.set("secretsUsedAt", Object.fromEntries(used));
			}
		});
	}
	/**
	 * Notes that Night Shift read these secrets to use them. Writes the
	 * document at most once a minute per name, and never holds up the use: a
	 * failed write is logged by the document, and a lost time is fine.
	 */
	function recordUse(names: Iterable<string>): void {
		const at = now();
		const used = usedView();
		const due = [...new Set(names)].filter((name) => {
			const last = used.get(name);
			return (
				last === undefined || Math.abs(at - last) >= SECRET_USE_INTERVAL_MS
			);
		});
		if (due.length === 0) return;
		const next = new Map(used);
		for (const name of due) next.set(name, at);
		document
			.change(() => {
				document.facts.set("secretsUsedAt", Object.fromEntries(next));
			})
			.catch(() => {});
	}

	function source(variable: string): SecretSource {
		if (secretView().has(variable)) return "keychain";
		return env[variable] === undefined ? "missing" : "env";
	}

	function withVariables(c: Omit<Connection, "variables">): Connection {
		return {
			...c,
			variables: referencedVariables(c.server).map((name) => ({
				name,
				source: source(name),
			})),
		};
	}

	/** The environment for an expansion: the keychain values of `names` over the daemon's environment. */
	async function envFor(
		names: Iterable<string>,
	): Promise<Record<string, string | undefined>> {
		const out: Record<string, string | undefined> = { ...env };
		for (const name of names) {
			if (!secretView().has(name)) continue;
			const value = await secrets.get(name);
			if (value !== null) out[name] = value;
		}
		return out;
	}

	async function expandServers(
		servers: Record<string, McpServer>,
	): Promise<McpExpansion> {
		const names = Object.values(servers).flatMap(referencedVariables);
		const expansion = expandMcpServers(servers, await envFor(names));
		if (expansion.ok) recordUse(names);
		return expansion;
	}

	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		names: () => new Set(connectionView().keys()),
		list: () =>
			[...connectionView().values()]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(withVariables),
		get(name) {
			const found = connectionView().get(name);
			return found ? withVariables(found) : null;
		},
		async save(input) {
			const parsed = connectionInputSchema.parse(input);
			const saved = {
				name: parsed.name,
				description: parsed.description || null,
				server: parsed.server,
				updatedAt: Date.now(),
			};
			await document.change(() => {
				document.connections.set(parsed.name, {
					description: saved.description,
					server: saved.server,
					updatedAt: saved.updatedAt,
				});
			});
			return withVariables(saved);
		},
		async remove(name) {
			await document.change(() => {
				document.connections.delete(name);
			});
		},
		secrets(named = []) {
			const usedBy = new Map<string, string[]>();
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) {
					usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
				}
			}
			const saved = secretView();
			const used = usedView();
			const names = new Set([...usedBy.keys(), ...saved.keys(), ...named]);
			return [...names].sort().map((name) => ({
				name,
				saved: saved.has(name),
				inEnv: env[name] !== undefined,
				usedBy: usedBy.get(name) ?? [],
				setAt: saved.get(name) ?? null,
				usedAt: used.get(name) ?? null,
			}));
		},
		async secret(name) {
			const value = (await envFor([name]))[name];
			if (value !== undefined) recordUse([name]);
			return value;
		},
		secretSource: source,
		async setSecret(name, value) {
			secretNameSchema.parse(name);
			if (value === "") throw new Refusal("invalid", "A secret needs a value.");
			await secrets.set(name, value);
			await writeSecrets(new Map(secretView()).set(name, now()));
		},
		async removeSecret(name) {
			await secrets.delete(name);
			const saved = new Map(secretView());
			saved.delete(name);
			await writeSecrets(saved, name);
		},
		async mcpServersFor(node) {
			const servers: Record<string, McpServer> = {};
			for (const name of node.connections ?? []) {
				const found = connectionView().get(name);
				if (!found) {
					return {
						ok: false,
						message: `There is no connection named "${name}". Add it under Agents → Tools, or remove it from the node.`,
					};
				}
				servers[name] = found.server;
			}
			return expandServers(servers);
		},
		async expandForTest(target) {
			const server =
				"server" in target
					? mcpServerSchema.parse(target.server)
					: connectionView().get(target.name)?.server;
			const name = "name" in target ? target.name : "draft";
			if (!server) {
				return {
					expansion: {
						ok: false,
						message: `There is no connection named "${name}".`,
					},
					values: [],
				};
			}
			const variables = referencedVariables(server);
			const vars = await envFor(variables);
			const expansion = expandMcpServers({ [name]: server }, vars);
			// A test connects to the server with the values: a use.
			if (expansion.ok) recordUse(variables);
			return {
				expansion,
				values: variables.flatMap((v) => (vars[v] ? [vars[v]] : [])),
			};
		},
		async expandEnv(values) {
			const names = new Set<string>();
			for (const value of Object.values(values)) {
				for (const match of value.matchAll(REFERENCE)) {
					if (match[1]) names.add(match[1]);
				}
			}
			const vars = await envFor(names);
			const missing = [...names].filter((name) => vars[name] === undefined);
			if (missing.length > 0) return { ok: false, missing };
			recordUse(names);
			return {
				ok: true,
				env: Object.fromEntries(
					Object.entries(values).map(([key, value]) => [
						key,
						value.replace(REFERENCE, (_, name: string) => vars[name] ?? ""),
					]),
				),
			};
		},
		async secretEnv(names) {
			const vars = await envFor(names);
			const env: Record<string, string> = {};
			const missing: string[] = [];
			for (const name of new Set(names)) {
				const value = vars[name];
				if (value === undefined) missing.push(name);
				else env[name] = value;
			}
			if (missing.length > 0) return { ok: false, missing };
			recordUse(names);
			return { ok: true, env };
		},
		async secretValues() {
			const names = new Set(secretView().keys());
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) names.add(name);
			}
			const vars = await envFor(names);
			return [...names].flatMap((name) => (vars[name] ? [vars[name]] : []));
		},
	};
}
