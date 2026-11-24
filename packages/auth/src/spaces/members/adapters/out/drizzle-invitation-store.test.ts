import { beforeEach, describe, expect, test } from "bun:test";
import { memoryDb } from "../../../../testing/memory-db";
import { drizzleMembersSeed } from "../../test-support";
import { drizzleInvitationStore } from "./drizzle-invitation-store";

const NOW = 1_000_000;

const make = async () => {
	const db = await memoryDb();
	return {
		invitationStore: drizzleInvitationStore(db),
		seed: drizzleMembersSeed(db),
	};
};

describe("InvitationStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	const invite = (
		id: string,
		change: Partial<{
			email: string;
			role: string | null;
			status: string;
			expiresAt: number;
			createdAt: number;
		}> = {},
	) =>
		under.seed.invitation({
			id,
			spaceId: "platform",
			email: "Bo@X.org",
			role: "viewer",
			status: "pending",
			expiresAt: NOW + 1,
			inviterId: "ada",
			createdAt: NOW - 10,
			...change,
		});
	beforeEach(async () => {
		under = await make();
		await under.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await under.seed.space({ id: "platform", name: "Platform" });
		await under.seed.space({ id: "other", name: "Other" });
	});

	test("an unknown id is null, and not open", async () => {
		expect(await under.invitationStore.find("nobody-has-it")).toBeNull();
		expect(
			await under.invitationStore.isOpen({
				id: "nobody-has-it",
				email: "bo@x.org",
				now: NOW,
			}),
		).toBe(false);
	});

	test("finds an invitation with the names of its Space and inviter", async () => {
		await invite("inv-1");
		await invite("inv-2", { role: null, status: "canceled" });
		expect(await under.invitationStore.find("inv-1")).toEqual({
			id: "inv-1",
			email: "Bo@X.org",
			role: "viewer",
			status: "pending",
			expiresAt: NOW + 1,
			spaceName: "Platform",
			inviterName: "Ada",
		});
		expect(await under.invitationStore.find("inv-2")).toMatchObject({
			role: "member",
			status: "canceled",
		});
	});

	test("is open while pending, before its time, for its email in any case", async () => {
		await invite("open");
		await invite("late", { expiresAt: NOW });
		await invite("gone", { status: "canceled" });
		const open = (id: string, email = "bo@x.org") =>
			under.invitationStore.isOpen({ id, email, now: NOW });
		expect(await open("open")).toBe(true);
		expect(await open("open", "cy@x.org")).toBe(false);
		expect(await open("late")).toBe(false);
		expect(await open("gone")).toBe(false);
	});

	test("lists the pending invitations of a Space before their time, oldest first", async () => {
		await invite("second", { createdAt: NOW - 5, role: null });
		await invite("first", { createdAt: NOW - 8 });
		await invite("late", { expiresAt: NOW });
		await invite("accepted", { status: "accepted" });
		await under.seed.invitation({
			id: "elsewhere",
			spaceId: "other",
			email: "c@x.org",
			role: "member",
			status: "pending",
			expiresAt: NOW + 1,
			inviterId: "ada",
			createdAt: NOW - 9,
		});
		expect(await under.invitationStore.pendingOf("platform", NOW)).toEqual([
			{
				id: "first",
				email: "Bo@X.org",
				role: "viewer",
				inviterName: "Ada",
				expiresAt: NOW + 1,
			},
			{
				id: "second",
				email: "Bo@X.org",
				role: "member",
				inviterName: "Ada",
				expiresAt: NOW + 1,
			},
		]);
	});
});
