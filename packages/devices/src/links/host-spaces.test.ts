import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { personalSpaceId, spacesOf } from "@nightshift/auth";
import { device } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import { createHostLinks } from "./host-links";
import { createHostSpaces } from "./host-spaces";

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

const studio = { id: "host-a", name: "studio" };
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
