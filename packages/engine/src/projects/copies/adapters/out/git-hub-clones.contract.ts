import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GitHubClones } from "../../application/ports";
import { NOT_A_GITHUB_REPO } from "../../domain/clones";

/**
 * One adapter of `GitHubClones` to test. Its GitHub has `acme/app`, and
 * the GitHub CLI is signed out until `signIn`.
 */
export type GitHubClonesUnderTest = {
	gitHubClones: GitHubClones;
	signIn(): void;
	close(): Promise<void>;
};

/**
 * What every adapter of `GitHubClones` does.
 * `git-hub-clones.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function gitHubClonesContract(
	name: string,
	make: () => Promise<GitHubClonesUnderTest>,
): void {
	describe(`GitHubClones contract: ${name}`, () => {
		let under: GitHubClonesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a copy waits for its clone; the next start uses the clone that is there", async () => {
			const clones = under.gitHubClones;
			expect(clones.status("acme/app")).toBeNull();
			const done = await clones.copy("acme/app");
			expect(done).toMatchObject({ state: "done", reused: false });
			expect(clones.status("https://github.com/acme/app")).toEqual(done);
			expect(await clones.start("acme/app")).toMatchObject({
				state: "done",
				reused: true,
			});
		});

		test("refuses what is not a GitHub repository", async () => {
			await expect(under.gitHubClones.start("not a repo")).rejects.toThrow(
				NOT_A_GITHUB_REPO,
			);
			expect(under.gitHubClones.status("not a repo")).toBeNull();
		});

		test("lists repositories only when the GitHub CLI is signed in", async () => {
			const clones = under.gitHubClones;
			expect(await clones.access()).toBe("signed-out");
			expect(await clones.repos()).toEqual([]);
			under.signIn();
			expect(await clones.access()).toBe("signed-in");
			expect((await clones.repos()).map((repo) => repo.name)).toEqual([
				"acme/app",
			]);
		});
	});
}
