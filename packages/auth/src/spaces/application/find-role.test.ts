import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { findRole } from "./find-role";

describe("findRole", () => {
	test("is the role of the Person's membership, or null", async () => {
		const ports = inMemorySpacesPorts();
		ports.spaceStore.records.members.push({
			spaceId: "platform",
			personId: "ada",
			role: "viewer",
		});
		const find = findRole(ports);
		expect(await find({ personId: "ada", spaceId: "platform" })).toBe("viewer");
		expect(await find({ personId: "bo", spaceId: "platform" })).toBeNull();
	});
});
