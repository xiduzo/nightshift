import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device, organization, user } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { requestAccess } from "../access";
import { type Permissions, roleAllows } from "../index";
import { createLocalSession } from "../local-session";
import { type AuthSandbox, createAuthSandbox } from "../testing/sandbox";
import {
	ensurePersonalSpace,
	LOCAL_EMAIL,
	localPerson,
	personalSpaceId,
	spacesOf,
} from "./spaces";

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

async function sharedSpace(headers: Headers, name = "Platform") {
	const space = await sandbox.auth.api.createOrganization({
		headers,
		body: { name, slug: name.toLowerCase() },
	});
	if (!space) throw new Error("no space");
	return space.id;
}

describe("personal Space", () => {
	test("every new Person gets one, and their session starts in it", async () => {
		const ada = await sandbox.signUp("Ada");
		const spaces = await spacesOf(sandbox.db, ada.userId);
		expect(spaces).toEqual([
			{
				id: expect.any(String),
				name: "Personal",
				personal: true,
				role: "owner",
			},
		]);
		const session = await sandbox.auth.api.getSession({
			headers: ada.headers,
		});
		expect(session?.session.activeOrganizationId).toBe(spaces[0]?.id);
	});

	test("is made with its owner membership, or not at all", async () => {
		// No Person has this id: the membership fails, so the Space does too.
		await expect(ensurePersonalSpace(sandbox.db, "nobody")).rejects.toThrow();
		const spaces = await sandbox.db
			.select()
			.from(organization)
			.where(eq(organization.slug, "personal-nobody"));
		expect(spaces).toEqual([]);
	});

	test("lists the personal Space first", async () => {
		const ada = await sandbox.signUp("Ada");
		await sharedSpace(ada.headers, "Alpha");
		expect((await spacesOf(sandbox.db, ada.userId)).map((s) => s.name)).toEqual(
			["Personal", "Alpha"],
		);
	});

	test("nobody can be invited to or added to it", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const personal = await personalSpaceId(sandbox.db, ada.userId);
		await expect(
			sandbox.auth.api.createInvitation({
				headers: ada.headers,
				body: {
					email: "bob@example.com",
					role: "member",
					organizationId: personal ?? "",
				},
			}),
		).rejects.toThrow("Nobody can join a personal Space");
		await expect(
			sandbox.auth.api.addMember({
				body: {
					userId: bob.userId,
					role: "member",
					organizationId: personal ?? "",
				},
			}),
		).rejects.toThrow("Nobody can join a personal Space");

		// A shared Space takes invitations.
		const platform = await sharedSpace(ada.headers);
		await sandbox.auth.api.createInvitation({
			headers: ada.headers,
			body: {
				email: "bob@example.com",
				role: "member",
				organizationId: platform,
			},
		});
	});

	test("it cannot be deleted", async () => {
		const ada = await sandbox.signUp("Ada");
		const personal = await personalSpaceId(sandbox.db, ada.userId);
		await expect(
			sandbox.auth.api.deleteOrganization({
				headers: ada.headers,
				body: { organizationId: personal ?? "" },
			}),
		).rejects.toThrow("A personal Space stays");
	});
});

describe("roles", () => {
	test("a member may start runs and answer Gates, a viewer may not", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const cy = await sandbox.signUp("Cy");
		const platform = await sharedSpace(ada.headers);
		for (const [person, role] of [
			[bob, "member"],
			[cy, "viewer"],
		] as const) {
			await sandbox.auth.api.addMember({
				body: { userId: person.userId, role, organizationId: platform },
			});
		}
		const can = async (who: typeof ada, permissions: Permissions) =>
			(await requestAccess(sandbox.auth, sandbox.db, who.headers, null)).can(
				permissions,
				platform,
			);

		expect(await can(bob, { run: ["start"], gate: ["resolve"] })).toBe(true);
		expect(await can(cy, { run: ["start"] })).toBe(false);
		expect(await can(cy, { gate: ["resolve"] })).toBe(false);
		expect(await can(bob, { project: ["remove"] })).toBe(false);
		expect(await can(ada, { space: ["delete"] })).toBe(true);
		// Not a member at all.
		const dee = await sandbox.signUp("Dee");
		expect(await can(dee, { run: ["start"] })).toBe(false);
	});
});

