import { type McpServer, mcpServerSchema, nameSchema } from "@nightshift/flows";
import { z } from "zod";
import { REFERENCE } from "./mcp-expansion";

/**
 * Connections: MCP servers defined once in this Device's document, named
 * by Agent nodes. Secrets stay `${NAME}` references: a value never reaches
 * the document.
 */

export const connectionInputSchema = z.object({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
	server: mcpServerSchema,
});
export type ConnectionInput = z.input<typeof connectionInputSchema>;

/** A connection as this computer saved it. */
export type SavedConnection = {
	name: string;
	description: string | null;
	server: McpServer;
	updatedAt: number;
};

/** A connection as the Device document holds it, under its name. */
export type ConnectionEntry = Omit<SavedConnection, "name">;

/** A connection as the Device document holds it. */
const entrySchema = z.object({
	description: z.string().nullable(),
	server: z.unknown(),
	updatedAt: z.number(),
});

/** The connections of a Device document's `connections` map, by name. An entry this version cannot read is left out. */
export function readConnections(
	entries: Iterable<[string, unknown]>,
): Map<string, SavedConnection> {
	const out = new Map<string, SavedConnection>();
	for (const [name, value] of entries) {
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
}

/**
 * The connection a save of `input` makes. An empty description is saved
 * as none. It reads the clock after the input parses.
 */
export function connectionSave(
	input: ConnectionInput,
	now: () => number,
): SavedConnection {
	const parsed = connectionInputSchema.parse(input);
	return {
		name: parsed.name,
		description: parsed.description || null,
		server: parsed.server,
		updatedAt: now(),
	};
}

/** The `${NAME}` references of a server's env values and headers, once each, in the order they come. */
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

/** A connection with each `${NAME}` it references, and where that name gets its value. */
export function withVariables<Source>(
	connection: SavedConnection,
	sourceOf: (name: string) => Source,
): SavedConnection & { variables: { name: string; source: Source }[] } {
	return {
		...connection,
		variables: referencedVariables(connection.server).map((name) => ({
			name,
			source: sourceOf(name),
		})),
	};
}

/** The connections that reference each `${NAME}`, in the order of the connections. */
export function referencesByName(
	connections: Iterable<SavedConnection>,
): Map<string, string[]> {
	const usedBy = new Map<string, string[]>();
	for (const c of connections) {
		for (const name of referencedVariables(c.server)) {
			usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
		}
	}
	return usedBy;
}
