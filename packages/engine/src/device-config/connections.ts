import { join } from "node:path";
import {
	type AgentNode,
	type McpServer,
	mcpServerSchema,
	nameSchema,
	secretNameSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device-document";
import { type KeyStoreKind, keychainValues, valueStore } from "./keychain";
import { expandMcpServers, type McpExpansion } from "./mcp";

/**
 * Connections: MCP servers defined once in this Device's document, named
 * by Agent nodes. Secrets stay `${NAME}` references. A reference reads the
 * system keychain first (a secret saved on the Connections page), then the
 * daemon's environment. Values never reach the database, the document, the
 * log or the UI: the document holds the names of the saved secrets only.
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
};

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
	secrets(): SecretView[];
	/** A secret's value: the keychain, then the daemon's environment. */
	secret(name: string): Promise<string | undefined>;
	/** Where a secret's value comes from. */
	secretSource(name: string): SecretSource;
	setSecret(name: string, value: string): Promise<void>;
	removeSecret(name: string): Promise<void>;
	/** An Agent node's MCP servers: its connections, then its own, with `${NAME}` expanded. */
	mcpServersFor(
		node: Pick<AgentNode, "connections" | "mcpServers">,
	): Promise<McpExpansion>;
	/**
	 * One server, expanded, for a test: a saved connection by name, or a draft.
	 * `values` are the secret values it read, to take out of error text.
	 */
	expandForTest(
		target: { name: string } | { server: McpServer },
	): Promise<{ expansion: McpExpansion; values: string[] }>;
	/**
	 * The values of the saved secrets and of the variables the connections
	 * reference, to take out of an exported run.
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

export function createConnectionStore(options: {
	document: DeviceDocument;
	env: Readonly<Record<string, string | undefined>>;
	secrets: SecretBackend;
}): ConnectionStore {
	const { document, env, secrets } = options;
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
	/** The secret names are a Device fact: the keychain cannot list them. */
	const secretView = mapView(document, document.facts, () => {
		const names = z.array(z.string()).safeParse(document.facts.get("secrets"));
		return new Set(names.success ? names.data : []);
	});
	function writeSecretNames(names: Set<string>): Promise<void> {
		return document.change(() => {
			document.facts.set("secrets", [...names].sort());
		});
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
		return expandMcpServers(servers, await envFor(names));
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
		secrets() {
			const usedBy = new Map<string, string[]>();
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) {
					usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
				}
			}
			const names = new Set([...usedBy.keys(), ...secretView()]);
			return [...names].sort().map((name) => ({
				name,
				saved: secretView().has(name),
				inEnv: env[name] !== undefined,
				usedBy: usedBy.get(name) ?? [],
			}));
		},
		async secret(name) {
			return (await envFor([name]))[name];
		},
		secretSource: source,
		async setSecret(name, value) {
			secretNameSchema.parse(name);
			if (value === "") throw new Error("A secret needs a value.");
			await secrets.set(name, value);
			await writeSecretNames(new Set([...secretView(), name]));
		},
		async removeSecret(name) {
			await secrets.delete(name);
			const names = new Set(secretView());
			names.delete(name);
			await writeSecretNames(names);
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
			// A server the node defines itself wins over a connection of the same name.
			return expandServers({ ...servers, ...(node.mcpServers ?? {}) });
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
			return {
				expansion: expandMcpServers({ [name]: server }, vars),
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
			return missing.length > 0 ? { ok: false, missing } : { ok: true, env };
		},
		async secretValues() {
			const names = new Set(secretView());
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) names.add(name);
			}
			const vars = await envFor(names);
			return [...names].flatMap((name) => (vars[name] ? [vars[name]] : []));
		},
	};
}
