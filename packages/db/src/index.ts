// The API of `@nightshift/db`: the client and the auth tables for Better
// Auth's adapter. The other entries are `./schema`, `./data-dir` and
// `./migrate`, each one a vertical's barrel.

export { createDb, type Database } from "./client";
export { authSchema } from "./schema";
