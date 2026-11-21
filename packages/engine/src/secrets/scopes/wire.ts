import { now as timeNow } from "@nightshift/time";
import type { DeviceDocument } from "../../documents";
import { yjsSecretFacts } from "./adapters/out/yjs-secret-facts";
import type {
	ComputerSecrets,
	PersonalSecrets,
	ProjectSecrets,
	SecretFacts,
	SecretReferences,
} from "./application/ports";
import { createKnownSecrets, type KnownSecrets } from "./domain/known-secrets";
import type { Reach } from "./domain/scope-steps";
import type { SecretEnvironment } from "./domain/secret-views";

/**
 * The wiring of the scopes: the one place that builds their real adapter
 * (the secret facts of the Device document) and their memory of names
 * (`createKnownSecrets`). The use cases of `uses` and `edits` take them.
 */

/** What the composition gives the scopes: the ports another vertical or package fills, and what the real adapter stands on. */
export type ScopesDeps = {
	/** This computer's Device document: the saved names and the use times are its facts. */
	document: Pick<DeviceDocument, "facts" | "revision" | "change">;
	/** The fallback of every `${NAME}`: the environment. */
	env: SecretEnvironment;
	/** Where the values of this computer's saved secrets live (`secretStore`). */
	computer: ComputerSecrets;
	/** The connections that reference each name. */
	references: SecretReferences;
	/**
	 * The Person's Personal secrets, read at each use. Null: not reachable
	 * yet (the daemon starts the devices after the stores). Without it,
	 * this computer has no Personal scope.
	 */
	personal?: () => PersonalSecrets | null;
	/**
	 * The secrets of the Projects, read at each use. Null: not reachable
	 * yet. Without it, this computer has no Project scope.
	 */
	projects?: () => ProjectSecrets | null;
	/** "Be a Host" is on here now: the Secret scope rule reads it. Default: no. */
	host?: () => boolean;
	/** The clock for the set and use times. */
	now?: () => number;
};

/** The ports every use case of secrets shares, and the memory of names. */
export type Scopes = {
	computer: ComputerSecrets;
	facts: SecretFacts;
	references: SecretReferences;
	personal: Reach<PersonalSecrets>;
	projects: Reach<ProjectSecrets>;
	known: KnownSecrets;
	env: SecretEnvironment;
	host: () => boolean;
	now: () => number;
};

export function wireScopes(deps: ScopesDeps): Scopes {
	return {
		computer: deps.computer,
		facts: yjsSecretFacts(deps.document),
		references: deps.references,
		personal: deps.personal,
		projects: deps.projects,
		known: createKnownSecrets((line, error) => console.warn(line, error)),
		env: deps.env,
		host: deps.host ?? (() => false),
		now: deps.now ?? timeNow,
	};
}
