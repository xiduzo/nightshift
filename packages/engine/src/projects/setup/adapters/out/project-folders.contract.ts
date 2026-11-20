import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectFolders } from "../../application/ports";

/**
 * One adapter of `ProjectFolders` to test, over three folders it made:
 * `plain` (no repository), `repo` (a repository without a commit, with a
 * subfolder `repo/sub`), and the path `missing`.
 */
export type ProjectFoldersUnderTest = {
	projectFolders: ProjectFolders;
	paths: { plain: string; repo: string; sub: string; missing: string };
	close(): Promise<void>;
};

/**
 * What every adapter of `ProjectFolders` does.
 * `project-folders.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function projectFoldersContract(
	name: string,
	make: () => Promise<ProjectFoldersUnderTest>,
): void {
	describe(`ProjectFolders contract: ${name}`, () => {
		let under: ProjectFoldersUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("folders and the top of their repository", async () => {
			const { projectFolders: folders, paths } = under;
			expect(await folders.gitInstalled()).toBe(true);
			expect(await folders.isDirectory(paths.plain)).toBe(true);
			expect(await folders.isDirectory(paths.missing)).toBe(false);
			expect(await folders.topLevel(paths.plain)).toBeNull();
			expect(await folders.topLevel(paths.repo)).toBe(paths.repo);
			expect(await folders.topLevel(paths.sub)).toBe(paths.repo);
		});

		test("a repository gets an identity, a .gitignore and a first commit", async () => {
			const { projectFolders: folders, paths } = under;
			await folders.init(paths.plain);
			expect(await folders.topLevel(paths.plain)).toBe(paths.plain);
			expect(await folders.hasCommit(paths.plain)).toBe(false);
			expect(await folders.hasIdentity(paths.plain)).toBe(false);
			await folders.setIdentity(paths.plain, "user.name", "Ada");
			await folders.setIdentity(paths.plain, "user.email", "ada@example.com");
			expect(await folders.hasIdentity(paths.plain)).toBe(true);
			expect(await folders.hasGitignore(paths.plain)).toBe(false);
			await folders.writeGitignore(paths.plain, "node_modules/\n");
			expect(await folders.hasGitignore(paths.plain)).toBe(true);
			await folders.commitAll(paths.plain, "Initial commit");
			expect(await folders.hasCommit(paths.plain)).toBe(true);
		});
	});
}
