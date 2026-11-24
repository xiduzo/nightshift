import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { findKeptDocumentOwner } from "./find-kept-document-owner";

/** The use case findKeptDocumentOwner, over a database in memory. */

describe("findKeptDocumentOwner", () => {
	test("the home Host keeps the document of a Device with access", async () => {
		const p = await registryPorts();
		await p.add({ id: "b", ownerId: "person-ada", homeHost: "https://h" });
		const owner = findKeptDocumentOwner(p);
		expect(await owner({ documentName: "device:b" })).toBe("person-ada");
	});

	test("a guest Host keeps no Device document; nor does any Host for a name it does not know", async () => {
		const p = await registryPorts();
		await p.add({ id: "guest", ownerId: "person-ada" });
		await p.add({
			id: "gone",
			ownerId: "person-ada",
			homeHost: "https://h",
			revokedAt: 1,
		});
		await p.add({ id: "kept", ownerId: "person-ada", homeHost: "https://h" });
		await p.add({
			id: "self",
			self: true,
			ownerId: "person-ada",
			homeHost: "https://h",
		});
		const owner = findKeptDocumentOwner(p);
		expect(await owner({ documentName: "device:guest" })).toBeNull();
		expect(await owner({ documentName: "device:gone" })).toBeNull();
		expect(await owner({ documentName: "device:nobody" })).toBeNull();
		expect(await owner({ documentName: "device:self" })).toBeNull();
		expect(await owner({ documentName: "spaces:kept" })).toBeNull();
	});
});
