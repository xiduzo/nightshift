import {
	type AgentNode,
	type McpServer,
	mcpServerSchema,
	nameSchema,
} from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import { z } from "zod";
import {
	NIGHT_SHIFT,
	type ProjectRef,
	type SecretEnv,
	type SecretUse,
} from "../contract";
import { type DeviceDocument, mapView } from "../documents";
import {
	type ComputerSecrets,
	type ExpandedEnv,
	notRead,
	type PersonalSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	referencesIn,
	type SecretList,
	type SecretScope,
	type SecretSource,
	unreachableNote,
	wireSecrets,
} from "../secrets";
import { expandMcpServers, type McpExpansion } from "./mcp";

export type { SecretEnv } from "../contract";
export type { ExpandedEnv, PersonalSecrets, ProjectSecrets } from "../secrets";
export { unreachableNote } from "../secrets";

/**
 * Connections: MCP servers defined once in this Device's document, named
 * by Agent nodes. Secrets stay `${NAME}` references. A reference reads
 * the scopes the Secret scope rule gives its use (`secretScopes`): the
 * Person's Personal secrets (their Home Host, or this computer when it has
 * none), the run's Space's and Project's (the Host that keeps the Space
 * keeps them, or this computer when it keeps the Space itself), the system
 * keychain (a secret saved for this computer on the Secrets page), then
 * the daemon's environment.
 *
 * Values never reach the database, the document, the log or the UI: the
 * document holds the names of this computer's saved secrets only, with
 * when each was last set and last used. A Personal or Project value is
 * read for one use and kept in memory for that use only.
 */

export const connectionInputSchema = z.object({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
	server: mcpServerSchema,
});
export type ConnectionInput = z.input<typeof connectionInputSchema>;

export type Connection = {
	name: string;
	description: string | null;
	server: McpServer;
	/** The `${NAME}` references in its env values and headers. */
	variables: { name: string; source: SecretSource }[];
	updatedAt: number;
};

