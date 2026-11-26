import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { testSpaces } from "@nightshift/auth/testing";

import { device, hostSpace, member, organization } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { and, eq } from "drizzle-orm";
import type { ListedSpace } from "../contract";
import { createHostLinks } from "./host-links";
import { createHostSpaces } from "./host-spaces";

const personalSpaceId = (
	db: Parameters<typeof testSpaces>[0],
	personId: string,
) => testSpaces(db).personal.findPersonalSpace({ personId });

const spacesOf = (db: Parameters<typeof testSpaces>[0], personId: string) =>
	testSpaces(db).listSpaces({ personId });

let sandbox: Sandbox;
let personId: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	const [self] = await sandbox.db
		.select({ ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	personId = self?.ownerId ?? "";
});
afterEach(async () => {
	await sandbox.cleanup();
});

const nameOf = async (spaceId: string) =>
	(
		await sandbox.db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, spaceId))
	)[0]?.name ?? null;

const membersOf = (spaceId: string) =>
	sandbox.db
		.select({ role: member.role })
		.from(member)
		.where(
			and(eq(member.organizationId, spaceId), eq(member.userId, personId)),
		);

const roleOf = async (spaceId: string) =>
	(await membersOf(spaceId))[0]?.role ?? null;

const membershipsIn = async (spaceId: string) =>
	(await membersOf(spaceId)).length;

const studio = { id: "host-a", name: "studio" };
const attic = { id: "host-b", name: "attic" };
const listed = [
	{ id: "space-personal-a", name: "Ada", personal: true, role: "owner" },
	{ id: "space-team", name: "Team", personal: false, role: "member" },
];

const homeLink = {
	hostId: studio.id,
	name: studio.name,
	addresses: ["https://studio.local"],
	certificate: null,
	fingerprint: null,
	role: "home" as const,
	personId: "person-on-a",
	keyStore: "file" as const,
};

