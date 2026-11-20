import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { viewInvitation } from "./view-invitation";

const NOW = 1_000;

async function withInvitation(status = "pending") {
	const ports = inMemoryMembersPorts();
	await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
	await ports.seed.space({ id: "platform", name: "Platform" });
	await ports.seed.invitation({
		id: "inv",
		spaceId: "platform",
		email: "Bo@X.org",
		role: "viewer",
		status,
		expiresAt: NOW,
		inviterId: "ada",
		createdAt: 0,
	});
	return ports;
}

describe("viewInvitation", () => {
	test("an unknown id is null", async () => {
		const ports = inMemoryMembersPorts();
		expect(await viewInvitation(ports)({ id: "inv", now: NOW })).toBeNull();
	});

	test("shows the Space, the inviter and whether the email has an account", async () => {
		const ports = await withInvitation();
		expect(await viewInvitation(ports)({ id: "inv", now: NOW - 1 })).toEqual({
			id: "inv",
			spaceName: "Platform",
			email: "Bo@X.org",
			role: "viewer",
			inviterName: "Ada",
			status: "pending",
			hasAccount: false,
		});
		await ports.seed.person({ id: "bo", name: "Bo", email: "bo@x.org" });
		expect(
			(await viewInvitation(ports)({ id: "inv", now: NOW - 1 }))?.hasAccount,
		).toBe(true);
	});

	test("a pending invitation past its time is expired, another keeps its status", async () => {
		const pending = await withInvitation();
		expect(
			(await viewInvitation(pending)({ id: "inv", now: NOW }))?.status,
		).toBe("expired");
		const accepted = await withInvitation("accepted");
		expect(
			(await viewInvitation(accepted)({ id: "inv", now: NOW }))?.status,
		).toBe("accepted");
	});
});
