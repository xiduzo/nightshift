import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	device,
	member,
	organization,
	session,
	user,
} from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import {
	type AuthSandbox,
	createAuthSandbox,
	testRequestAccess,
	testSpaces,
} from "../testing";
import { testLocalPerson, testLocalSession } from "../testing/wires";
import { LOCAL_EMAIL } from "./personal/domain/personal-space";
import { runBatch } from "./personal/test-support";

let sandbox: AuthSandbox;
let authSpaces: ReturnType<typeof testSpaces>;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	authSpaces = testSpaces(sandbox.db);
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
		const spaces = await authSpaces.listSpaces({ personId: ada.userId });
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

	test("the role of a Person is the one of their own membership of that Space", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const spaceId = await sharedSpace(ada.headers);
		expect(await authSpaces.findRole({ personId: ada.userId, spaceId })).toBe(
			"owner",
		);
		expect(
			await authSpaces.findRole({ personId: bob.userId, spaceId }),
		).toBeNull();
	});

	test("nobody can be invited to or added to it", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const personal = await authSpaces.personal.findPersonalSpace({
			personId: ada.userId,
		});
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
		const personal = await authSpaces.personal.findPersonalSpace({
			personId: ada.userId,
		});
		await expect(
			sandbox.auth.api.deleteOrganization({
				headers: ada.headers,
				body: { organizationId: personal ?? "" },
			}),
		).rejects.toThrow("A personal Space stays");
	});
});

describe("the local Person", () => {
	test("is the owner of this computer, named after its account", async () => {
		const local = await testLocalPerson(sandbox.db);
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
			(await authSpaces.personal.findPersonalSpace({
				personId: local.userId,
			})) ?? "",
		);
	});

	test("a database whose Person is gone gets a new one", async () => {
		const first = await testLocalPerson(sandbox.db);
		await sandbox.db.delete(user).where(eq(user.id, first.userId));
		const again = await testLocalPerson(sandbox.db);
		expect(again.userId).not.toBe(first.userId);
		expect(
			await authSpaces.listSpaces({ personId: again.userId }),
		).toHaveLength(1);
		// The Host had no admin left: the new Person is it.
		const [person] = await sandbox.db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, again.userId));
		expect(person?.role).toBe("admin");
	});

	test("a request without a session acts as the local Person, in their personal Space", async () => {
		const local = await testLocalPerson(sandbox.db);
		const sessions = testLocalSession(sandbox.auth, sandbox.db, local.userId);

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
			const access = await testRequestAccess(
				own.auth,
				own.db,
				ada.headers,
				null,
			);
			const { id } = await access.createSpace("Platform team");

			expect(
				await testSpaces(own.db).listSpaces({ personId: ada.userId }),
			).toEqual([
				expect.objectContaining({ personal: true }),
				{ id, name: "Platform team", personal: false, role: "owner" },
			]);
			const after = await testRequestAccess(
				own.auth,
				own.db,
				ada.headers,
				null,
			);
			expect(after.spaceId).toBe(id);
			expect(changed).toContain(id);
			// A permission in another Space of the Person's.
			const personal = await testSpaces(own.db).personal.findPersonalSpace({
				personId: ada.userId,
			});
			expect(
				await after.can({ project: ["move"] }, personal ?? undefined),
			).toBe(true);
			const bob = await own.signUp("Bob");
			const outsider = await testRequestAccess(
				own.auth,
				own.db,
				bob.headers,
				null,
			);
			expect(await outsider.can({ project: ["move"] }, id)).toBe(false);
		} finally {
			own.cleanup();
		}
	});
});

describe("adopting the personal Space of the Home Host", () => {
	/** Ada's own personal Space, and the copy of her personal Space on her Home Host. */
	async function setUp(options: { member: boolean }) {
		const ada = await sandbox.signUp("Ada");
		const own = await authSpaces.personal.findPersonalSpace({
			personId: ada.userId,
		});
		if (!own) throw new Error("no personal Space");
		const hosted = "space-on-host";
		await authSpaces.mirrorHostSpace({
			id: hosted,
			name: "Personal on studio",
		});
		if (options.member) {
			await sandbox.db.insert(member).values({
				id: "m-hosted",
				organizationId: hosted,
				userId: ada.userId,
				role: "owner",
				createdAt: asDate(),
			});
		}
		return { ada, own, hosted };
	}

	for (const withMember of [true, false]) {
		test(`the Host's Space becomes the one personal Space, named Personal${withMember ? "" : ", also before a membership of it is here"}`, async () => {
			const { ada, own, hosted } = await setUp({ member: withMember });
			const statements = await authSpaces.personal.adoptPersonalSpace({
				personId: ada.userId,
				from: own,
				to: hosted,
			});
			await runBatch(sandbox.db, statements);

			expect(await authSpaces.listSpaces({ personId: ada.userId })).toEqual([
				{ id: hosted, name: "Personal", personal: true, role: "owner" },
			]);
			// A session that worked in the old one works in the new one.
			const sessions = await sandbox.db
				.select({ active: session.activeOrganizationId })
				.from(session)
				.where(eq(session.userId, ada.userId));
			expect(sessions.map((s) => s.active)).toEqual([hosted]);
			// No second personal Space is made for her.
			expect(
				await authSpaces.personal.ensurePersonalSpace({ personId: ada.userId }),
			).toBe(hosted);
			const [old] = await sandbox.db
				.select()
				.from(organization)
				.where(eq(organization.id, own));
			expect(old).toBeUndefined();
		});
	}
});

describe("splitting a personal Space off the Home Host's", () => {
	/** Ada's personal Space is the one her Home Host keeps, as after a merge. */
	async function merged() {
		const ada = await sandbox.signUp("Ada");
		const own = await authSpaces.personal.findPersonalSpace({
			personId: ada.userId,
		});
		if (!own) throw new Error("no personal Space");
		const hosted = "space-on-host";
		await authSpaces.mirrorHostSpace({ id: hosted, name: "Personal" });
		await runBatch(
			sandbox.db,
			await authSpaces.personal.adoptPersonalSpace({
				personId: ada.userId,
				from: own,
				to: hosted,
			}),
		);
		return { ada, hosted };
	}

	test("a new Space becomes the one personal Space, and the Host's is no longer hers here", async () => {
		const { ada, hosted } = await merged();

		await runBatch(
			sandbox.db,
			await authSpaces.personal.splitPersonalSpace({
				personId: ada.userId,
				from: hosted,
				to: "space-of-her-own",
				hostName: "studio",
			}),
		);

		expect(await authSpaces.listSpaces({ personId: ada.userId })).toEqual([
			{
				id: "space-of-her-own",
				name: "Personal",
				personal: true,
				role: "owner",
			},
		]);
		expect(
			await authSpaces.personal.ensurePersonalSpace({ personId: ada.userId }),
		).toBe("space-of-her-own");
		const [kept] = await sandbox.db
			.select()
			.from(organization)
			.where(eq(organization.id, hosted));
		expect(kept).toMatchObject({ name: "Personal on studio", personal: false });
		const sessions = await sandbox.db
			.select({ active: session.activeOrganizationId })
			.from(session)
			.where(eq(session.userId, ada.userId));
		expect(sessions.map((s) => s.active)).toEqual(["space-of-her-own"]);
	});
});
