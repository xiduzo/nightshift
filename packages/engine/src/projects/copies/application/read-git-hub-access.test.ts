import { describe, expect, test } from "bun:test";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { readGitHubAccess } from "./read-git-hub-access";

describe("readGitHubAccess", () => {
	test("says how the GitHub CLI is signed in", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		expect(await readGitHubAccess({ gitHub })()).toBe("signed-out");
		gitHub.signIn();
		expect(await readGitHubAccess({ gitHub })()).toBe("signed-in");
	});
});
