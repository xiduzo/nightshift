/** Catalog: a person's requests about the Projects of a Space. `wireCatalog` binds the use cases to their ports. */

export type { HostRelay } from "./application/ports";
export { type Catalog, wireCatalog } from "./wire";
