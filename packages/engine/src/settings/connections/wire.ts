import type { AgentNode, McpServer } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import {
	NIGHT_SHIFT,
	type ProjectRef,
	type SecretEnv,
	type SecretUse,
} from "../../contract";
import type { DeviceDocument } from "../../documents";
import {
	type ComputerSecrets,
	type ExpandedEnv,
	type PersonalSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	type SecretList,
	type SecretScope,
	type SecretSource,
	wireSecrets,
} from "../../secrets";
import { yjsSavedConnections } from "./adapters/out/yjs-saved-connections";
import { expandConnectionForTest } from "./application/expand-connection-for-test";
import { expandConnections } from "./application/expand-connections";
import {
	type Connection,
	writeConnection,
} from "./application/write-connection";
import type { McpExpansion } from "./domain/mcp-expansion";
import {
	type ConnectionInput,
	referencesByName,
	withVariables,
} from "./domain/saved-connection";

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

type Secrets = ReturnType<typeof wireSecrets>;

/** What a person asks of the secrets: each a use case that takes who asks. */
export type SecretEdits = Pick<
	Secrets,
	| "listSecrets"
	| "saveSecret"
	| "removeSecret"
	| "moveSecret"
	| "saveProjectSecret"
	| "removeProjectSecret"
	| "moveSecretToProject"
	| "moveSecretFromProject"
	| "saveSpaceSecret"
	| "removeSpaceSecret"
	| "moveSecretToSpace"
	| "moveSecretFromSpace"
>;

/** The connections and the secrets, and the use cases of a person's doors. */
export type Connections = ConnectionStore & {
	expandConnectionForTest: ReturnType<typeof expandConnectionForTest>;
	secretEdits: SecretEdits;
};

/**
 * The connections over this computer's Device document, and the secrets
 * as the use cases of `secrets` give them (`wireSecrets`). The members of
 * the store only call a bound use case. The doors check the owner of this
 * computer first, so the store acts as Night Shift.
 */
export function wireConnections(options: {
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
}): Connections {
	const { document } = options;
	const saved = yjsSavedConnections(document);
	const secrets = wireSecrets({
		document,
		env: options.env,
		computer: options.secrets,
		references: { usedBy: () => referencesByName(saved.read().values()) },
		...(options.personal ? { personal: options.personal } : {}),
		...(options.projects ? { projects: options.projects } : {}),
		...(options.host ? { host: options.host } : {}),
		...(options.now ? { now: options.now } : {}),
	});
	const write = writeConnection({ saved, secrets, now: timeNow });
	const expand = expandConnections({ saved, secrets });
	const expandForTest = expandConnectionForTest({ saved, secrets });
	const view = (name: string) => {
		const found = saved.read().get(name);
		return found ? withVariables(found, secrets.secretSource) : null;
	};
	const as = NIGHT_SHIFT;
	return {
		// The document is read when it opens; a remote edit applies at once.
		// The Personal names are read at their first use.
		async load() {},
		names: () => new Set(saved.read().keys()),
		list: () =>
			[...saved.read().values()]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((c) => withVariables(c, secrets.secretSource)),
		get: view,
		save: write,
		remove: (name) => saved.remove(name),
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
		mcpServersFor: (node, use) => expand({ node, use }),
		expandForTest,
		expandEnv: (values, use) => secrets.expandSecretReferences({ values, use }),
		secretEnv: (names, use) => secrets.readSecretEnv({ names, use }),
		onSecretsChange: (listener) => secrets.onSecretsChange(listener),
		secretValues: (use) => secrets.listSecretValues({ use }),
		exportValues: (project) => secrets.listExportValues({ project }),
		expandConnectionForTest: expandForTest,
		secretEdits: {
			listSecrets: secrets.listSecrets,
			saveSecret: secrets.saveSecret,
			removeSecret: secrets.removeSecret,
			moveSecret: secrets.moveSecret,
			saveProjectSecret: secrets.saveProjectSecret,
			removeProjectSecret: secrets.removeProjectSecret,
			moveSecretToProject: secrets.moveSecretToProject,
			moveSecretFromProject: secrets.moveSecretFromProject,
			saveSpaceSecret: secrets.saveSpaceSecret,
			removeSpaceSecret: secrets.removeSpaceSecret,
			moveSecretToSpace: secrets.moveSecretToSpace,
			moveSecretFromSpace: secrets.moveSecretFromSpace,
		},
	};
}
