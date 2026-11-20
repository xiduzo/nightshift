import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { addMembership } from "./add-membership";

describe("addMembership", () => {
	test("makes the Person a Member in that role, with a new id", async () => {
		const ports = inMemoryMembersPorts();
		await addMembership(ports)({
			spaceId: "platform",
			personId: "ada",
			role: "viewer",
		});
		expect(await ports.memberStore.membershipOf("platform", "ada")).toEqual({
			id: "id-1",
			role: "viewer",
		});
	});
});
