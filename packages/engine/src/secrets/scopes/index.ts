/** The scopes of the secrets: where values live, the Secret scope rule, the words a person reads, and what this computer remembers of the names. `wireScopes` builds the ports the use cases share. */

export type {
	ComputerSecrets,
	PersonalSecrets,
	ProjectSecrets,
	SecretFacts,
	SecretReferences,
} from "./application/ports";
export type { KnownSecrets } from "./domain/known-secrets";
export {
	checkSecret,
	listPersonalNames,
	movedValue,
	type Reach,
	reachPersonal,
	reachProjects,
	removeIn,
	saveIn,
	valueIn,
} from "./domain/scope-steps";
export { secretScopes, takenOverSecrets } from "./domain/secret-scopes";
export {
	type ProjectSecretName,
	type SecretEnvironment,
	type SecretList,
	type SecretScope,
	type SecretSource,
	type SecretView,
	savedSecretSchema,
	secretRows,
	sourceOf,
} from "./domain/secret-views";
export { unreachableNote } from "./domain/secret-words";
export { type Scopes, wireScopes } from "./wire";
