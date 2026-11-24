import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { addMembership } from "./add-membership";

describe("addMembership", () => {
	test("makes the Person a Member in that role, with a new id", async () => {
		const ports = await membersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await ports.seed.space({ id: "platform", name: "Platform" });
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