describe("the local Person", () => {
	test("is the owner of this computer, named after its account", async () => {
		const local = await localPerson(sandbox.db);
		const [self] = await sandbox.db
			.select({ ownerId: device.ownerId })
			.from(device)
			.where(eq(device.self, true));
		expect(self?.ownerId).toBe(local.userId);
		const [person] = await sandbox.db
			.select()
			.from(user)
			.where(eq(user.id, local.userId));
		expect(person?.email).toBe(LOCAL_EMAIL);
		expect(person?.name).not.toBe("");
		expect(local.spaceId).toBe(
			(await personalSpaceId(sandbox.db, local.userId)) ?? "",
		);
	});

	test("a database whose Person is gone gets a new one", async () => {
		const first = await localPerson(sandbox.db);
		await sandbox.db.delete(user).where(eq(user.id, first.userId));
		const again = await localPerson(sandbox.db);
		expect(again.userId).not.toBe(first.userId);
		expect(await spacesOf(sandbox.db, again.userId)).toHaveLength(1);
		// The Host had no admin left: the new Person is it.
		const [person] = await sandbox.db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, again.userId));
		expect(person?.role).toBe("admin");
	});

	test("a request without a session acts as the local Person, in their personal Space", async () => {
		const local = await localPerson(sandbox.db);
		const sessions = createLocalSession(sandbox.auth, sandbox.db, local.userId);

		const first = await sessions.resolve(new Headers());
		expect(first.session?.user.id).toBe(local.userId);
		expect(first.session?.session.activeOrganizationId).toBe(local.spaceId);
		// The headers carry the session to Better Auth's own endpoints.
		const spaces = await sandbox.auth.api.listOrganizations({
			headers: first.headers,
		});
		expect(spaces.map((s) => s.id)).toEqual([local.spaceId]);
		// One session, reused.
		const second = await sessions.resolve(new Headers());
		expect(second.session?.session.id).toBe(first.session?.session.id);

		// A request with its own session keeps it.
		const ada = await sandbox.signUp("Ada");
		const own = await sessions.resolve(ada.headers);
		expect(own.session?.user.id).toBe(ada.userId);
	});
});

describe("creating a Space", () => {
	test("makes its creator the owner, works in it, and tells the daemon", async () => {
		const changed: string[] = [];
		const own = await createAuthSandbox({
			onMembersChanged: async (spaceId) => {
				changed.push(spaceId);
			},
		});
		try {
			const ada = await own.signUp("Ada");
			const access = await requestAccess(own.auth, own.db, ada.headers, null);
			const { id } = await access.createSpace("Platform team");

			expect(await spacesOf(own.db, ada.userId)).toEqual([
				expect.objectContaining({ personal: true }),
				{ id, name: "Platform team", personal: false, role: "owner" },
			]);
			const after = await requestAccess(own.auth, own.db, ada.headers, null);
			expect(after.spaceId).toBe(id);
			expect(changed).toContain(id);
			// A permission in another Space of the Person's.
			const personal = await personalSpaceId(own.db, ada.userId);
			expect(
				await after.can({ project: ["move"] }, personal ?? undefined),
			).toBe(true);
			const bob = await own.signUp("Bob");
			const outsider = await requestAccess(own.auth, own.db, bob.headers, null);
			expect(await outsider.can({ project: ["move"] }, id)).toBe(false);
		} finally {
			own.cleanup();
		}
	});

	test("roleAllows: what each role may do, without a request", () => {
		expect(roleAllows("member", { project: ["add"] })).toBe(true);
		expect(roleAllows("member", { project: ["move"] })).toBe(false);
		expect(roleAllows("admin", { project: ["move"] })).toBe(true);
		expect(roleAllows("viewer", { project: ["add"] })).toBe(false);
		expect(roleAllows("nobody", { project: ["add"] })).toBe(false);
	});
});
