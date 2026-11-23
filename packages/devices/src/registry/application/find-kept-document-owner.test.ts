import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { findKeptDocumentOwner } from "./find-kept-document-owner";

/** The use case findKeptDocumentOwner, on in-memory adapters. */

describe("findKeptDocumentOwner", () => {
	test("the home Host keeps the document of a Device with access", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "b", ownerId: "person-ada", homeHost: "https://h" });
		const owner = findKeptDocumentOwner(p);
		expect(await owner({ documentName: "device:b" })).toBe("person-ada");
	});

	test("a guest Host keeps no Device document; nor does any Host for a name it does not know", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "guest", ownerId: "person-ada" });
		p.store.add({
			id: "gone",
			ownerId: "person-ada",
			homeHost: "https://h",
			revokedAt: 1,
		});
		const owner = findKeptDocumentOwner(p);
		expect(await owner({ documentName: "device:guest" })).toBeNull();
		expect(await owner({ documentName: "device:gone" })).toBeNull();
		expect(await owner({ documentName: "device:nobody" })).toBeNull();
		expect(await owner({ documentName: "space:b" })).toBeNull();
	});
});
