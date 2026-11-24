import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { removeMemberships } from "./remove-memberships";

describe("removeMemberships", () => {
	test("ends the Person's memberships of these Spaces only", async () => {
		const ports = await membersPorts();
		for (const id of ["ada", "bo"]) {
			await ports.seed.person({ id, name: id, email: `${id}@x.org` });
		}
		for (const id of ["platform", "other"]) {
			await ports.seed.space({ id, name: id });
		}
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
		expect(await ports.membershipIds()).toEqual(["m-2", "m-3"]);
	});
});