describe("the Spaces a Host keeps", () => {
	test("a personal Space that is not hers here is named after its Host; a shared one keeps its name", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);

		expect(await hostSpaces.listed(studio.id)).toEqual([
			{ id: "space-personal-a", name: "Personal on studio", personal: true },
			{ id: "space-team", name: "Team", personal: false },
		]);
		const names = (await spacesOf(sandbox.db, personId)).map((s) => s.name);
		expect(names).toContain("Personal on studio");
		expect(names).toContain("Team");
	});

	test("its keeper is the Host and this computer's link to it", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		const own = await personalSpaceId(sandbox.db, personId);

		// No link, as after a new home Host replaced it.
		expect(await hostSpaces.keeper("space-team")).toEqual({
			hostId: studio.id,
			link: null,
		});
		const links = createHostLinks(sandbox.db);
		await links.save(homeLink);
		expect(await hostSpaces.keeper("space-team")).toEqual({
			hostId: studio.id,
			link: {
				name: "studio",
				personId: "person-on-a",
				role: "home",
				revokedAt: null,
			},
		});
		await links.revoked(studio.id);
		expect(
			(await hostSpaces.keeper("space-team"))?.link?.revokedAt,
		).toBeNumber();
		expect(await hostSpaces.hostOf("space-team")).toBe(studio.id);
		// A Space of this Replica's own has no keeper.
		expect(own).not.toBeNull();
		expect(await hostSpaces.keeper(own ?? "")).toBeNull();
		expect(await hostSpaces.hostOf(own ?? "")).toBeNull();
	});

	test("a Space of this Replica's own is never taken for a Host's", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		const own = (await personalSpaceId(sandbox.db, personId)) ?? "";
		await hostSpaces.update(
			studio,
			[{ id: own, name: "Hijack", personal: false, role: "viewer" }],
			personId,
		);

		expect(await hostSpaces.hostOf(own)).toBeNull();
		expect(await nameOf(own)).toBe("Personal");
		expect(await roleOf(own)).toBe("owner");
	});

	test("a Space another Host keeps stays as that Host lists it", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		await hostSpaces.update(
			attic,
			[{ id: "space-team", name: "Taken", personal: false, role: "owner" }],
			personId,
		);

		expect(await hostSpaces.hostOf("space-team")).toBe(studio.id);
		expect(await hostSpaces.listed(attic.id)).toEqual([]);
		expect(await nameOf("space-team")).toBe("Team");
		expect(await roleOf("space-team")).toBe("member");
	});

	test("this computer's personal Space, kept by its Host, is named as its own", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		const own = (await personalSpaceId(sandbox.db, personId)) ?? "";
		// As after a merge (ADR 1): the Host keeps this computer's personal Space.
		await sandbox.db.insert(hostSpace).values({
			spaceId: own,
			hostId: studio.id,
			name: "Personal on studio",
			role: "owner",
			personal: true,
		});
		await hostSpaces.update(
			studio,
			[{ id: own, name: "Ada", personal: true, role: "owner" }],
			personId,
		);

		expect(await hostSpaces.listed(studio.id)).toEqual([
			{ id: own, name: "Personal", personal: true },
		]);
		expect(await nameOf(own)).toBe("Personal");
	});

	test("a new name and a new role on the Host change the copy and the membership here", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		await hostSpaces.update(
			studio,
			[
				{ id: "space-personal-a", name: "Ada", personal: true, role: "owner" },
				{ id: "space-team", name: "Platform", personal: false, role: "admin" },
			],
			personId,
		);

		expect(await hostSpaces.listed(studio.id)).toEqual([
			{ id: "space-personal-a", name: "Personal on studio", personal: true },
			{ id: "space-team", name: "Platform", personal: false },
		]);
		expect(await nameOf("space-team")).toBe("Platform");
		expect(await roleOf("space-team")).toBe("admin");
		expect(await membershipsIn("space-team")).toBe(1);
	});

	test("a Space listed as before is left as it is", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		await sandbox.db
			.update(organization)
			.set({ name: "Renamed here" })
			.where(eq(organization.id, "space-team"));
		await hostSpaces.update(studio, listed, personId);

		expect(await nameOf("space-team")).toBe("Renamed here");
		expect(await membershipsIn("space-team")).toBe(1);
	});

	test("a Space the Host lists again after a lost membership gets it back", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		await sandbox.db
			.delete(member)
			.where(eq(member.organizationId, "space-team"));
		await hostSpaces.update(studio, listed, personId);

		expect(await roleOf("space-team")).toBe("member");
		expect(await membershipsIn("space-team")).toBe(1);
	});

	test("a Space the Host stops listing ends the membership here, and only for that Host", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);
		await hostSpaces.update(
			attic,
			[{ id: "space-attic", name: "Attic", personal: false, role: "member" }],
			personId,
		);
		await hostSpaces.update(studio, [listed[0] as ListedSpace], personId);

		expect(await hostSpaces.ofHost(studio.id)).toEqual(["space-personal-a"]);
		expect(await roleOf("space-team")).toBeNull();
		// The Space itself stays.
		expect(await nameOf("space-team")).toBe("Team");
		expect(await hostSpaces.ofHost(attic.id)).toEqual(["space-attic"]);
		expect(await roleOf("space-attic")).toBe("member");
	});

	test("an empty list ends every membership through that Host, and no other", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		const own = (await personalSpaceId(sandbox.db, personId)) ?? "";
		await hostSpaces.update(studio, listed, personId);
		await hostSpaces.update(
			attic,
			[{ id: "space-attic", name: "Attic", personal: false, role: "member" }],
			personId,
		);
		await hostSpaces.update(studio, [], personId);

		expect(await hostSpaces.ofHost(studio.id)).toEqual([]);
		expect(await roleOf("space-personal-a")).toBeNull();
		expect(await roleOf("space-team")).toBeNull();
		expect(await hostSpaces.ofHost(attic.id)).toEqual(["space-attic"]);
		expect(await roleOf("space-attic")).toBe("member");
		expect(await roleOf(own)).toBe("owner");
	});

	test("a split names the Space it leaves behind in the same batch", async () => {
		const hostSpaces = createHostSpaces(sandbox.db);
		await hostSpaces.update(studio, listed, personId);

		await sandbox.db.batch([
			hostSpaces.named("space-personal-a", "Personal on old studio"),
		]);

		expect((await hostSpaces.listed(studio.id))[0]?.name).toBe(
			"Personal on old studio",
		);
	});
});
