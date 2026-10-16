import type { Database } from "@nightshift/db";
import { connection, secret } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type McpServer,
	mcpServerSchema,
	nameSchema,
} from "@nightshift/flows";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { expandMcpServers, type McpExpansion } from "./mcp";

/**
 * Connections: MCP servers defined once on this daemon, named by Agent nodes.
 * Secrets stay `${NAME}` references. A reference reads the system keychain
 * first (a secret saved on the Connections page), then the daemon's
 * environment. Values never reach the database, the log or the UI.
 */

/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const secretNameSchema = z
	.string()
	.regex(
		/^[A-Za-z_][A-Za-z0-9_]{0,127}$/,
		"Use letters, digits and _, starting with a letter or _.",
	);

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

/** Where secret values live. The default is the macOS keychain through `Bun.secrets`. */
export type SecretBackend = {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
};

export function keychainSecrets(service = "nightshift"): SecretBackend {
	return {
		get: (name) => Bun.secrets.get({ service, name }),
		set: (name, value) => Bun.secrets.set({ service, name, value }),
		delete: async (name) => {
			await Bun.secrets.delete({ service, name });
		},
	};
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
};

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

export function createConnectionStore(options: {
	db: Database;
	env: Readonly<Record<string, string | undefined>>;
	secrets: SecretBackend;
}): ConnectionStore {
	const { db, env, secrets } = options;
	const connections = new Map<string, Omit<Connection, "variables">>();
	const savedSecrets = new Set<string>();

	function source(variable: string): SecretSource {
		if (savedSecrets.has(variable)) return "keychain";
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
			if (!savedSecrets.has(name)) continue;
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
		async load() {
			connections.clear();
			savedSecrets.clear();
			for (const row of await db.select().from(connection)) {
				const parsed = mcpServerSchema.safeParse(safeJson(row.server));
				if (!parsed.success) continue;
				connections.set(row.name, {
					name: row.name,
					description: row.description,
					server: parsed.data,
					updatedAt: row.updatedAt.getTime(),
				});
			}
			for (const row of await db.select({ name: secret.name }).from(secret)) {
				savedSecrets.add(row.name);
			}
		},
		names: () => new Set(connections.keys()),
		list: () =>
			[...connections.values()]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(withVariables),
		get(name) {
			const found = connections.get(name);
			return found ? withVariables(found) : null;
		},
		async save(input) {
			const parsed = connectionInputSchema.parse(input);
			const description = parsed.description || null;
			const server = JSON.stringify(parsed.server);
			const [row] = await db
				.insert(connection)
				.values({ name: parsed.name, description, server })
				.onConflictDoUpdate({
					target: connection.name,
					set: {
						description,
						server,
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				})
				.returning();
			const saved = {
				name: parsed.name,
				description,
				server: parsed.server,
				updatedAt: row?.updatedAt.getTime() ?? Date.now(),
			};
			connections.set(parsed.name, saved);
			return withVariables(saved);
		},
		async remove(name) {
			await db.delete(connection).where(eq(connection.name, name));
			connections.delete(name);
		},
		secrets() {
			const usedBy = new Map<string, string[]>();
			for (const c of connections.values()) {
				for (const name of referencedVariables(c.server)) {
					usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
				}
			}
			const names = new Set([...usedBy.keys(), ...savedSecrets]);
			return [...names].sort().map((name) => ({
				name,
				saved: savedSecrets.has(name),
				inEnv: env[name] !== undefined,
				usedBy: usedBy.get(name) ?? [],
			}));
		},
		async setSecret(name, value) {
			secretNameSchema.parse(name);
			if (value === "") throw new Error("A secret needs a value.");
			await secrets.set(name, value);
			await db
				.insert(secret)
				.values({ name })
				.onConflictDoUpdate({
					target: secret.name,
					set: {
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				});
			savedSecrets.add(name);
		},
		async removeSecret(name) {
			await secrets.delete(name);
			await db.delete(secret).where(eq(secret.name, name));
			savedSecrets.delete(name);
		},
		async mcpServersFor(node) {
			const servers: Record<string, McpServer> = {};
			for (const name of node.connections ?? []) {
				const found = connections.get(name);
				if (!found) {
					return {
						ok: false,
						message: `The connection "${name}" does not exist on this daemon. Add it under Connections, or remove it from the node.`,
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
					: connections.get(target.name)?.server;
			const name = "name" in target ? target.name : "draft";
			if (!server) {
				return {
					expansion: {
						ok: false,
						message: `The connection "${name}" does not exist on this daemon.`,
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
		async secretValues() {
			const names = new Set(savedSecrets);
			for (const c of connections.values()) {
				for (const name of referencedVariables(c.server)) names.add(name);
			}
			const vars = await envFor(names);
			return [...names].flatMap((name) => (vars[name] ? [vars[name]] : []));
		},
	};
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
