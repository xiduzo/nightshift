import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { createdAt, updatedAt } from "./columns";

// Owner: `@nightshift/engine`, `device-config/`. `ydoc` keeps the Yjs
// documents of this Replica: the Device document and the Space documents.
// The tables after it are the configuration the Device document replaced.

/**
 * A Yjs document, by name, as its full state (`Y.encodeStateAsUpdate`).
 * The Device document of this computer is `device:<id>`: its Agent
 * Profiles, CLI Tools, Connections, settings and facts. Its Owner (this
 * computer for its own document) writes the row after every change.
 */
export const ydoc = sqliteTable("ydoc", {
	name: text("name").primaryKey(),
	state: blob("state", { mode: "buffer" }).notNull(),
	updatedAt: updatedAt(),
});

/*
 * Read-only since the Device document: `setting`, `connection`, `cli_tool`,
 * `agent_profile` and `secret` are imported into it once, on the first
 * start of the version that added `ydoc`, and never written again. SQL
 * cannot write a Yjs document, so a migration cannot move the rows itself:
 * a later migration drops these tables, once every install has started
 * this version.
 */

/**
 * A daemon setting changed in the UI. A key without a row falls back to the
 * daemon's environment, then to the built-in default.
 */
export const setting = sqliteTable("setting", {
	key: text("key").primaryKey(),
	/** JSON-encoded value. */
	value: text("value").notNull(),
	updatedAt: updatedAt(),
});

/**
 * An MCP server defined once on this daemon. Agent nodes name it in
 * `connections`. Secrets stay `${NAME}` references, never values.
 */
export const connection = sqliteTable("connection", {
	name: text("name").primaryKey(),
	description: text("description"),
	/** JSON: the MCP server, a command (stdio) or a URL (streamable HTTP). */
	server: text("server").notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * A CLI tool: a program on this computer, by its name (`gh`, `aws`), that
 * the agents may run. Agent nodes and profiles name it in `clis`.
 */
export const cliTool = sqliteTable("cli_tool", {
	name: text("name").primaryKey(),
	description: text("description"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * An Agent Profile: a harness, a model and its tools under one name, defined
 * once on this daemon. An Agent node names it in `profile`; a run resolves it
 * into the node when it starts.
 */
export const agentProfile = sqliteTable("agent_profile", {
	name: text("name").primaryKey(),
	description: text("description"),
	/** JSON: the profile's agent settings (harness, model, effort, permission mode, CLI tools, connections). */
	settings: text("settings").notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * The names of the secrets saved in the system keychain. The values live in
 * the keychain only. A `${NAME}` reads the keychain first, then the environment.
 */
export const secret = sqliteTable("secret", {
	name: text("name").primaryKey(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});
