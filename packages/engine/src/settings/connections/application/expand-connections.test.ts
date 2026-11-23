import { describe, expect, test } from "bun:test";
import { inMemoryConnectionSecrets } from "../adapters/out/in-memory-neighbours";
import { inMemorySavedConnections } from "../adapters/out/in-memory-saved-connections";
import { expandConnections } from "./expand-connections";

const linear = {
	description: null,
	server: {
		url: "https://mcp.example.com",
		headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
	},
	updatedAt: 1,
};

describe("expandConnections", () => {
	test("expands a node's connections and notes the use of their secrets", async () => {
		const secrets = inMemoryConnectionSecrets({
			values: { LINEAR_TOKEN: "t-1" },
		});
		const expand = expandConnections({
			saved: inMemorySavedConnections([["linear", linear]]),
			secrets,
		});
		const expansion = await expand({ node: { connections: ["linear"] } });
		expect(expansion).toEqual({
			ok: true,
			servers: {
				linear: {
					url: "https://mcp.example.com",
					headers: { Authorization: "Bearer t-1" },
				},
			},
			values: ["t-1"],
		});
		expect(secrets.noted).toEqual([["LINEAR_TOKEN"]]);
	});

	test("refuses a name this computer has no connection of, and reads no secret", async () => {
		const secrets = inMemoryConnectionSecrets();
		const expand = expandConnections({
			saved: inMemorySavedConnections(),
			secrets,
		});
		expect(await expand({ node: { connections: ["notion"] } })).toEqual({
			ok: false,
			message:
				'There is no connection named "notion". Add it under Agents → Tools, or remove it from the node.',
		});
		expect(secrets.resolved).toEqual([]);
	});

	test("a missing secret notes no use, and says which scopes could not be read", async () => {
		const secrets = inMemoryConnectionSecrets({ unreachable: true });
		const expand = expandConnections({
			saved: inMemorySavedConnections([["linear", linear]]),
			secrets,
		});
		expect(await expand({ node: { connections: ["linear"] } })).toEqual({
			ok: false,
			message:
				'The MCP server "linear" needs the secret LINEAR_TOKEN, but it is not saved. Save it on the Secrets page, or remove the reference. Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.',
		});
		expect(secrets.noted).toEqual([]);
	});

	test("a node with no connections expands to no servers", async () => {
		const expand = expandConnections({
			saved: inMemorySavedConnections(),
			secrets: inMemoryConnectionSecrets(),
		});
		expect(await expand({ node: { connections: [] } })).toMatchObject({
			ok: true,
			servers: {},
		});
	});
});
