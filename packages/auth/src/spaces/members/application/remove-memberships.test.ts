import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { removeMemberships } from "./remove-memberships";

describe("removeMemberships", () => {
	test("ends the Person's memberships of these Spaces only", async () => {
		const ports = inMemoryMembersPorts();
		for (const [id, spaceId, personId] of [
			["m-1", "platform", "ada"],
			["m-2", "other", "ada"],
			["m-3", "platform", "bo"],
		] as const) {
			await ports.seed.membership({
				id,
				spaceId,
				personId,
				role: "member",
				createdAt: 1,
			});
		}
		await removeMemberships(ports)({ spaceIds: ["platform"], personId: "ada" });
		expect(ports.records.members.map((m) => m.id)).toEqual(["m-2", "m-3"]);
	});
});
