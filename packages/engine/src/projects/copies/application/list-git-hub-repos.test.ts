import { describe, expect, test } from "bun:test";
import {
	inMemoryCopiesPorts,
	inMemoryCopySpace,
} from "../adapters/out/in-memory-neighbours";
import { listGitHubRepos } from "./list-git-hub-repos";

describe("listGitHubRepos", () => {
	test("none while the GitHub CLI is signed out, the person's when signed in", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		void inMemoryCopySpace;
		expect(await listGitHubRepos({ gitHub })()).toEqual([]);
		gitHub.signIn();
		expect((await listGitHubRepos({ gitHub })()).map((r) => r.name)).toEqual([
			"acme/app",
		]);
	});
});