/** Where the values of this computer's saved secrets live (`secretStore` of `key-store`). */
export type SecretBackend = ComputerSecrets;

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
	 * The secrets: the Personal ones, this computer's saved ones and the
	 * ones connections reference, and `named` (a Command node's), with
	 * where each is set and when. A name saved in both scopes is listed
	 * once per scope, Personal first.
	 */
	secrets(named?: Iterable<string>): Promise<SecretList>;
	/** A secret's value, to use: the scopes of `use` in their order (`secretScopes`). */
	secret(name: string, use?: SecretUse): Promise<string | undefined>;
	/**
	 * A webhook's secret: the Project's when this computer keeps it, then as
	 * `secret`. No step asks for it, so no value comes from another Host.
	 * Undefined while the Project's secrets cannot be read here.
	 */
	webhookSecret(name: string, project: ProjectRef): Promise<string | undefined>;
	/** Where a secret's value comes from, as this computer knows the Personal names now. */
	secretSource(name: string): SecretSource;
	/** Saves a value in a scope. Default: this computer. */
	setSecret(name: string, value: string, scope?: SecretScope): Promise<void>;
	/** Removes the saved value of a scope. Default: this computer. */
	removeSecret(name: string, scope?: SecretScope): Promise<void>;
	/**
	 * Moves a saved secret to another scope, and the person never types it
	 * again (ADR 13, decision 7): it reads the value where it is, saves it
	 * in `to`, then removes the copy it moved from. Refuses when the scope
	 * it moves from has no value of that name.
	 */
	moveSecret(name: string, to: SecretScope): Promise<void>;
	/**
	 * The secrets of a Project, as `personId` may see them: names, when
	 * each was set and by whom. Throws when they cannot be read now.
	 */
	projectSecrets(
		project: ProjectRef,
		personId: string,
	): Promise<ProjectSecretName[]>;
	/** Saves or replaces a Project secret, as `personId`. */
	setProjectSecret(
		project: ProjectRef,
		name: string,
		value: string,
		personId: string,
	): Promise<void>;
	removeProjectSecret(
		project: ProjectRef,
		name: string,
		personId: string,
	): Promise<void>;
	/**
	 * Moves a saved secret of this computer, or a Personal one, into the
	 * Project (ADR 13, decision 7): it reads the value where it is, saves it
	 * as the Project's, then removes the copy it moved from.
	 */
	/** The secrets of a Space (ADR 18): as `projectSecrets`, for the whole Space. */
	spaceSecrets(spaceId: string, personId: string): Promise<ProjectSecretName[]>;
	setSpaceSecret(
		spaceId: string,
		name: string,
		value: string,
		personId: string,
	): Promise<void>;
	removeSpaceSecret(
		spaceId: string,
		name: string,
		personId: string,
	): Promise<void>;
	/** Moves a saved secret of this computer, or a Personal one, into a Space. */
	moveToSpace(
		name: string,
		from: SecretScope,
		spaceId: string,
		personId: string,
	): Promise<void>;
	/** Moves a Space's secret to this computer, or to its owner's Personal secrets. */
	moveFromSpace(
		spaceId: string,
		name: string,
		to: SecretScope,
		personId: string,
	): Promise<void>;
	moveToProject(
		name: string,
		from: SecretScope,
		project: ProjectRef,
		personId: string,
	): Promise<void>;
	/**
	 * Moves a Project secret to this computer or to the Person's Personal
	 * secrets. The Project's copy goes only after the new one is saved.
	 */
	moveFromProject(
		project: ProjectRef,
		name: string,
		to: SecretScope,
		personId: string,
	): Promise<void>;
	/** An Agent node's MCP servers: its connections, with `${NAME}` expanded. */
	mcpServersFor(
		node: Pick<AgentNode, "connections">,
		use?: SecretUse,
	): Promise<McpExpansion>;
	/**
	 * One server, expanded, for a test: a saved connection by name, or a draft.
	 * `values` are the secret values it read, to take out of error text.
	 */
	expandForTest(
		target: { name: string } | { server: McpServer },
	): Promise<{ expansion: McpExpansion; values: string[] }>;
	/**
	 * The values of the saved secrets (the Personal ones when `use` reads
	 * them, and every secret of its run's Space and Project) and of the
	 * variables the connections reference, to take out of a session's
	 * output. Not a use. Values that cannot be read now are left out.
	 */
	secretValues(use?: SecretUse): Promise<string[]>;
	/**
	 * What an exported run of the Project takes out: `secretValues`, and
	 * the Project's values when this computer keeps them. Where another
	 * Host keeps them, the steps' output has them as `•••` already.
	 */
	exportValues(project: ProjectRef): Promise<string[]>;
	/**
	 * Environment values with `${NAME}` expanded from the secrets, then the
	 * daemon's environment: a custom agent's env. `missing` names the
	 * references with no value; then nothing is expanded.
	 */
	expandEnv(
		values: Record<string, string>,
		use?: SecretUse,
	): Promise<ExpandedEnv>;
	/**
	 * Calls `listener` after a secret is saved, moved or removed, here or
	 * synced. Returns the unsubscribe.
	 */
	onSecretsChange(listener: () => void): () => void;
	/**
	 * Secrets by name, each as an environment variable of that name, from
	 * the scopes of `use`. A Command node's `secrets`. `missing` names the
	 * ones with no value; then `env` is not given.
	 */
	secretEnv(names: readonly string[], use?: SecretUse): Promise<SecretEnv>;
};

/** The `${NAME}` references of a server's env values and headers. */
export function referencedVariables(server: McpServer): string[] {
	return referencesIn(
		Object.values(
			"command" in server ? (server.env ?? {}) : (server.headers ?? {}),
		),
	);
}

/** A connection as the Device document holds it. */
const entrySchema = z.object({
	description: z.string().nullable(),
	server: z.unknown(),
	updatedAt: z.number(),
});

/**
 * The connections over this computer's Device document, and the secrets
 * as the use cases of `secrets` give them (`wireSecrets`). The secret
 * members only call a bound use case. The doors check the owner of this
 * computer first, so the store acts as Night Shift.
 */
