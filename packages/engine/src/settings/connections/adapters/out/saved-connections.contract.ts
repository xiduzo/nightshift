import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SavedConnections } from "../../application/ports";
import type { ConnectionEntry } from "../../domain/saved-connection";

/** One store to test: what an adapter of `SavedConnections` gives the suite. */
export type SavedConnectionsUnderTest = {
	saved: SavedConnections;
	/** Puts a raw entry in, as an older version or another computer wrote it. */
	put(name: string, value: unknown): Promise<void>;
	close(): Promise<void>;
};

const linear: ConnectionEntry = {
	description: "Issues",
	server: {
		url: "https://mcp.example.com",
		headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
	},
	updatedAt: 1000,
};

/**
 * What every adapter of `SavedConnections` does.
 * `saved-connections.contract.test.ts` runs it on the in-memory adapter
 * and on the one over the Device document.
 */
export function savedConnectionsContract(
	name: string,
	open: () => Promise<SavedConnectionsUnderTest>,
) {
	describe(`SavedConnections contract: ${name}`, () => {
		let under: SavedConnectionsUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("nothing saved reads as an empty map", () => {
			expect([...under.saved.read()]).toEqual([]);
		});

		test("a write saves a connection under its name, and the next read has it", async () => {
			await under.saved.write("linear", linear);
			expect(under.saved.read().get("linear")).toEqual({
				name: "linear",
				...linear,
			});
		});

		test("a removal takes the connection out", async () => {
			await under.saved.write("linear", linear);
			await under.saved.write("notion", { ...linear, description: null });
			await under.saved.remove("linear");
			expect([...under.saved.read().keys()]).toEqual(["notion"]);
		});

		test("an entry or a server this version cannot read is left out", async () => {
			await under.put("a", { description: null, updatedAt: 1 });
			await under.put("b", { ...linear, server: { url: 5 } });
			expect(under.saved.read().size).toBe(0);
		});
	});
}
