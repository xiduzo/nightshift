import { join } from "node:path";
import {
	type AgentNode,
	type McpServer,
	mcpServerSchema,
	nameSchema,
	secretNameSchema,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import { z } from "zod";
import { type DeviceDocument, mapView } from "./device-document";
import { type KeyStoreKind, keychainValues, valueStore } from "./keychain";
import { expandMcpServers, type McpExpansion } from "./mcp";

/**
 * Connections: MCP servers defined once in this Device's document, named
 * by Agent nodes. Secrets stay `${NAME}` references. A reference reads the
 * Person's Personal secrets first (ADR 13: their Home Host keeps them, or
 * this computer when it has none), then the system keychain (a secret saved
 * for this computer on the Secrets page), then the daemon's environment.
 * The Project scope comes in a later slice, before Personal.
 *
 * Values never reach the database, the document, the log or the UI: the
 * document holds the names of this computer's saved secrets only, with
 * when each was last set and last used. A Personal value is read for one
 * use and kept in memory for that use only.
 */

/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const connectionInputSchema = z.object({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
	server: mcpServerSchema,
});
export type ConnectionInput = z.input<typeof connectionInputSchema>;

/**
 * Where a `${NAME}` gets its value: a Personal secret, this computer's
 * keychain, the environment, or nowhere. "personal" is as this computer
 * last read the Person's list: names, never values.
 */
export type SecretSource = "personal" | "keychain" | "env" | "missing";

/**
 * Where a saved secret lives (ADR 13). "computer": this computer's keychain
 * only. "personal": the Person's, for their steps on each of their
 * computers.
 */
export type SecretScope = "computer" | "personal";

/**
 * Which scopes one use may read. `personal: false`: only this computer's
 * secrets and the environment, as for a session of another Person's run
 * under an Offer (ADR 13, decision 5). Default: every scope.
 */
export type SecretUse = { personal?: boolean };

/**
 * The Person's Personal secrets, as this computer reaches them: its Home
 * Host keeps them, or this computer when it has none (`@nightshift/devices`
 * implements it). Names with when each was set, and values only for a use.
 * Each call throws when they cannot be reached now.
 */
export type PersonalSecrets = {
	list(): Promise<{ name: string; setAt: number }[]>;
	/** The values of these names that are Personal secrets. A name that is none is left out. */
	values(names: readonly string[]): Promise<Record<string, string>>;
	set(name: string, value: string): Promise<void>;
	remove(name: string): Promise<void>;
};

/** What a person reads when a use needs Personal secrets that cannot be read now. */
export const PERSONAL_UNREACHABLE =
	"Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.";

/** The sentence a missing-secret message ends with when the Personal secrets could not be read. */
export function unreachableNote(found: { unreachable?: boolean }): string {
	return found.unreachable ? ` ${PERSONAL_UNREACHABLE}` : "";
}

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
	/**
	 * Where its saved value lives. A name that is saved nowhere (only the
	 * environment has it, or nothing) is "computer".
	 */
	scope: SecretScope;
	/** Saved in its scope: this computer's keychain, or the Person's Personal secrets. */
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

/**
 * The secrets as the Secrets page lists them. `personal`: whether this
 * computer could read the Person's Personal secret names now. When it
 * could not, the list has this computer's secrets only.
 */
export type SecretList = {
	secrets: SecretView[];
	personal: "available" | "unavailable";
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
	 * The secrets: the Personal ones, this computer's saved ones and the
	 * ones connections reference, and `named` (a Command node's), with
	 * where each is set and when. A name saved in both scopes is listed
	 * once per scope, Personal first.
	 */
	secrets(named?: Iterable<string>): Promise<SecretList>;
	/** A secret's value, to use: Personal, then the keychain, then the daemon's environment. */
	secret(name: string): Promise<string | undefined>;
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
	 * The values of the saved secrets (the Personal ones too) and of the
	 * variables the connections reference, to take out of a session's
	 * output and an exported run. Not a use. Personal values that cannot be
	 * read now are left out.
	 */
	secretValues(use?: SecretUse): Promise<string[]>;
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
	 * Secrets by name, each as an environment variable of that name:
	 * Personal, then the keychain, then the daemon's environment. A Command
	 * node's `secrets`. `missing` names the ones with no value; then `env`
	 * is not given.
	 */
	secretEnv(names: readonly string[], use?: SecretUse): Promise<SecretEnv>;
};

/**
 * Environment values read from the secrets, or the names that have no
 * value. `unreachable`: the Personal secrets could not be read now, so a
 * missing name may be one of them (`PERSONAL_UNREACHABLE`).
 */
export type SecretEnv =
	| { ok: true; env: Record<string, string> }
	| { ok: false; missing: string[]; unreachable?: boolean };

/** Values with `${NAME}` expanded, and the values read for them, or the names that have none. */
export type ExpandedEnv =
	| { ok: true; env: Record<string, string>; values: string[] }
	| { ok: false; missing: string[]; unreachable?: boolean };

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

/** A saved secret as the document's facts hold it: an older document holds bare names. */
export const savedSecretSchema = z.union([
	z.string().transform((name) => ({ name, setAt: null })),
	z.object({ name: z.string(), setAt: z.number().nullable() }),
]);

/** The values read for a use, and whether the Personal secrets could not be read. */
type Resolved = {
	vars: Record<string, string | undefined>;
	unreachable: boolean;
};

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
	/** The clock for the set and use times. */
	now?: () => number;
}): ConnectionStore {
	const { document, env, secrets, now = timeNow } = options;
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
	/**
	 * The Personal secret names as this computer last read them, with when
	 * each was set: names only, for `secretSource` and to fail closed on a
	 * name that is Personal while the Personal secrets cannot be read.
	 */
	const personalNames = new Map<string, number>();
	/** Listeners of a Personal change made here: the Device document tells the others. */
	const personalListeners = new Set<() => void>();
	const personalChanged = () => {
		for (const listener of personalListeners) listener();
	};

	/** The Personal secrets now, or a refusal that says they cannot be read. */
	function personalPort(): PersonalSecrets {
		const port = options.personal?.() ?? null;
		if (!port) throw new Refusal("unavailable", PERSONAL_UNREACHABLE);
		return port;
	}
	const hasPersonal = () => options.personal !== undefined;
	/**
	 * Logs why the Personal secrets could not be read, once until the
	 * reason changes: an older or offline Home Host would log every use.
	 */
	let lastWarning = "";
	function warnOnce(what: "listed" | "read", error: unknown): void {
		const reason = `${what}: ${error instanceof Error ? error.message : String(error)}`;
		if (reason === lastWarning) return;
		lastWarning = reason;
		console.warn(`[secrets] the Personal secrets were not ${what}:`, error);
	}

	async function listPersonal(): Promise<
		{ name: string; setAt: number }[] | null
	> {
		if (!hasPersonal()) return [];
		try {
			const listed = await personalPort().list();
			lastWarning = "";
			personalNames.clear();
			for (const { name, setAt } of listed) personalNames.set(name, setAt);
			return listed;
		} catch (error) {
			warnOnce("listed", error);
			return null;
		}
	}

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
		if (personalNames.has(variable)) return "personal";
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

	/**
	 * The values of `names` for one use, the most specific scope first:
	 * Personal (when `use` allows it), this computer's keychain, the
	 * daemon's environment. A Project scope goes before Personal here.
	 *
	 * Fails closed: when the Personal secrets cannot be read, a name this
	 * computer last knew as Personal has no value, rather than a value of a
	 * wider scope. Other names still read this computer and the environment.
	 */
	async function resolve(
		names: Iterable<string>,
		use: SecretUse = {},
	): Promise<Resolved> {
		const wanted = [...new Set(names)];
		const vars: Record<string, string | undefined> = { ...env };
		for (const name of wanted) {
			if (!secretView().has(name)) continue;
			const value = await secrets.get(name);
			if (value !== null) vars[name] = value;
		}
		let unreachable = false;
		if (use.personal !== false && hasPersonal() && wanted.length > 0) {
			try {
				const found = await personalPort().values(wanted);
				lastWarning = "";
				for (const name of wanted) {
					const value = found[name];
					if (value === undefined) personalNames.delete(name);
					else {
						vars[name] = value;
						if (!personalNames.has(name)) personalNames.set(name, 0);
					}
				}
			} catch (error) {
				unreachable = true;
				warnOnce("read", error);
				for (const name of wanted) {
					if (personalNames.has(name)) delete vars[name];
				}
			}
		}
		return { vars, unreachable };
	}

	async function expandServers(
		servers: Record<string, McpServer>,
		use?: SecretUse,
	): Promise<McpExpansion> {
		const names = Object.values(servers).flatMap(referencedVariables);
		const { vars, unreachable } = await resolve(names, use);
		const expansion = expandMcpServers(servers, vars);
		if (expansion.ok) recordUse(names);
		else if (unreachable) {
			return {
				...expansion,
				message: `${expansion.message} ${PERSONAL_UNREACHABLE}`,
			};
		}
		return expansion;
	}

	/** Saves a value in this computer's keychain. */
	async function setHere(name: string, value: string): Promise<void> {
		await secrets.set(name, value);
		await writeSecrets(new Map(secretView()).set(name, now()));
	}
	/** Removes this computer's saved value. */
	async function removeHere(name: string): Promise<void> {
		await secrets.delete(name);
		const saved = new Map(secretView());
		saved.delete(name);
		await writeSecrets(saved, name);
	}
	async function setPersonal(name: string, value: string): Promise<void> {
		await personalPort().set(name, value);
		personalNames.set(name, now());
		personalChanged();
	}
	async function removePersonal(name: string): Promise<void> {
		await personalPort().remove(name);
		personalNames.delete(name);
		personalChanged();
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
		async secrets(named = []) {
			const personal = await listPersonal();
			const usedBy = new Map<string, string[]>();
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) {
					usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
				}
			}
			const saved = secretView();
			const used = usedView();
			const personalSet = new Map(
				(personal ?? []).map((p) => [p.name, p.setAt]),
			);
			const view = (name: string, scope: SecretScope): SecretView => ({
				name,
				scope,
				saved: scope === "personal" ? true : saved.has(name),
				inEnv: env[name] !== undefined,
				usedBy: usedBy.get(name) ?? [],
				setAt:
					scope === "personal"
						? (personalSet.get(name) ?? null)
						: (saved.get(name) ?? null),
				usedAt: used.get(name) ?? null,
			});
			const names = new Set([
				...personalSet.keys(),
				...usedBy.keys(),
				...saved.keys(),
				...named,
			]);
			const rows: SecretView[] = [];
			for (const name of [...names].sort()) {
				if (personalSet.has(name)) rows.push(view(name, "personal"));
				// A name only Personal has is listed once: as Personal.
				if (!personalSet.has(name) || saved.has(name)) {
					rows.push(view(name, "computer"));
				}
			}
			return {
				secrets: rows,
				personal: personal === null ? "unavailable" : "available",
			};
		},
		async secret(name) {
			const value = (await resolve([name])).vars[name];
			if (value !== undefined) recordUse([name]);
			return value;
		},
		secretSource: source,
		async setSecret(name, value, scope = "computer") {
			secretNameSchema.parse(name);
			if (value === "") throw new Refusal("invalid", "A secret needs a value.");
			if (scope === "personal") await setPersonal(name, value);
			else await setHere(name, value);
		},
		async removeSecret(name, scope = "computer") {
			if (scope === "personal") await removePersonal(name);
			else await removeHere(name);
		},
		async moveSecret(name, to) {
			secretNameSchema.parse(name);
			if (to === "personal") {
				const value = secretView().has(name) ? await secrets.get(name) : null;
				if (value === null) {
					throw new Refusal(
						"not-found",
						`This computer has no saved value of ${name}.`,
					);
				}
				// Saved in its new scope first: a failure there keeps this copy.
				await setPersonal(name, value);
				await removeHere(name);
				return;
			}
			const value = (await personalPort().values([name]))[name];
			if (value === undefined) {
				throw new Refusal("not-found", `${name} is not a Personal secret.`);
			}
			await setHere(name, value);
			await removePersonal(name);
		},
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
			const { vars, unreachable } = await resolve(variables);
			const expansion = expandMcpServers({ [name]: server }, vars);
			// A test connects to the server with the values: a use.
			if (expansion.ok) recordUse(variables);
			return {
				expansion:
					!expansion.ok && unreachable
						? {
								...expansion,
								message: `${expansion.message} ${PERSONAL_UNREACHABLE}`,
							}
						: expansion,
				values: variables.flatMap((v) => (vars[v] ? [vars[v]] : [])),
			};
		},
		async expandEnv(values, use) {
			const names = new Set<string>();
			for (const value of Object.values(values)) {
				for (const match of value.matchAll(REFERENCE)) {
					if (match[1]) names.add(match[1]);
				}
			}
			const { vars, unreachable } = await resolve(names, use);
			const missing = [...names].filter((name) => vars[name] === undefined);
			if (missing.length > 0) {
				return { ok: false, missing, ...(unreachable ? { unreachable } : {}) };
			}
			recordUse(names);
			return {
				ok: true,
				values: [...names].flatMap((name) => (vars[name] ? [vars[name]] : [])),
				env: Object.fromEntries(
					Object.entries(values).map(([key, value]) => [
						key,
						value.replace(REFERENCE, (_, name: string) => vars[name] ?? ""),
					]),
				),
			};
		},
		async secretEnv(names, use) {
			const { vars, unreachable } = await resolve(names, use);
			const env: Record<string, string> = {};
			const missing: string[] = [];
			for (const name of new Set(names)) {
				const value = vars[name];
				if (value === undefined) missing.push(name);
				else env[name] = value;
			}
			if (missing.length > 0) {
				return { ok: false, missing, ...(unreachable ? { unreachable } : {}) };
			}
			recordUse(names);
			return { ok: true, env };
		},
		onSecretsChange(listener) {
			const observer = (event: { keysChanged: Set<string> }) => {
				if (event.keysChanged.has("secrets")) listener();
			};
			document.facts.observe(observer);
			personalListeners.add(listener);
			return () => {
				document.facts.unobserve(observer);
				personalListeners.delete(listener);
			};
		},
		async secretValues(use = {}) {
			const names = new Set(secretView().keys());
			for (const c of connectionView().values()) {
				for (const name of referencedVariables(c.server)) names.add(name);
			}
			// Every Personal value, when the use may read them: not a use of any.
			if (use.personal !== false) {
				for (const { name } of (await listPersonal()) ?? []) names.add(name);
			}
			const { vars } = await resolve(names, use);
			return [...names].flatMap((name) => (vars[name] ? [vars[name]] : []));
		},
	};
}
