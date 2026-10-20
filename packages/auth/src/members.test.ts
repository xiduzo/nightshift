import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { user } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

import { hasPermission, type MemberChange } from "./index";
import { invitationView, membersOf } from "./members";
import { requestAccess } from "./request";
import { LOCAL_EMAIL, localPerson, personalSpaceId } from "./spaces";
import { type AuthSandbox, cookiesOf, createAuthSandbox } from "./test-support";

let sandbox: AuthSandbox;
let changes: MemberChange[];
beforeEach(async () => {
	changes = [];
	sandbox = await createAuthSandbox({
		onMemberChange: async (change) => {
			changes.push(change);
		},
	});
});
afterEach(() => sandbox.cleanup());

async function roleOf(personId: string) {
	const [row] = await sandbox.db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, personId));
	return row?.role;
}

async function platformOf(headers: Headers) {
	const space = await sandbox.auth.api.createOrganization({
		headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	return space.id;
}

async function invite(
	headers: Headers,
	spaceId: string,
	email: string,
	role: "member" | "viewer" | "admin" = "member",
) {
	const created = await sandbox.auth.api.createInvitation({
		headers,
		body: { email, role, organizationId: spaceId },
	});
	return created.id;
}

/** Signs up through the endpoint a browser calls: a refusal is a 403 response. */
async function signUpEmail(body: Record<string, string>): Promise<Response> {
	try {
		return await sandbox.auth.api.signUpEmail({
			body: { name: "Carol", password: "a-long-password", ...body } as {
				name: string;
				email: string;
				password: string;
			},
			asResponse: true,
		});
	} catch (error) {
		const refused = error as { statusCode?: number; body?: unknown };
		if (refused.statusCode === undefined) throw error;
		return Response.json(refused.body, { status: refused.statusCode });
	}
}

describe("invitation-only signup", () => {
	test("the Person of this computer is the first, and the Host admin", async () => {
		const local = await localPerson(sandbox.db);
		const [person] = await sandbox.db
			.select({ email: user.email, role: user.role })
			.from(user)
			.where(eq(user.id, local.userId));
		expect(person).toEqual({ email: LOCAL_EMAIL, role: "admin" });
		// Everyone after is a user of the Host.
		const ada = await sandbox.signUp("Ada");
		expect(await roleOf(ada.userId)).toBe("user");
	});

	test("on a Host without anyone, the first sign-up needs no invitation and is the admin", async () => {
		await sandbox.db.delete(user);
		const first = await signUpEmail({ email: "first@example.com" });
		expect(first.status).toBe(200);
		const body = (await first.json()) as { user: { id: string } };
		expect(await roleOf(body.user.id)).toBe("admin");

		const second = await signUpEmail({ email: "second@example.com" });
		expect(second.status).toBe(403);
	});

	test("is refused without an invitation", async () => {
		const response = await signUpEmail({ email: "carol@example.com" });
		expect(response.status).toBe(403);
		expect(((await response.json()) as { message: string }).message).toBe(
			"New people join by invitation only. Open the invitation link you got.",
		);
	});

	test("is refused for another email, or an invitation that was canceled", async () => {
		const ada = await sandbox.signUp("Ada");
		const platform = await platformOf(ada.headers);
		const id = await invite(ada.headers, platform, "carol@example.com");

		const wrongEmail = await signUpEmail({
			email: "mallory@example.com",
			invitationId: id,
		});
		expect(wrongEmail.status).toBe(403);

		await sandbox.auth.api.cancelInvitation({
			headers: ada.headers,
			body: { invitationId: id },
		});
		const canceled = await signUpEmail({
			email: "carol@example.com",
			invitationId: id,
		});
		expect(canceled.status).toBe(403);
		expect((await invitationView(sandbox.db, id))?.status).toBe("canceled");
	});
});

describe("invite, accept, member", () => {
	test("an invitation is the account: sign up, accept, and work in the Space", async () => {
		const ada = await sandbox.signUp("Ada");
		const platform = await platformOf(ada.headers);
		const id = await invite(ada.headers, platform, "Carol@Example.com");

		expect(await invitationView(sandbox.db, id)).toEqual({
			id,
			spaceName: "Platform",
			email: "carol@example.com",
			role: "member",
			inviterName: "Ada",
			status: "pending",
			hasAccount: false,
		});
		expect((await membersOf(sandbox.db, platform)).invitations).toEqual([
			expect.objectContaining({ id, email: "carol@example.com" }),
		]);

		const signedUp = await signUpEmail({
			email: "carol@example.com",
			invitationId: id,
		});
		expect(signedUp.status).toBe(200);
		const carol = cookiesOf(signedUp);
		const { user: person } = (await signedUp.json()) as {
			user: { id: string };
		};
		expect(await roleOf(person.id)).toBe("user");

		await sandbox.auth.api.acceptInvitation({
			headers: carol,
			body: { invitationId: id },
		});
		const access = await requestAccess(sandbox.auth, sandbox.db, carol, null);
		expect(access.spaceId).toBe(platform);
		expect(await access.can({ run: ["start"] })).toBe(true);
		expect(await access.can({ member: ["invite"] })).toBe(false);

		const listed = await membersOf(sandbox.db, platform);
		expect(listed.members.map((m) => [m.name, m.role])).toEqual([
			["Ada", "owner"],
			["Carol", "member"],
		]);
		expect(listed.invitations).toEqual([]);
		expect((await invitationView(sandbox.db, id))?.status).toBe("accepted");
		expect(changes).toContainEqual({
			kind: "joined",
			spaceId: platform,
			personId: person.id,
			role: "member",
			by: person.id,
			invitedBy: ada.userId,
		});
	});

	test("a role change and a removal name who made them", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const platform = await platformOf(ada.headers);
		const id = await invite(ada.headers, platform, "bob@example.com");
		await sandbox.auth.api.acceptInvitation({
			headers: bob.headers,
			body: { invitationId: id },
		});
		const [membership] = (await membersOf(sandbox.db, platform)).members.filter(
			(m) => m.personId === bob.userId,
		);

		await sandbox.auth.api.updateMemberRole({
			headers: ada.headers,
			body: {
				memberId: membership?.id ?? "",
				role: "viewer",
				organizationId: platform,
			},
		});
		expect(changes).toContainEqual({
			kind: "role",
			spaceId: platform,
			personId: bob.userId,
			role: "viewer",
			previousRole: "member",
			by: ada.userId,
		});

		await sandbox.auth.api.removeMember({
			headers: ada.headers,
			body: { memberIdOrEmail: membership?.id ?? "", organizationId: platform },
		});
		expect(changes).toContainEqual({
			kind: "removed",
			spaceId: platform,
			personId: bob.userId,
			by: ada.userId,
		});
	});
});

describe("roles in a Space", () => {
	async function spaceWith(role: "viewer" | "admin") {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const platform = await platformOf(ada.headers);
		const id = await invite(ada.headers, platform, "bob@example.com", role);
		await sandbox.auth.api.acceptInvitation({
			headers: bob.headers,
			body: { invitationId: id },
		});
		return { ada, bob, platform };
	}

	test("a viewer cannot invite", async () => {
		const { bob, platform } = await spaceWith("viewer");
		expect(
			await hasPermission(sandbox.auth, bob.headers, platform, {
				member: ["invite"],
			}),
		).toBe(false);
		await expect(
			invite(bob.headers, platform, "dee@example.com"),
		).rejects.toThrow();
	});

	test("an admin invites and changes roles, but cannot delete the Space", async () => {
		const { bob, platform } = await spaceWith("admin");
		const can = (permissions: Parameters<typeof hasPermission>[3]) =>
			hasPermission(sandbox.auth, bob.headers, platform, permissions);
		expect(await can({ member: ["invite", "remove", "role"] })).toBe(true);
		expect(await can({ space: ["delete"] })).toBe(false);
		await invite(bob.headers, platform, "dee@example.com");
		await expect(
			sandbox.auth.api.deleteOrganization({
				headers: bob.headers,
				body: { organizationId: platform },
			}),
		).rejects.toThrow();
	});

	test("a removed member loses access to the Space", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const platform = await platformOf(ada.headers);
		const id = await invite(ada.headers, platform, "bob@example.com");
		await sandbox.auth.api.acceptInvitation({
			headers: bob.headers,
			body: { invitationId: id },
		});
		expect(
			(await requestAccess(sandbox.auth, sandbox.db, bob.headers, null))
				.spaceId,
		).toBe(platform);

		await sandbox.auth.api.removeMember({
			headers: ada.headers,
			body: { memberIdOrEmail: "bob@example.com", organizationId: platform },
		});
		const after = await requestAccess(
			sandbox.auth,
			sandbox.db,
			bob.headers,
			null,
		);
		// Back in the personal Space; nothing of Platform is theirs.
		expect(after.spaceId).toBe(
			(await personalSpaceId(sandbox.db, bob.userId)) ?? "",
		);
		expect(await after.can({ run: ["start"] }, platform)).toBe(false);
		await expect(after.setActiveSpace(platform)).rejects.toThrow();
	});
});
