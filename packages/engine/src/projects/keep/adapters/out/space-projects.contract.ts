import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import type { SpaceProjects } from "../../application/ports";
import type { ProjectRecord } from "../../domain/project";

/**
 * One adapter of `SpaceProjects` to test. This Replica keeps the Space
 * `mine`; a Host keeps `hosted`.
 */
export type SpaceProjectsUnderTest = {
	spaceProjects: SpaceProjects;
	/** A document as it is now: each entry's name and whether it is removed, and the Clones. */
	read(spaceId: string): Promise<{
		projects: Record<string, { name: string; removed: boolean }>;
		clones: string[];
	}>;
	close(): Promise<void>;
};

const row = (id: string, spaceId = "mine"): ProjectRecord => ({
	id,
	spaceId,
	name: id,
	remote: null,
	folder: true,
	createdAt: asDate(0),
	removedAt: null,
});

const studio = (projectId: string) => ({
	projectId,
	deviceId: "studio",
	deviceName: "Studio",
});

/**
 * What every adapter of `SpaceProjects` does.
 * `space-projects.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function spaceProjectsContract(
	name: string,
	make: () => Promise<SpaceProjectsUnderTest>,
): void {
	describe(`SpaceProjects contract: ${name}`, () => {
		let under: SpaceProjectsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a new entry, a change of it, and a removal", async () => {
			const { spaceProjects: space } = under;
			expect(
				await space.create("mine", "app", {
					name: "app",
					remote: null,
					folder: true,
				}),
			).toBe(true);
			expect(await space.define(row("app"), { name: "App" })).toBe(true);
			expect(await space.define(row("old"), { removed: true })).toBe(true);
			expect((await under.read("mine")).projects).toEqual({
				app: { name: "App", removed: false },
				old: { name: "old", removed: true },
			});
		});

		test("a Space a Host keeps does not change here", async () => {
			const { spaceProjects: space } = under;
			const entry = { name: "app", remote: null, folder: true };
			expect(await space.create("hosted", "app", entry)).toBe(false);
			expect(await space.define(row("app", "hosted"), { name: "x" })).toBe(
				false,
			);
			expect(await space.recordCloneHere("hosted", studio("app"))).toBe(false);
			expect(await space.recordClone("hosted", studio("app"))).toBe("unknown");
			expect(
				await space.setClones("hosted", {
					deviceId: "studio",
					deviceName: "Studio",
					projectIds: ["app"],
				}),
			).toBeNull();
			await space.take("hosted", { define: [] });
			expect(await under.read("hosted")).toEqual({ projects: {}, clones: [] });
		});

		test("the Clones of a Device: recorded, set, listed and forgotten", async () => {
			const { spaceProjects: space } = under;
			const entry = { name: "app", remote: null, folder: true };
			await space.create("mine", "app", entry);
			await space.create("mine", "site", entry);
			await space.create("mine", "notes", { ...entry, folder: false });
			expect(await space.recordClone("mine", studio("none"))).toBe("unknown");
			expect(await space.recordClone("mine", studio("notes"))).toBe(
				"without-folder",
			);
			expect(await space.recordClone("mine", studio("app"))).toBe("recorded");
			expect(await space.recordCloneHere("mine", studio("app"))).toBe(true);
			expect(
				await space.setClones("mine", {
					deviceId: "studio",
					deviceName: "Studio",
					projectIds: ["site", "notes", "none"],
				}),
			).toEqual({ added: ["site"], removed: ["app"] });
			expect(
				await space.setClones("mine", {
					deviceId: "studio",
					deviceName: "Studio",
					projectIds: ["site"],
				}),
			).toEqual({ added: [], removed: [] });
			expect((await space.clones("mine", ["site", "app"])).get("site")).toEqual(
				[{ deviceId: "studio", deviceName: "Studio" }],
			);
			await space.forgetDevice("studio");
			expect((await under.read("mine")).clones).toEqual([]);
		});

		test("take writes only new entries, brings removed ones back and records Clones", async () => {
			const { spaceProjects: space } = under;
			await space.define(row("app"), { removed: true });
			await space.take("mine", {
				define: [
					{
						id: "app",
						name: "other",
						remote: null,
						folder: true,
						createdAt: 0,
						removedAt: null,
					},
					{
						id: "lib",
						name: "lib",
						remote: null,
						folder: true,
						createdAt: 0,
						removedAt: null,
					},
				],
				restore: ["app"],
				clones: [studio("lib")],
			});
			expect(await under.read("mine")).toEqual({
				projects: {
					app: { name: "app", removed: false },
					lib: { name: "lib", removed: false },
				},
				clones: ["lib/studio"],
			});
		});
	});
}
