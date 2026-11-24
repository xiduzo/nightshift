import { describe, expect, test } from "bun:test";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { readGitHubClone } from "./read-git-hub-clone";

describe("readGitHubClone", () => {
	test("none before a start, then how the clone goes", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		expect(readGitHubClone({ gitHub })({ repo: "acme/app" })).toBeNull();
		await gitHub.start("acme/app");
		expect(readGitHubClone({ gitHub })({ repo: "acme/app" })).toMatchObject({
			state: "done",
		});
	});
});