export function createConnectionStore(options: {
	document: DeviceDocument;
	env: Readonly<Record<string, string | undefined>>;
	secrets: SecretBackend;
	/**
	 * The Person's Personal secrets, read at each use. Null: not reachable
	 * yet (the daemon starts the devices after the stores). Without it,
	 * this computer has no Personal scope.
	 */
	personal?: () => PersonalSecrets | null;
	/** "Be a Host" is on here now: the Secret scope rule reads it. Default: no. */
	host?: () => boolean;
	/**
	 * The secrets of the Projects, read at each use. Null: not reachable
	 * yet. Without it, this computer has no Project scope.
	 */
	projects?: () => ProjectSecrets | null;
	/** The clock for the set and use times. */
	now?: () => number;
}): ConnectionStore {
	const { document } = options;
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
	const secrets = wireSecrets({
		document,
		env: options.env,
		computer: options.secrets,
		references: {
			usedBy() {
				const usedBy = new Map<string, string[]>();
				for (const c of connectionView().values()) {
					for (const name of referencedVariables(c.server)) {
						usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
					}
				}
				return usedBy;
			},
		},
		...(options.personal ? { personal: options.personal } : {}),
		...(options.projects ? { projects: options.projects } : {}),
		...(options.host ? { host: options.host } : {}),
		...(options.now ? { now: options.now } : {}),
	});
	const as = NIGHT_SHIFT;

	function withVariables(c: Omit<Connection, "variables">): Connection {
		return {
			...c,
			variables: referencedVariables(c.server).map((name) => ({
				name,
				source: secrets.secretSource(name),
			})),
		};
	}

	async function expandServers(
		servers: Record<string, McpServer>,
		use?: SecretUse,
	): Promise<McpExpansion> {
		const names = Object.values(servers).flatMap(referencedVariables);
		const resolved = await secrets.resolveSecrets({ names, use });
		const expansion = expandMcpServers(servers, resolved.vars);
		if (expansion.ok) secrets.noteSecretUse(names);
		else {
			const note = unreachableNote(notRead(resolved));
			if (note) return { ...expansion, message: `${expansion.message}${note}` };
		}
		return expansion;
	}

	return {
		// The document is read when it opens; a remote edit applies at once.
		// The Personal names are read at their first use.
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
				updatedAt: timeNow(),
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
		secrets: (named = []) => secrets.listSecrets(as, { named }),
		secret: (name, use) => secrets.readSecret({ name, use }),
		webhookSecret: (name, project) =>
			secrets.readWebhookSecret({ name, project }),
		secretSource: secrets.secretSource,
		setSecret: (name, value, scope) =>
			secrets.saveSecret(as, { name, value, scope }),
		removeSecret: (name, scope) => secrets.removeSecret(as, { name, scope }),
		moveSecret: (name, to) => secrets.moveSecret(as, { name, to }),
		projectSecrets: (project, personId) =>
			secrets.listProjectSecrets(as, { project, personId }),
		setProjectSecret: (project, name, value, personId) =>
			secrets.saveProjectSecret(as, { project, name, value, personId }),
		removeProjectSecret: (project, name, personId) =>
			secrets.removeProjectSecret(as, { project, name, personId }),
		moveToProject: (name, from, project, personId) =>
			secrets.moveSecretToProject(as, { name, from, project, personId }),
		moveFromProject: (project, name, to, personId) =>
			secrets.moveSecretFromProject(as, { project, name, to, personId }),
		spaceSecrets: (spaceId, personId) =>
			secrets.listSpaceSecrets(as, { spaceId, personId }),
		setSpaceSecret: (spaceId, name, value, personId) =>
			secrets.saveSpaceSecret(as, { spaceId, name, value, personId }),
		removeSpaceSecret: (spaceId, name, personId) =>
			secrets.removeSpaceSecret(as, { spaceId, name, personId }),
		moveToSpace: (name, from, spaceId, personId) =>
			secrets.moveSecretToSpace(as, { name, from, spaceId, personId }),
		moveFromSpace: (spaceId, name, to, personId) =>
			secrets.moveSecretFromSpace(as, { spaceId, name, to, personId }),
		async mcpServersFor(node, use) {
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
			return expandServers(servers, use);
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
			const resolved = await secrets.resolveSecrets({ names: variables });
			const { vars } = resolved;
			const expansion = expandMcpServers({ [name]: server }, vars);
			// A test connects to the server with the values: a use.
			if (expansion.ok) secrets.noteSecretUse(variables);
			const note = expansion.ok ? "" : unreachableNote(notRead(resolved));
			return {
				expansion:
					!expansion.ok && note
						? { ...expansion, message: `${expansion.message}${note}` }
						: expansion,
				values: variables.flatMap((v) => (vars[v] ? [vars[v]] : [])),
			};
		},
		expandEnv: (values, use) => secrets.expandSecretReferences({ values, use }),
		secretEnv: (names, use) => secrets.readSecretEnv({ names, use }),
		onSecretsChange: (listener) => secrets.onSecretsChange(listener),
		secretValues: (use) => secrets.listSecretValues({ use }),
		exportValues: (project) => secrets.listExportValues({ project }),
	};
}
