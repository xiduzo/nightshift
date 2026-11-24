import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { setMembershipRole } from "./set-membership-role";

describe("setMembershipRole", () => {
	test("gives the membership the new role", async () => {
		const ports = await membersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await ports.seed.space({ id: "platform", name: "Platform" });
		await ports.seed.membership({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "member",
			createdAt: 1,
		});
		await setMembershipRole(ports)({ membershipId: "m-ada", role: "admin" });
		expect(await ports.memberStore.membershipOf("platform", "ada")).toEqual({
			id: "m-ada",
			role: "admin",
		});
	});
});
