/** The secrets this computer keeps, sealed at rest: the Personal, Project and Space stores. */

export type {
	PersonalSecretStore,
	ProjectSecretStore,
	SpaceSecretStore,
} from "./application/ports";
export type { KeptProjectSecret } from "./domain/kept-secret";
export { wireKept } from "./wire";
