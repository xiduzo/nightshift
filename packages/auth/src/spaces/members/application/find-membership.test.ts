import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { findMembership } from "./find-membership";

describe("findMembership", () => {
	test("finds the Person's membership of the Space, or null", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.membership({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "admin",
			createdAt: 1,
		});
		const find = findMembership(ports);
		expect(await find({ spaceId: "platform", personId: "ada" })).toEqual({
			id: "m-ada",
			role: "admin",
		});
		expect(await find({ spaceId: "other", personId: "ada" })).toBeNull();
	});
});
