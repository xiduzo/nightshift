import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { listMembers } from "./list-members";

describe("listMembers", () => {
	test("lists the Members and the pending invitations that have not expired", async () => {
		const ports = await membersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await ports.seed.space({ id: "platform", name: "Platform" });
		await ports.seed.membership({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "owner",
			createdAt: 1,
		});
		for (const [id, expiresAt] of [
			["open", 11],
			["late", 10],
		] as const) {
			await ports.seed.invitation({
				id,
				spaceId: "platform",
				email: "b@x.org",
				role: "member",
				status: "pending",
				expiresAt,
				inviterId: "ada",
				createdAt: 2,
			});
		}
		const listed = await listMembers(ports)({ spaceId: "platform", now: 10 });
		expect(listed.members.map((m) => [m.personId, m.role, m.joinedAt])).toEqual(
			[["ada", "owner", 1]],
		);
		expect(listed.invitations.map((i) => i.id)).toEqual(["open"]);
	});
});
