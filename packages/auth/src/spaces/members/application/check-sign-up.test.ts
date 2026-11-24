import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { checkSignUp } from "./check-sign-up";

const NOW = 1_000;

async function withInvitation() {
	const ports = await membersPorts();
	await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
	await ports.seed.space({ id: "platform", name: "Platform" });
	await ports.seed.invitation({
		id: "inv",
		spaceId: "platform",
		email: "Bo@X.org",
		role: "member",
		status: "pending",
		expiresAt: NOW + 1,
		inviterId: "ada",
		createdAt: 0,
	});
	return ports;
}

describe("checkSignUp", () => {
	test("on a Host without anyone, the first sign-up needs no invitation", async () => {
		const ports = await membersPorts();
		expect(await checkSignUp(ports)({ body: {}, now: NOW })).toBeNull();
	});

	test("is refused without an invitation", async () => {
		const ports = await withInvitation();
		expect(
			await checkSignUp(ports)({ body: { email: "bo@x.org" }, now: NOW }),
		).toBe(
			"New people join by invitation only. Open the invitation link you got.",
		);
	});

	test("is refused for another email, or an invitation that is not pending", async () => {
		const ports = await withInvitation();
		const sign = (email: unknown, now = NOW) =>
			checkSignUp(ports)({ body: { email, invitationId: "inv" }, now });
		const notValid =
			"This invitation is not valid for this email. Ask for a new invitation.";
		expect(await sign("cy@x.org")).toBe(notValid);
		expect(await sign(42)).toBe(notValid);
		expect(await sign("bo@x.org", NOW + 1)).toBe(notValid);
		expect(await sign("BO@x.org")).toBeNull();
	});
});
