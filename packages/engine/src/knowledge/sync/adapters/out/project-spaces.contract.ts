import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectSpaces } from "../../application/ports";

/** One adapter of `ProjectSpaces` to test, with the rows it reads: `p1` and `p2` in the shared Space `s1`, `p3` in the personal Space `s2`. */
export type ProjectSpacesUnderTest = {
	projectSpaces: ProjectSpaces;
	close(): Promise<void>;
};

/**
 * What every adapter of `ProjectSpaces` does.
 * `project-spaces.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function projectSpacesContract(
	name: string,
	make: () => Promise<ProjectSpacesUnderTest>,
): void {
	describe(`ProjectSpaces contract: ${name}`, () => {
		let under: ProjectSpacesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("the Space of a project, and null for one this Replica does not have", async () => {
			expect(await under.projectSpaces.spaceOf("p1")).toBe("s1");
			expect(await under.projectSpaces.spaceOf("nobody-has-it")).toBeNull();
		});

		test("a Space is shared unless it is personal, and an unknown one is not", async () => {
			expect(await under.projectSpaces.isShared("s1")).toBe(true);
			expect(await under.projectSpaces.isShared("s2")).toBe(false);
			expect(await under.projectSpaces.isShared("nobody-has-it")).toBe(false);
		});

		test("the projects of a Space", async () => {
			expect((await under.projectSpaces.projectsIn("s1")).sort()).toEqual([
				"p1",
				"p2",
			]);
			expect(await under.projectSpaces.projectsIn("s3")).toEqual([]);
		});
	});
}
