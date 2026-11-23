/** Secrets: the values a step reads by `${NAME}`, from this computer, the Person's Personal secrets and a run's Space and Project, by the Secret scope rule. Values never reach a document, a log or a reply. `wireSecrets` binds the use cases to their ports. */

export {
	type ComputerSecrets,
	type PersonalSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	type SecretList,
	type SecretScope,
	type SecretSource,
	type SecretView,
	savedSecretSchema,
	takenOverSecrets,
	unreachableNote,
} from "./scopes";
export { type ExpandedEnv, notRead } from "./uses";
export { wireSecrets } from "./wire";
