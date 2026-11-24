import { beforeEach, describe, expect, test } from "bun:test";
import { clone, device, organization, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type { RowBatch } from "../../../../contract";
import type { ProjectStore } from "../../application/ports";
import type { ProjectRecord } from "../../domain/project";
import { runBatch } from "../../test-support";
import { drizzleProjectStore } from "./drizzle-project-store";

const at = (n: number) => asDate(1_767_225_600_000 + n * 1000);

const row = (
	id: string,
	more: Partial<ProjectRecord> & { createdAt: Date },
): ProjectRecord => ({
	id,
	spaceId: "s1",
	name: id,
	remote: null,
	folder: true,
	removedAt: null,
	...more,
});

const make = async () => {
	const db = await migratedDb();
	for (const id of ["s1", "s2"]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	for (const id of ["here", "studio"]) {
		await db.insert(device).values({ id, name: id, platform: "linux" });
	}
	return {
		store: drizzleProjectStore({ db, deviceId: async () => "here" }),
		seed: {
			async project(row: ProjectRecord) {
				await db.insert(project).values(row);
			},
			async clone(projectId: string, deviceId: string, path: string) {
				const [kept] = await db
					.select()
					.from(project)
					.where(eq(project.id, projectId));
				await db.insert(clone).values({
					id: `${projectId}@${deviceId}`,
					spaceId: kept?.spaceId ?? "s1",
					projectId,
					deviceId,
					path,
				});
			},
		},
		run: (batch: RowBatch) => runBatch(db, batch),
		clones: async () =>
			(await db.select().from(clone))
				.map((c) => `${c.projectId}@${c.deviceId}:${c.path}`)
				.sort(),
	};
};

describe("ProjectStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
		const { seed } = under;
		await seed.project(
			row("app", { remote: "github.com/acme/app", createdAt: at(1) }),
		);
		await seed.project(row("lib", { createdAt: at(2) }));
		await seed.project(row("gone", { createdAt: at(3), removedAt: at(4) }));
		await seed.project(row("team", { spaceId: "s2", createdAt: at(5) }));
		await seed.clone("app", "here", "/work/app");
		await seed.clone("gone", "here", "/work/gone");
		await seed.clone("lib", "studio", "/studio/lib");
	});

	test("a removed project has a row, and is found nowhere else", async () => {
		const { store } = under;
		expect((await store.row("gone"))?.removedAt).toEqual(at(4));
		expect(await store.row("nothing")).toBeNull();
		expect(await store.find("gone")).toBeNull();
		expect(await store.find("app", "s2")).toBeNull();
		expect(await store.find("app", "s1")).toMatchObject({
			id: "app",
			repoPath: "/work/app",
		});
		expect(await store.find("lib")).toMatchObject({ repoPath: null });
		expect((await store.listInSpace("s1")).map((p) => p.id)).toEqual([
			"app",
			"lib",
		]);
		expect((await store.listInSpace()).map((p) => p.id)).toEqual([
			"app",
			"lib",
			"team",
		]);
	});

	test("the projects here, by what the filter asks", async () => {
		const { store } = under;
		const ids = async (filter: Parameters<ProjectStore["here"]>[0]) =>
			(await store.here(filter)).map((p) => p.id);
		expect(await ids({})).toEqual(["app", "gone"]);
		expect(await ids({ kept: true })).toEqual(["app"]);
		expect(await ids({ path: "/work/gone" })).toEqual(["gone"]);
		expect(await ids({ projectId: "lib" })).toEqual([]);
		expect(await ids({ withoutRemote: true })).toEqual(["gone"]);
		expect(await ids({ spaceId: "s2" })).toEqual([]);
		expect(await store.clonePath("app", "s1")).toBe("/work/app");
		expect(await store.clonePath("app", "s2")).toBeNull();
		expect(await store.clonePath("gone", "s1")).toBeNull();
		expect(await store.clonePath("app")).toBe("/work/app");
	});

	test("by remote, by ids or remotes, and the projects of a Space", async () => {
		const { store } = under;
		expect((await store.byRemote("github.com/acme/app"))?.id).toBe("app");
		expect(await store.byRemote("github.com/acme/none")).toBeNull();
		expect(
			(
				await store.matching({
					ids: ["lib"],
					remotes: ["github.com/acme/app"],
				})
			)
				.map((p) => p.id)
				.sort(),
		).toEqual(["app", "lib"]);
		expect(await store.matching({})).toEqual([]);
		expect(
			(await store.ofSpace("s1")).map((p) => [
				p.id,
				p.clone,
				p.walked,
				p.folder,
			]),
		).toEqual([
			["app", true, false, true],
			["lib", false, false, true],
			["gone", true, false, true],
		]);
	});

	test("a project a Host added: kept at once, a removed one of the Space comes back", async () => {
		const { store } = under;
		await store.keepHosted({
			id: "gone",
			spaceId: "s1",
			name: "gone",
			remote: "github.com/acme/gone",
		});
		expect((await store.row("gone"))?.removedAt).toBeNull();
		await store.keepHosted({
			id: "new",
			spaceId: "s2",
			name: "new",
			remote: "github.com/acme/new",
		});
		expect(await store.row("new")).toMatchObject({ spaceId: "s2" });
		await store.keepHostedWithoutFolder({
			id: "lib",
			spaceId: "s1",
			name: "renamed",
		});
		expect(await store.row("lib")).toMatchObject({ name: "lib" });
		await store.keepHostedWithoutFolder({
			id: "notes",
			spaceId: "s1",
			name: "notes",
		});
		expect(await store.row("notes")).toMatchObject({
			folder: false,
			remote: null,
		});
		expect(await store.withoutFolder("notes")).toBe(true);
		expect(await store.withoutFolder("lib")).toBe(false);
		expect(await store.withoutFolder("nothing")).toBe(false);
	});

	test("the statements of the Clones, run in a batch", async () => {
		const { store } = under;
		await store.addClone({
			spaceId: "s1",
			projectId: "lib",
			deviceId: "here",
			path: "/work/lib",
		});
		await under.run(
			store.cloneRow({
				spaceId: "s1",
				projectId: "app",
				deviceId: "here",
				path: "/moved/app",
				moved: true,
			}),
		);
		expect(await under.clones()).toEqual([
			"app@here:/moved/app",
			"gone@here:/work/gone",
			"lib@here:/work/lib",
			"lib@studio:/studio/lib",
		]);
		await under.run(store.forgetClones("studio"));
		await under.run(store.adoptClones("here", "studio"));
		expect(await under.clones()).toEqual([
			"app@studio:/moved/app",
			"gone@studio:/work/gone",
			"lib@studio:/work/lib",
		]);
	});
});
