// The drizzle schema, one file per owner. Each table has one owning package
// (STRUCTURE.md section 2, "Tables have owners"). Another package reads or
// writes a table only through the owner's functions. Each file names its
// owner above its tables:
//
// - `auth.ts`: `@nightshift/auth` (Better Auth's tables). `auth:generate`
//   writes this file, so its owner is named here.
// - `devices.ts`: `@nightshift/devices`.
// - `projects.ts`: `@nightshift/engine` `projects/`.
// - `runs.ts`: `@nightshift/engine` `log/`, `run/`, `graph/` and `read/`.
// - `device-config.ts`: `@nightshift/engine` `device-config/`.
// - `engine.ts`: `@nightshift/engine` `graph/checkpointer.ts` (LangGraph).
// - `daemon.ts`: `@nightshift/daemon` `runtime/` (the lease).
//
// drizzle-kit reads this file: every table must be exported from here.

export * from "./auth";
/**
 * The auth tables only, as one object: Better Auth's drizzle adapter takes
 * the tables it owns, not the whole schema.
 */
export * as authSchema from "./auth";
export * from "./daemon";
export * from "./device-config";
export * from "./devices";
export * from "./engine";
export * from "./projects";
export * from "./runs";
