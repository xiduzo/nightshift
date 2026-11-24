import { describe, expect, test } from "bun:test";
import { inMemoryConnectionSecrets } from "../adapters/out/in-memory-neighbours";
import { inMemorySavedConnections } from "../adapters/out/in-memory-saved-connections";
import { writeConnection } from "./write-connection";

describe("writeConnection", () => {
	test("writes the entry in the order the document keeps, and answers it with its references", async () => {
		const saved = inMemorySavedConnections();
		const write = writeConnection({
			saved,
			secrets: inMemoryConnectionSecrets({ values: { TOKEN: "x" } }),
			now: () => 1000,
		});
		const connection = await write({
			name: "linear",
			description: "   ",
			server: { url: "https://mcp.example.com", headers: { A: "${TOKEN}" } },
		});
		expect(connection).toEqual({
			name: "linear",
			description: null,
			server: { url: "https://mcp.example.com", headers: { A: "${TOKEN}" } },
			updatedAt: 1000,
			variables: [{ name: "TOKEN", source: "keychain" }],
		});
		expect(saved.writes).toHaveLength(1);
		expect(Object.keys(saved.writes[0]?.entry ?? {})).toEqual([
			"description",
			"server",
			"updatedAt",
		]);
	});

	test("refuses a connection that does not parse, and writes nothing", async () => {
		const saved = inMemorySavedConnections();
		const write = writeConnection({
			saved,
			secrets: inMemoryConnectionSecrets(),
			now: () => 1,
		});
		await expect(
			write({ name: "Bad Name", server: { url: "https://mcp.example.com" } }),
		).rejects.toThrow();
		await expect(
			write({ name: "nourl", server: { url: "not a url" } }),
		).rejects.toThrow();
		expect(saved.writes).toEqual([]);
	});
});
