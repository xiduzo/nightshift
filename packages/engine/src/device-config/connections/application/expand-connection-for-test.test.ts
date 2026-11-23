import { describe, expect, test } from "bun:test";
import { inMemoryConnectionSecrets } from "../adapters/out/in-memory-neighbours";
import { inMemorySavedConnections } from "../adapters/out/in-memory-saved-connections";
import { expandConnectionForTest } from "./expand-connection-for-test";

const server = {
	command: "npx",
	args: ["-y", "notion-mcp"],
	env: { NOTION_TOKEN: "${NOTION_TOKEN}" },
};

describe("expandConnectionForTest", () => {
	test("expands a saved connection by name, notes the use and gives the values it read", async () => {
		const secrets = inMemoryConnectionSecrets({
			values: { NOTION_TOKEN: "n-1" },
		});
		const expand = expandConnectionForTest({
			saved: inMemorySavedConnections([
				["notion", { description: null, server, updatedAt: 1 }],
			]),
			secrets,
		});
		expect(await expand({ name: "notion" })).toEqual({
			expansion: {
				ok: true,
				servers: {
					notion: {
						command: "npx",
						args: ["-y", "notion-mcp"],
						env: { NOTION_TOKEN: "n-1" },
					},
				},
				values: ["n-1"],
			},
			values: ["n-1"],
		});
		expect(secrets.noted).toEqual([["NOTION_TOKEN"]]);
	});

	test("expands a draft under the name draft", async () => {
		const expand = expandConnectionForTest({
			saved: inMemorySavedConnections(),
			secrets: inMemoryConnectionSecrets({ values: { NOTION_TOKEN: "n-1" } }),
		});
		const { expansion } = await expand({ server });
		expect(expansion.ok && Object.keys(expansion.servers)).toEqual(["draft"]);
	});

	test("a name with no connection answers the sentence, and reads no secret", async () => {
		const secrets = inMemoryConnectionSecrets();
		const expand = expandConnectionForTest({
			saved: inMemorySavedConnections(),
			secrets,
		});
		expect(await expand({ name: "notion" })).toEqual({
			expansion: {
				ok: false,
				message: 'There is no connection named "notion".',
			},
			values: [],
		});
		expect(secrets.resolved).toEqual([]);
	});

	test("a missing secret notes no use and ends with the scopes that could not be read", async () => {
		const secrets = inMemoryConnectionSecrets({ projectUnreachable: true });
		const expand = expandConnectionForTest({
			saved: inMemorySavedConnections(),
			secrets,
		});
		expect(await expand({ server })).toEqual({
			expansion: {
				ok: false,
				message:
					'The MCP server "draft" needs the secret NOTION_TOKEN, but it is not saved. Save it on the Secrets page, or remove the reference. Night Shift could not read this project\'s secrets now. Check that this computer is online, then try again.',
			},
			values: [],
		});
		expect(secrets.noted).toEqual([]);
	});
});
